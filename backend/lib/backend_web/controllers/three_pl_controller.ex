defmodule BackendWeb.ThreePLController do
  @moduledoc """
  3PL (bailee-custody) endpoints — mount under `/api/three-pl`.

    * `POST /route/:lot_uuid`             — route a released lot to
                                            three_pl_storage or dispatch
    * `GET  /inventory`                   — bailee lots for the 3PL tab
    * `GET  /capacity/:warehouse_id`      — free m³ per purpose, for the
                                            wizard's inline capacity hint

  All actions gate on `production.final_release` — the routing decision
  belongs to the same operator who just signed the release. Capacity
  and inventory reads use the same gate so a viewer without release
  perms doesn't see bailee inventory (compliance-flavoured info).
  """

  use BackendWeb, :controller

  alias Backend.Repo
  alias Backend.Stock.Lot
  alias Backend.ThreePL
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "production.final_release"

  action_fallback BackendWeb.FallbackController

  # ---------------------------------------------------------------
  # POST /three-pl/route/:lot_uuid
  # ---------------------------------------------------------------
  def route_lot(conn, %{"lot_uuid" => lot_uuid, "choice" => choice} = params)
      when choice in ["three_pl", "shipment"] do
    actor = conn.assigns.current_user

    with %Lot{} = lot <- get_lot(actor.company_id, lot_uuid),
         {:ok, opts} <- resolve_route_opts(actor.company_id, params),
         {:ok, %{lot: updated}} <- ThreePL.route_released_lot(actor, lot, choice, opts) do
      json(conn, %{lot: Payloads.stock_lot(preload_for_payload(updated))})
    else
      nil ->
        not_found(conn, "Lot not found.")

      {:error, :forbidden} ->
        conn
        |> put_status(:forbidden)
        |> json(Errors.payload("forbidden", "You lack production.final_release.", %{}))

      {:error, :not_available} ->
        unprocessable(conn, "not_available",
          "Only released lots (status = available) can be routed to 3PL or dispatch.")

      {:error, :already_routed} ->
        unprocessable(conn, "already_routed",
          "This lot has already been routed. Rerouting requires an override action.")

      {:error, :lot_not_placed} ->
        unprocessable(conn, "lot_not_placed",
          "The lot has no active placements — put-away must complete before routing.")

      {:error, :no_customer_for_lot} ->
        unprocessable(conn, "no_customer_for_lot",
          "This lot has no linked customer order. Pick a customer or route to 'shipment'.")

      {:error, {:bad_customer, uuid}} ->
        unprocessable(conn, "bad_customer",
          "The picked customer isn't in your company (#{uuid}).")

      {:error, {:no_capacity, %{purpose: purpose, required_m3: req, free_m3: free}}} ->
        conn
        |> put_status(:conflict)
        |> json(
          Errors.payload(
            "no_capacity",
            "Not enough space in #{purpose} cells for this lot.",
            %{
              purpose: purpose,
              required_m3: Decimal.to_string(req),
              free_m3: Decimal.to_string(free)
            }
          )
        )

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)

      {:error, reason} ->
        unprocessable(conn, "route_failed", inspect(reason))
    end
  end

  def route_lot(conn, %{"choice" => _}) do
    unprocessable(conn, "bad_choice", "choice must be 'three_pl' or 'shipment'.")
  end

  def route_lot(conn, _params) do
    unprocessable(conn, "missing_choice", "choice is required ('three_pl' or 'shipment').")
  end

  # ---------------------------------------------------------------
  # POST /three-pl/dispatch/:lot_uuid
  # ---------------------------------------------------------------
  def dispatch_lot(conn, %{"lot_uuid" => lot_uuid} = params) do
    actor = conn.assigns.current_user
    attrs = Map.put(params, "lot_uuid", lot_uuid)

    case ThreePL.dispatch(actor, attrs) do
      {:ok, %{lot: lot, dispatch: dispatched}} ->
        preloaded = preload_for_payload(lot)

        json(conn, %{
          lot: Payloads.stock_lot(preloaded),
          dispatch: dispatch_payload(dispatched)
        })

      {:error, :forbidden} ->
        conn
        |> put_status(:forbidden)
        |> json(Errors.payload("forbidden", "You lack production.final_release.", %{}))

      {:error, :lot_not_found} ->
        not_found(conn, "Lot not found.")

      {:error, :not_bailee} ->
        unprocessable(conn, "not_bailee",
          "Only bailee-custody lots can be dispatched this way. Own stock ships via the standard move flow.")

      {:error, :bad_qty} ->
        unprocessable(conn, "bad_qty", "qty must be a positive decimal.")

      {:error, :no_bailee_placement} ->
        unprocessable(conn, "no_bailee_placement",
          "The lot isn't currently sitting in a three_pl_storage cell. Move it there before dispatching.")

      {:error, :insufficient_qty} ->
        unprocessable(conn, "insufficient_qty",
          "Requested qty exceeds what's currently in bailee custody.")

      {:error, :no_dispatch_cell} ->
        unprocessable(conn, "no_dispatch_cell",
          "This warehouse has no dispatch cell. Add one under Settings → Warehouses → Plan.")

      {:error, {:missing_key, key}} ->
        unprocessable(conn, "missing_field", "#{key} is required.")

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)

      {:error, reason} ->
        unprocessable(conn, "dispatch_failed", inspect(reason))
    end
  end

  # ---------------------------------------------------------------
  # GET /three-pl/inventory
  # ---------------------------------------------------------------
  def inventory(conn, _params) do
    actor = conn.assigns.current_user
    company = Backend.Companies.current()
    lots = ThreePL.list_bailee_lots(actor.company_id)

    json(conn, %{
      # Currency + rate context so the FE can render a heading like
      # "GBP 1.50/m³/day" without a second /company hit.
      rate: %{
        amount: decimal_to_string(company.three_pl_rate_per_m3_per_day),
        currency: company.currency_code
      },
      items:
        Enum.map(lots, &bailee_lot_row(&1, company.three_pl_rate_per_m3_per_day))
    })
  end

  # ---------------------------------------------------------------
  # GET /three-pl/lots/:lot_uuid
  # ---------------------------------------------------------------
  def lot_detail(conn, %{"lot_uuid" => lot_uuid}) do
    actor = conn.assigns.current_user
    company = Backend.Companies.current()

    case ThreePL.get_bailee_lot_detail(actor.company_id, lot_uuid) do
      nil ->
        not_found(conn, "Lot not found in bailee custody.")

      %{
        lot: lot,
        dispatches: dispatches,
        release: release,
        move_in_evidence: move_in
      } ->
        rate = company.three_pl_rate_per_m3_per_day

        json(conn, %{
          lot: Payloads.stock_lot(lot),
          summary: %{
            held_volume_m3:
              Decimal.to_string(Decimal.round(ThreePL.lot_held_volume_m3(lot), 4)),
            original_qty: decimal_to_string(lot.qty_received),
            held_qty: decimal_to_string(held_qty(lot)),
            dispatched_qty:
              decimal_to_string(sum_dispatch_qty(dispatches)),
            days_held: days_since(lot.bailee_routed_at),
            accrued_amount:
              case rate do
                nil -> nil
                _ ->
                  Decimal.to_string(
                    Decimal.round(ThreePL.accrued_charge(lot, rate), 2)
                  )
              end,
            currency: company.currency_code,
            rate:
              case rate do
                nil -> nil
                r -> decimal_to_string(r)
              end
          },
          dispatches: Enum.map(dispatches, &dispatch_payload/1),
          release: release_bundle_payload(release),
          move_in_evidence: move_in_payload(move_in)
        })
    end
  end

  # ---------------------------------------------------------------
  # GET /three-pl/capacity/:warehouse_uuid
  # ---------------------------------------------------------------
  def capacity(conn, %{"warehouse_uuid" => warehouse_uuid}) do
    actor = conn.assigns.current_user

    case Repo.get_by(Backend.Warehouses.Warehouse, uuid: warehouse_uuid) do
      %{id: id, company_id: company_id} when company_id == actor.company_id ->
        free_three_pl = ThreePL.capacity_free_m3(id, "three_pl_storage")
        free_dispatch = ThreePL.capacity_free_m3(id, "dispatch")

        json(conn, %{
          warehouse_uuid: warehouse_uuid,
          free_m3: %{
            three_pl_storage: Decimal.to_string(free_three_pl),
            dispatch: Decimal.to_string(free_dispatch)
          }
        })

      _ ->
        not_found(conn, "Warehouse not found.")
    end
  end

  # ---------------------------------------------------------------
  # Payload / preload helpers
  # ---------------------------------------------------------------

  # Translate the optional `customer_uuid` into a proper Elixir keyword
  # list for the context module. Backend still validates that the
  # picked customer belongs to the actor's company.
  defp resolve_route_opts(company_id, %{"customer_uuid" => uuid})
       when is_binary(uuid) and uuid != "" do
    case Repo.get_by(Backend.Customers.Customer, uuid: uuid) do
      %{id: id, company_id: ^company_id} -> {:ok, [override_customer_id: id]}
      %{} -> {:error, {:bad_customer, uuid}}
      nil -> {:error, {:bad_customer, uuid}}
    end
  end

  defp resolve_route_opts(_company_id, _params), do: {:ok, []}

  defp held_qty(%Lot{placements: placements}) when is_list(placements) do
    placements
    |> Enum.filter(fn p ->
      p.storage_cell &&
        p.storage_cell.purpose == "three_pl_storage" &&
        p.qty &&
        Decimal.compare(p.qty, Decimal.new(0)) == :gt
    end)
    |> Enum.reduce(Decimal.new(0), &Decimal.add(&2, &1.qty))
  end

  defp held_qty(_), do: Decimal.new(0)

  defp sum_dispatch_qty(list) when is_list(list) do
    Enum.reduce(list, Decimal.new(0), &Decimal.add(&2, &1.qty))
  end

  defp move_in_payload(nil), do: nil

  defp move_in_payload(%Backend.Stock.Movement{} = m) do
    %{
      uuid: m.uuid,
      photo_url: m.photo_url,
      skip_photo_reason: m.skip_photo_reason,
      occurred_at: m.occurred_at,
      actor:
        case m.actor do
          %Backend.Accounts.User{} = u ->
            %{id: u.id, uuid: u.uuid, name: u.name, email: u.email}

          _ ->
            nil
        end,
      from_cell:
        case m.from_cell do
          %Backend.Warehouses.StorageCell{} = c ->
            %{id: c.id, uuid: c.uuid, name: c.name, purpose: c.purpose}

          _ ->
            nil
        end,
      to_cell:
        case m.to_cell do
          %Backend.Warehouses.StorageCell{} = c ->
            %{id: c.id, uuid: c.uuid, name: c.name, purpose: c.purpose}

          _ ->
            nil
        end
    }
  end

  defp release_bundle_payload(nil), do: nil

  defp release_bundle_payload(%Backend.Production.FinalRelease{} = r) do
    %{
      uuid: r.uuid,
      status: r.status,
      finalized_at: r.finalized_at,
      finalized_by:
        case r.finalized_by do
          %Backend.Accounts.User{} = u ->
            %{id: u.id, uuid: u.uuid, name: u.name, email: u.email}

          _ ->
            nil
        end,
      releaser:
        case r.releaser do
          %Backend.Accounts.User{} = u ->
            %{id: u.id, uuid: u.uuid, name: u.name, email: u.email}

          _ ->
            nil
        end,
      approver:
        case r.approver do
          %Backend.Accounts.User{} = u ->
            %{id: u.id, uuid: u.uuid, name: u.name, email: u.email}

          _ ->
            nil
        end,
      files:
        case r.files do
          list when is_list(list) ->
            Enum.map(list, &Payloads.production_final_release_file/1)

          _ ->
            []
        end
    }
  end

  defp dispatch_payload(%Backend.ThreePL.Dispatch{} = d) do
    %{
      uuid: d.uuid,
      qty: Decimal.to_string(d.qty),
      reference: d.reference,
      notes: d.notes,
      photo_url: d.photo_url,
      dispatched_at: d.dispatched_at,
      dispatched_by:
        case d.dispatched_by do
          %Backend.Accounts.User{} = u ->
            %{id: u.id, uuid: u.uuid, name: u.name, email: u.email}

          _ ->
            nil
        end
    }
  end

  defp bailee_lot_row(%Lot{} = l, rate) do
    volume_m3 = ThreePL.lot_held_volume_m3(l)
    charge = if is_nil(rate), do: nil, else: ThreePL.accrued_charge(l, rate)

    %{
      lot: Payloads.stock_lot(l),
      stored_volume_m3: Decimal.to_string(Decimal.round(volume_m3, 4)),
      days_held: days_since(l.bailee_routed_at),
      accrued_amount:
        case charge do
          nil -> nil
          %Decimal{} = d -> Decimal.to_string(Decimal.round(d, 2))
        end
    }
  end

  defp days_since(nil), do: 0

  defp days_since(%DateTime{} = dt) do
    diff = DateTime.diff(DateTime.utc_now(), dt, :second)
    max(div(diff, 86_400), 0)
  end

  defp decimal_to_string(nil), do: nil
  defp decimal_to_string(%Decimal{} = d), do: Decimal.to_string(d, :normal)

  defp get_lot(company_id, lot_uuid) when is_binary(lot_uuid) do
    case Repo.get_by(Lot, uuid: lot_uuid) do
      %Lot{company_id: ^company_id} = lot -> lot
      _ -> nil
    end
  end

  defp preload_for_payload(%Lot{} = lot) do
    Repo.preload(lot, [
      :item,
      :unit_of_measurement,
      :bailee_customer,
      placements: [storage_cell: [storage_location: [floor: [:warehouse]]]]
    ])
  end

  # ---------------------------------------------------------------
  # Standard error responses (matches ProductionFinalReleaseController)
  # ---------------------------------------------------------------

  defp not_found(conn, detail) do
    conn
    |> put_status(:not_found)
    |> json(Errors.payload("not_found", detail, %{}))
  end

  defp unprocessable(conn, code, detail) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(Errors.payload(code, detail, %{}))
  end

  defp changeset_error(conn, cs) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(
      Errors.payload(
        "validation_failed",
        "One or more fields failed validation.",
        %{fields: format_errors(cs)}
      )
    )
  end

  defp format_errors(cs) do
    Ecto.Changeset.traverse_errors(cs, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc ->
        String.replace(acc, "%{#{k}}", to_string(v))
      end)
    end)
  end
end
