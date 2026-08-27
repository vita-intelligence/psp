defmodule Backend.ThreePL.Requests do
  @moduledoc """
  Boundary for customer-driven 3PL vs direct-shipment routing on
  bespoke NPD-formulation Customer Orders.

  Only fires when the CO has an ``npd_formulation_uuid`` — standard
  commercial COs (no NPD linkage) keep today's operator per-lot
  picker. See ``custom_formulation?/1`` for the exact predicate.

  Public entry points:

    * ``create_or_get_for_co/2`` — idempotently spawn a request for
      a CO when its first output lot enters ``awaiting_release`` →
      ``available``. Called from the wizard hook.
    * ``snapshot_for_co/2`` — pure projection over the CO's
      released lots + company rates + capacity. Fed to both the PSP
      team review card AND the customer portal decision card so the
      two sides can never disagree on the number.
    * ``customer_choose/3`` — the portal's submit endpoint.
      Freezes the snapshot on the request row.
    * ``team_approve/2`` / ``team_decline/3`` — PSP team decision
      on a ``three_pl`` request.

  Every state transition ends by re-emitting an ``OrderWizard`` push
  so the customer portal reflects the latest state in real time.
  """

  import Ecto.Query
  require Logger

  alias Backend.Accounts.User
  alias Backend.Audit
  alias Backend.Companies
  alias Backend.CustomerOrders.CustomerOrder
  alias Backend.Repo
  alias Backend.Stock.{Lot, Placement}
  alias Backend.ThreePL
  alias Backend.ThreePL.RoutingRequest
  alias Backend.Warehouses.StorageCell

  # ─── Predicates ────────────────────────────────────────────────────

  @doc """
  True when the CO's routing decision belongs to the customer, not
  the PSP operator. Today that's every CO with an NPD formulation
  UUID — those are bespoke recipes co-developed with the customer,
  and the ``3PL vs ship`` post-release step is a decision the
  customer is entitled to make on their own goods.
  """
  def custom_formulation?(%CustomerOrder{npd_formulation_uuid: uuid})
      when is_binary(uuid) and byte_size(uuid) > 0,
      do: true

  def custom_formulation?(_), do: false

  # ─── Read paths ────────────────────────────────────────────────────

  @doc """
  Load the routing request for a CO, or ``nil`` when none exists yet
  (non-custom CO, or the wizard hook hasn't fired because no lot is
  released yet).
  """
  def get_for_co(%CustomerOrder{id: id}), do: get_for_co(id)

  def get_for_co(co_id) when is_integer(co_id) do
    Repo.one(
      from r in RoutingRequest,
        where: r.customer_order_id == ^co_id,
        preload: [:team_reviewed_by, :customer_order]
    )
  end

  def get_by_uuid(company_id, uuid) when is_integer(company_id) and is_binary(uuid) do
    Repo.one(
      from r in RoutingRequest,
        where: r.company_id == ^company_id and r.uuid == ^uuid,
        preload: [:team_reviewed_by, :customer_order]
    )
  end

  @doc """
  Pure projection consumed by both:
    * the customer portal (via the NPD payload push), so the
      decision card renders "£X/day for Y days = £Z + Q m³ needed,
      currently P m³ available" against the same math PSP uses.
    * the PSP team review card, so Approve / Decline decisions are
      taken against the same numbers the customer saw at submit.

  Returns:

      %{
        required_m3: Decimal.t(),
        free_m3: Decimal.t(),
        capacity_ok: boolean(),
        rate_per_m3_per_day: Decimal.t() | nil,
        estimated_days: pos_integer(),
        estimated_daily_charge: Decimal.t(),
        estimated_period_charge: Decimal.t(),
        currency_code: String.t()
      }

  When the CO has no released lots yet (edge — request created but
  Final Release still owing per-lot), returns zeros for volumes so
  the FE renders "waiting on release" instead of raising.
  """
  def snapshot_for_co(%CustomerOrder{} = co) do
    company = Companies.current()
    lots = released_lots_for_co(co)
    warehouse_id = derive_warehouse_id(lots)

    rate = company && company.three_pl_rate_per_m3_per_day
    days = (company && company.default_three_pl_estimate_days) || 30

    required_m3 =
      lots
      |> Enum.reduce(Decimal.new(0), fn lot, acc ->
        Decimal.add(acc, ThreePL.lot_stored_volume_m3(lot))
      end)
      |> Decimal.round(4)

    free_m3 =
      case warehouse_id do
        nil -> Decimal.new(0)
        wid -> ThreePL.capacity_free_m3(wid, "three_pl_storage") |> Decimal.round(4)
      end

    capacity_ok = Decimal.compare(free_m3, required_m3) != :lt

    {daily_charge, period_charge} = compute_charges(required_m3, rate, days)

    %{
      required_m3: required_m3,
      free_m3: free_m3,
      capacity_ok: capacity_ok,
      rate_per_m3_per_day: rate,
      estimated_days: days,
      estimated_daily_charge: daily_charge,
      estimated_period_charge: period_charge,
      currency_code: (company && company.currency_code) || "GBP"
    }
  end

  def snapshot_for_co(co_id) when is_integer(co_id) do
    case Repo.get(CustomerOrder, co_id) do
      %CustomerOrder{} = co -> snapshot_for_co(co)
      _ -> nil
    end
  end

  # ─── Lifecycle ─────────────────────────────────────────────────────

  @doc """
  Create the request row for ``co`` if it doesn't already exist and
  the CO qualifies (custom formulation). Idempotent — safe to call
  from the wizard on every render. Returns ``{:ok, request}`` or
  ``:not_applicable`` when the CO is a standard commercial order.
  """
  def create_or_get_for_co(actor, %CustomerOrder{} = co) do
    cond do
      not custom_formulation?(co) ->
        :not_applicable

      row = get_for_co(co) ->
        {:ok, row}

      true ->
        actor_id = actor && actor.id

        %RoutingRequest{}
        |> RoutingRequest.create_changeset(%{
          company_id: co.company_id,
          customer_order_id: co.id,
          created_by_id: actor_id,
          updated_by_id: actor_id
        })
        |> Repo.insert()
        |> case do
          {:ok, row} ->
            # Race-safe: two wizard renders may hit this in parallel.
            # The DB unique index on customer_order_id catches the
            # second insert; we re-fetch the winner and return it.
            {:ok, row}

          {:error, %Ecto.Changeset{errors: [customer_order_id: _]} = _cs} ->
            {:ok, get_for_co(co)}

          {:error, %Ecto.Changeset{} = cs} ->
            {:error, cs}
        end
    end
  end

  @doc """
  Customer submitted a choice from the portal.

    * ``"shipment"`` → state ``applied_shipment`` and every CO
      output lot routed via ``ThreePL.route_released_lot``.
    * ``"three_pl"`` → state ``awaiting_team_review`` with the
      current ``snapshot_for_co`` frozen on the row. PSP team
      picks it up on the Final Releases page.

  Emitted via the integration webhook: the ``actor`` here is a
  system user (there is no PSP user session on a portal call).
  Returns ``{:ok, request}`` on success or a discriminated error.
  """
  def customer_choose(%CustomerOrder{} = co, choice, actor)
      when choice in ["three_pl", "shipment"] do
    case get_for_co(co) do
      nil ->
        {:error, :no_request}

      %RoutingRequest{state: state} when state not in ["awaiting_customer"] ->
        {:error, {:wrong_state, state}}

      %RoutingRequest{} = request ->
        snapshot = snapshot_for_co(co) |> serialize_snapshot()
        now = DateTime.utc_now() |> DateTime.truncate(:second)

        next_state =
          case choice do
            "three_pl" -> "awaiting_team_review"
            "shipment" -> "applied_shipment"
          end

        with {:ok, updated} <-
               request
               |> RoutingRequest.customer_choice_changeset(%{
                 customer_choice: choice,
                 estimate_snapshot: snapshot,
                 customer_chose_at: now,
                 state: next_state,
                 updated_by_id: actor && actor.id
               })
               |> Repo.update() do
          audit(actor, request, updated)

          # Direct shipment auto-applies — the customer's decision is
          # both intent + action for the shipment path (no team review
          # needed). For 3PL we wait for the team.
          if choice == "shipment" do
            apply_choice_to_lots(actor, co, "shipment")
          end

          notify_wizard(co)
          {:ok, updated}
        end
    end
  end

  def customer_choose(_co, _choice, _actor), do: {:error, :bad_choice}

  @doc """
  PSP team approves a 3PL request. Applies ``routed_to_3pl`` on
  every released lot for the CO, flipping the request to
  ``applied_three_pl``. Any per-lot ``ThreePL.route_released_lot``
  failure (capacity gone since customer submit, etc.) short-circuits
  and leaves the row in ``awaiting_team_review`` so the team can
  retry or decline.
  """
  def team_approve(%User{} = actor, %RoutingRequest{state: "awaiting_team_review"} = request) do
    co = Repo.get(CustomerOrder, request.customer_order_id)
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    Repo.transaction(fn ->
      with :ok <- apply_choice_to_lots(actor, co, "three_pl"),
           {:ok, updated} <-
             request
             |> RoutingRequest.team_approve_changeset(%{
               state: "applied_three_pl",
               team_reviewed_at: now,
               team_reviewed_by_id: actor.id,
               updated_by_id: actor.id
             })
             |> Repo.update() do
        audit(actor, request, updated)
        updated
      else
        {:error, reason} -> Repo.rollback(reason)
      end
    end)
    |> case do
      {:ok, updated} ->
        notify_wizard(co)
        {:ok, updated}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def team_approve(_actor, %RoutingRequest{state: state}), do: {:error, {:wrong_state, state}}

  @doc """
  PSP team declines a 3PL request. Bounces back to
  ``awaiting_customer`` with the reason preserved — the portal
  re-renders the option cards with the decline reason chip.
  """
  def team_decline(%User{} = actor, %RoutingRequest{state: "awaiting_team_review"} = request, reason)
      when is_binary(reason) do
    case String.trim(reason) do
      "" ->
        {:error, :reason_required}

      trimmed ->
        co = Repo.get(CustomerOrder, request.customer_order_id)
        now = DateTime.utc_now() |> DateTime.truncate(:second)

        request
        |> RoutingRequest.team_decline_changeset(%{
          state: "awaiting_customer",
          team_reviewed_at: now,
          team_reviewed_by_id: actor.id,
          team_decision_reason: trimmed,
          updated_by_id: actor.id
        })
        |> Repo.update()
        |> case do
          {:ok, updated} ->
            audit(actor, request, updated)
            notify_wizard(co)
            {:ok, updated}

          err ->
            err
        end
    end
  end

  def team_decline(_actor, %RoutingRequest{state: state}, _reason),
    do: {:error, {:wrong_state, state}}

  @doc """
  Called from ``Backend.ThreePL.route_released_lot/4`` after the
  operator successfully routes a single lot via the per-lot picker.
  When every produced lot for the CO has now been routed the same
  way, flip the request row to ``applied_three_pl`` or
  ``applied_shipment`` accordingly. Otherwise leave it alone —
  partial progress is a legitimate intermediate state.

  Silent no-op when:
    * the CO isn't custom-formulation (no request row exists);
    * the request is already in a terminal ``applied_*`` state;
    * a mixed set of routes has been recorded (some 3PL, some
      shipment) — leaves the wizard chip at the pre-existing state
      so the operator gets a clear "not yet resolved" signal.
  """
  def sync_state_after_per_lot_routing(actor, %Lot{} = lot, choice)
      when choice in ["three_pl", "shipment"] do
    case co_for_lot(lot) do
      nil ->
        :ok

      %CustomerOrder{} = co ->
        case get_for_co(co) do
          nil ->
            :ok

          %RoutingRequest{state: state} when state in ["applied_three_pl", "applied_shipment"] ->
            :ok

          %RoutingRequest{} = request ->
            maybe_apply_from_lot_routing(actor, co, request, choice)
        end
    end
  end

  def sync_state_after_per_lot_routing(_actor, _lot, _choice), do: :ok

  # Walk every CO output lot and inspect its LATEST routing lifecycle
  # event (``routed_to_3pl`` / ``routed_to_shipment``). Returns
  # ``:all_three_pl`` when every produced lot has been routed to
  # 3PL, ``:all_shipment`` similarly for shipment, ``:mixed`` when
  # the operator picked different targets, or ``:incomplete`` when
  # any lot is still unrouted.
  defp maybe_apply_from_lot_routing(actor, %CustomerOrder{} = co, %RoutingRequest{} = request, choice) do
    verdict = summarise_routing_verdict(co)

    next_state =
      case verdict do
        :all_three_pl -> "applied_three_pl"
        :all_shipment -> "applied_shipment"
        _ -> nil
      end

    if is_nil(next_state) do
      :ok
    else
      now = DateTime.utc_now() |> DateTime.truncate(:second)
      actor_id = actor && actor.id

      request
      |> RoutingRequest.team_approve_changeset(%{
        state: next_state,
        team_reviewed_at: now,
        team_reviewed_by_id: actor_id,
        updated_by_id: actor_id
      })
      |> Repo.update()
      |> case do
        {:ok, updated} ->
          # Also stamp ``customer_choice`` when the operator's picks
          # confirmed a customer 3PL request that was still
          # ``awaiting_team_review`` — keeps the audit trail
          # consistent between the customer's declared intent + the
          # team's action.
          maybe_backfill_customer_choice(updated, choice)
          audit(actor, request, updated)
          notify_wizard(co)
          {:ok, updated}

        err ->
          err
      end
    end
  end

  defp maybe_backfill_customer_choice(%RoutingRequest{customer_choice: choice}, _picked)
       when is_binary(choice),
       do: :ok

  defp maybe_backfill_customer_choice(%RoutingRequest{customer_choice: nil} = req, picked)
       when picked in ["three_pl", "shipment"] do
    req
    |> Ecto.Changeset.change(%{customer_choice: picked})
    |> Repo.update()
  end

  defp co_for_lot(%Lot{id: lot_id}) do
    Repo.one(
      from co in CustomerOrder,
        join: col in Backend.CustomerOrders.CustomerOrderLine,
        on: col.customer_order_id == co.id,
        join: mo in Backend.Production.ManufacturingOrder,
        on: mo.customer_order_line_id == col.id,
        where: mo.produced_lot_id == ^lot_id,
        limit: 1
    )
  end

  defp summarise_routing_verdict(%CustomerOrder{id: co_id}) do
    rows =
      Repo.all(
        from l in Lot,
          join: mo in Backend.Production.ManufacturingOrder,
          on: mo.produced_lot_id == l.id,
          join: col in Backend.CustomerOrders.CustomerOrderLine,
          on: col.id == mo.customer_order_line_id,
          left_join: e in Backend.Stock.LotEvent,
          on:
            e.stock_lot_id == l.id and
              e.kind in ["routed_to_3pl", "routed_to_shipment"],
          where:
            col.customer_order_id == ^co_id and
              mo.project_type == "production" and
              mo.status == "completed",
          group_by: l.id,
          select: {l.id, fragment("max(?)", e.kind)}
      )

    cond do
      rows == [] ->
        :incomplete

      Enum.any?(rows, fn {_id, kind} -> is_nil(kind) end) ->
        :incomplete

      Enum.all?(rows, fn {_id, kind} -> kind == "routed_to_3pl" end) ->
        :all_three_pl

      Enum.all?(rows, fn {_id, kind} -> kind == "routed_to_shipment" end) ->
        :all_shipment

      true ->
        :mixed
    end
  end

  # ─── Internal ──────────────────────────────────────────────────────

  # Every output lot from the CO's production-type MOs that has
  # been signed off in Final Release and is currently
  # ``available`` / awaiting routing. Excludes trial / sample /
  # cancelled runs.
  defp released_lots_for_co(%CustomerOrder{id: co_id}) do
    from(l in Lot,
      join: mo in Backend.Production.ManufacturingOrder,
      on: mo.produced_lot_id == l.id,
      join: col in Backend.CustomerOrders.CustomerOrderLine,
      on: col.id == mo.customer_order_line_id,
      where:
        col.customer_order_id == ^co_id and
          mo.project_type == "production" and
          mo.status == "completed" and
          l.status == "available",
      preload: [:placements]
    )
    |> Repo.all()
  end

  # All released lots in one CO should physically live in one
  # warehouse (Positive Release routed them to finished_quarantine
  # cells). Take the warehouse of the first placed lot as the
  # capacity-check scope.
  defp derive_warehouse_id([]), do: nil

  defp derive_warehouse_id([%Lot{id: lot_id} | _]) do
    Repo.one(
      from p in Placement,
        join: c in StorageCell,
        on: c.id == p.storage_cell_id,
        join: loc in assoc(c, :storage_location),
        where: p.stock_lot_id == ^lot_id and p.qty > 0,
        select: loc.warehouse_id,
        limit: 1
    )
  end

  # Nil rate = company hasn't set a 3PL rate yet on
  # ``/settings/company``. The portal renders "3PL rate not
  # configured" rather than "£0.00/day" — see the FE snapshot
  # consumer.
  defp compute_charges(_required_m3, nil, _days),
    do: {Decimal.new(0), Decimal.new(0)}

  defp compute_charges(required_m3, %Decimal{} = rate, days) do
    daily = Decimal.mult(required_m3, rate) |> Decimal.round(2)
    period = Decimal.mult(daily, Decimal.new(days)) |> Decimal.round(2)
    {daily, period}
  end

  # Wire-safe form — all decimals stringified so JSON round-trips
  # to NPD + the portal without float loss.
  defp serialize_snapshot(snap) do
    %{
      "required_m3" => decimal_to_string(snap.required_m3),
      "free_m3" => decimal_to_string(snap.free_m3),
      "capacity_ok" => snap.capacity_ok,
      "rate_per_m3_per_day" => decimal_to_string(snap.rate_per_m3_per_day),
      "estimated_days" => snap.estimated_days,
      "estimated_daily_charge" => decimal_to_string(snap.estimated_daily_charge),
      "estimated_period_charge" => decimal_to_string(snap.estimated_period_charge),
      "currency_code" => snap.currency_code
    }
  end

  defp decimal_to_string(nil), do: nil
  defp decimal_to_string(%Decimal{} = d), do: Decimal.to_string(d, :normal)
  defp decimal_to_string(other), do: to_string(other)

  # Route every CO output lot via the existing per-lot helper.
  # Portal-driven customer choice comes in with no user session
  # (integration token, not a browser cookie) — synthesise a
  # company-scoped admin actor so ``route_released_lot``'s RBAC
  # gate + audit trail both work uniformly. Field-level audit rows
  # get ``actor_id = nil`` which the audit reader renders as
  # "System (portal)".
  defp apply_choice_to_lots(actor, %CustomerOrder{} = co, choice) do
    lots = released_lots_for_co(co)
    routing_actor = actor || system_actor_for(co)

    Enum.reduce_while(lots, :ok, fn lot, _acc ->
      case ThreePL.route_released_lot(routing_actor, lot, choice) do
        {:ok, _} -> {:cont, :ok}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  defp apply_choice_to_lots(_actor, nil, _choice), do: :ok

  defp system_actor_for(%CustomerOrder{company_id: cid}) do
    %User{id: nil, company_id: cid, is_admin: true}
  end

  defp notify_wizard(nil), do: :ok

  defp notify_wizard(%CustomerOrder{id: id}), do: Backend.OrderWizard.notify_co_changed(id)

  defp audit(actor, %RoutingRequest{} = before, %RoutingRequest{} = after_) do
    Audit.record_updated(
      actor,
      "co_routing_request",
      after_,
      %{
        state: before.state,
        customer_choice: before.customer_choice,
        team_decision_reason: before.team_decision_reason
      },
      %{
        state: after_.state,
        customer_choice: after_.customer_choice,
        team_decision_reason: after_.team_decision_reason
      }
    )
  end
end
