defmodule Backend.Stock.Lifecycle do
  @moduledoc """
  Lot lifecycle state machine. Workers trigger ACTIONS (event kinds);
  the lot's `status` is a projection of the recorded event list.

  Two entry points:

    * `record_event/4` — top-level: validates the transition, opens a
      transaction, writes the event row, recomputes the projected
      status, updates the lot. Returns the freshly preloaded lot or a
      structured error.

    * `record_event_in_transaction/3` — inner: assumes the caller is
      already inside `Repo.transaction/1` (the manual receive + PO
      receive flows are). Skips the wrapping transaction so a single
      receive can write the lot + placement + movement + event as one
      atomic unit.

  Read paths:

    * `project_status/1` — pure: takes a list of events and returns the
      projected status atom. Order-independent for terminal kinds
      (canceled > disposed > depleted) but rank-sensitive for the
      QC trio (held after release vs released after hold).

    * `list_events/2` — paginated timeline for the lot detail page +
      QC / hold history endpoints.

  Allowed-from matrix lives in `@allowed_transitions`. Any (from-status,
  event-kind) pair not in the matrix returns `{:error, :illegal_transition}`
  with a structured error payload the controller maps to HTTP 422.
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Repo
  alias Backend.Stock.{Lot, LotEvent}

  # The state machine. Each key is the lot's current status; the value
  # is the list of event kinds the system can record from there. The
  # matrix is the contract — adding a new lifecycle action requires
  # adding the rows here so the rejection error message stays helpful.
  #
  # The first event on a newly-inserted lot is the lot's "birth"
  # declaration — `expected` from a PO line, `received` from a manual
  # receive (lots land at status `expected` and the receive event
  # promotes them in the same transaction). So `expected` and
  # `received` both appear as legal-from-`expected` to cover both
  # bootstrap paths.
  #
  # `expected` ⇒ expected|requested|received|canceled — planned lot
  #               can self-declare on first insert, slide to requested
  #               (paperwork-only), promote to received on receipt, or
  #               be voided.
  # `requested` ⇒ received|canceled — paperwork landed, waiting for
  #               physical receipt or cancellation.
  # `received` ⇒ routed_to_quarantine|qc_passed|qc_failed|held|disposed|
  #              consumed_to_zero|canceled — full open palette once
  #              goods physically land.
  # `quarantine` ⇒ qc_passed|qc_failed|held|disposed|canceled — QC
  #                workflow runs to completion or the lot gets held
  #                pending more information.
  # `available` ⇒ held|disposed|consumed_to_zero — happy-path stock,
  #               can pause, write off, or burn down.
  # `on_hold` ⇒ released|disposed|consumed_to_zero — held stock can be
  #             released back to available or written off.
  # `rejected` ⇒ disposed — failed QC is a one-way door; the only
  #              follow-up is dispose. No "un-fail" event by design.
  # Terminal states (`depleted`, `disposed`, `canceled`) accept no
  # further events.
  @allowed_transitions %{
    "expected" => ~w(expected requested received canceled),
    "requested" => ~w(received canceled),
    "received" => ~w(routed_to_quarantine qc_passed qc_failed held disposed consumed_to_zero canceled),
    "quarantine" => ~w(qc_passed qc_failed held disposed canceled),
    "available" => ~w(held disposed consumed_to_zero),
    "on_hold" => ~w(released disposed consumed_to_zero),
    "rejected" => ~w(disposed),
    "depleted" => [],
    "disposed" => [],
    "canceled" => []
  }

  def allowed_transitions, do: @allowed_transitions

  @doc """
  Top-level: validate the transition, write the event row, recompute
  the lot's status. Wraps in a transaction so an event write that
  passes validation but fails the DB constraint rolls the projection
  update back too.

  `attrs`:

      %{
        actor: %User{},          # required when actor_kind == "user"
        actor_kind: "user",      # default
        reason: nil | binary,
        metadata: %{},
        evidence_file_id: nil | integer,
        occurred_at: nil | DateTime.t()   # defaults to now
      }

  Returns:

    * `{:ok, %{lot: lot, event: event, status: status}}`
    * `{:error, :illegal_transition, %{from: from, kind: kind, allowed: list}}`
    * `{:error, %Ecto.Changeset{}}`
  """
  def record_event(%Lot{} = lot, kind, attrs) when is_binary(kind) and is_map(attrs) do
    case ensure_allowed(lot.status, kind) do
      :ok ->
        Repo.transaction(fn ->
          case record_event_in_transaction(lot, kind, attrs) do
            {:ok, result} ->
              result

            {:error, :illegal_transition, info} ->
              Repo.rollback({:illegal_transition, info})

            {:error, %Ecto.Changeset{} = cs} ->
              Repo.rollback(cs)

            {:error, reason} ->
              Repo.rollback(reason)
          end
        end)
        |> case do
          {:ok, result} -> {:ok, result}
          {:error, {:illegal_transition, info}} -> {:error, :illegal_transition, info}
          {:error, other} -> {:error, other}
        end

      {:error, :illegal_transition, info} ->
        {:error, :illegal_transition, info}
    end
  end

  @doc """
  Inner: skip the outer transaction wrapper because the caller owns it.

  Used by `Backend.Stock.receive_lot/3` and the PO-receive path so the
  lot + placement + movement + event all land or all rollback together.
  Validation is identical to `record_event/3`.

  Returns:
    * `{:ok, %{lot: lot, event: event, status: status}}`
    * `{:error, :illegal_transition, %{from:, kind:, allowed:}}`
    * `{:error, %Ecto.Changeset{}}`
  """
  def record_event_in_transaction(%Lot{} = lot, kind, attrs)
      when is_binary(kind) and is_map(attrs) do
    case ensure_allowed(lot.status, kind) do
      :ok ->
        with {:ok, event} <- insert_event(lot, kind, attrs),
             events = list_events_raw(lot.id),
             next_status = project_status(events),
             {:ok, updated_lot} <- update_lot_status(lot, next_status) do
          {:ok, %{lot: updated_lot, event: event, status: next_status}}
        end

      other ->
        other
    end
  end

  @doc """
  Pure projection. Replays the event list and returns the lot's
  current status as a string. Sort order doesn't matter for terminal
  events — `canceled > disposed > depleted > rejected` always wins;
  for `available` vs `on_hold` the most recent of `qc_passed | held |
  released` decides.

  The function is the single source of truth. The `stock_lot.status`
  column is the cached projection, refreshed on every event write.
  """
  def project_status(events) when is_list(events) do
    kinds = MapSet.new(events, & &1.kind)
    last_qc_or_hold = last_qc_or_hold_event(events)

    cond do
      MapSet.member?(kinds, "canceled") -> "canceled"
      MapSet.member?(kinds, "disposed") -> "disposed"
      MapSet.member?(kinds, "consumed_to_zero") -> "depleted"
      MapSet.member?(kinds, "qc_failed") -> "rejected"
      last_qc_or_hold == "held" -> "on_hold"
      last_qc_or_hold in ["qc_passed", "released"] -> "available"
      MapSet.member?(kinds, "routed_to_quarantine") -> "quarantine"
      MapSet.member?(kinds, "received") -> "received"
      MapSet.member?(kinds, "requested") -> "requested"
      MapSet.member?(kinds, "expected") -> "expected"
      true -> "expected"
    end
  end

  @doc """
  Convenience: project from the lot itself by re-fetching its events.
  Useful in tests + the QC backfill script; production paths take the
  events they already loaded and call `project_status/1` directly.
  """
  def project_status_for_lot(%Lot{id: id}) do
    project_status(list_events_raw(id))
  end

  @doc """
  Paginated event timeline for one lot. Returns events newest-first
  with the actor preloaded so the FE can render the avatar + name in
  one round-trip.
  """
  def list_events(%Lot{id: lot_id}, opts \\ []) do
    limit = Keyword.get(opts, :limit, 100) |> min(500)

    from(e in LotEvent,
      where: e.stock_lot_id == ^lot_id,
      order_by: [desc: e.occurred_at, desc: e.id],
      preload: [:actor, :evidence_file],
      limit: ^limit
    )
    |> Repo.all()
  end

  ## ----- internals --------------------------------------------------

  # The "last hold or QC verdict" decides on_hold vs available. We
  # sort by occurred_at desc and pick the most recent of the three
  # kinds; everything else is irrelevant to that branch.
  defp last_qc_or_hold_event(events) do
    events
    |> Enum.filter(fn e -> e.kind in ["qc_passed", "held", "released"] end)
    |> Enum.sort_by(fn e -> {ts(e.occurred_at), ts(e.inserted_at), e.id} end, :desc)
    |> case do
      [] -> nil
      [latest | _] -> latest.kind
    end
  end

  defp ts(nil), do: 0
  defp ts(%DateTime{} = dt), do: DateTime.to_unix(dt, :microsecond)
  defp ts(%NaiveDateTime{} = ndt), do: ndt |> DateTime.from_naive!("Etc/UTC") |> DateTime.to_unix(:microsecond)

  defp ensure_allowed(current_status, kind) do
    allowed = Map.get(@allowed_transitions, current_status, [])

    if kind in allowed do
      :ok
    else
      {:error, :illegal_transition,
       %{from: current_status, kind: kind, allowed: allowed}}
    end
  end

  defp insert_event(%Lot{} = lot, kind, attrs) do
    actor = Map.get(attrs, :actor) || Map.get(attrs, "actor")
    actor_kind = Map.get(attrs, :actor_kind) || Map.get(attrs, "actor_kind") || "user"
    reason = Map.get(attrs, :reason) || Map.get(attrs, "reason")
    metadata = Map.get(attrs, :metadata) || Map.get(attrs, "metadata") || %{}

    evidence_file_id =
      Map.get(attrs, :evidence_file_id) || Map.get(attrs, "evidence_file_id")

    occurred_at =
      Map.get(attrs, :occurred_at) || Map.get(attrs, "occurred_at") || DateTime.utc_now()

    actor_id =
      case actor do
        %User{id: id} -> id
        nil -> nil
        id when is_integer(id) -> id
      end

    %LotEvent{}
    |> LotEvent.changeset(%{
      "company_id" => lot.company_id,
      "stock_lot_id" => lot.id,
      "kind" => kind,
      "actor_id" => actor_id,
      "actor_kind" => actor_kind,
      "reason" => reason,
      "metadata" => stringify_metadata(metadata),
      "evidence_file_id" => evidence_file_id,
      "occurred_at" => occurred_at
    })
    |> Repo.insert()
  end

  # The metadata column is a jsonb map — coerce keys to strings so the
  # roundtrip via Postgres + Jason doesn't surprise readers expecting
  # the same keys back.
  defp stringify_metadata(map) when is_map(map) do
    Map.new(map, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      pair -> pair
    end)
  end

  defp stringify_metadata(_), do: %{}

  defp list_events_raw(lot_id) do
    from(e in LotEvent,
      where: e.stock_lot_id == ^lot_id,
      order_by: [asc: e.occurred_at, asc: e.id]
    )
    |> Repo.all()
  end

  defp update_lot_status(%Lot{status: status} = lot, status), do: {:ok, lot}

  defp update_lot_status(%Lot{} = lot, new_status) do
    lot
    |> Lot.projected_status_changeset(new_status)
    |> Repo.update()
  end
end
