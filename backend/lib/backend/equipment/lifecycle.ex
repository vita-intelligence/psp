defmodule Backend.Equipment.Lifecycle do
  @moduledoc """
  Equipment lifecycle state machine. Same shape as
  `Backend.Stock.Lifecycle` for stock lots — operators trigger
  ACTIONS (event kinds), the unit's `status` is a projection of
  the recorded event list.

  ## Allowed transitions

    * `expected`             → received | note | canceled
    * `received`             → in_service | note | retired | disposed
    * `in_service`           → maintenance_started | moved | assigned |
                                unassigned | calibrated | retired |
                                disposed | note
    * `under_maintenance`    → maintenance_completed | disposed | note
    * `awaiting_calibration` → calibrated | disposed | note
    * `out_for_repair`       → maintenance_completed | disposed | note
    * `retired`              → disposed | note
    * `disposed`             → note (terminal for physical actions)

  Any (status, kind) pair not in the matrix returns
  `{:error, :illegal_transition, %{from:, kind:, allowed:}}`.

  ## Status projection

    * `disposed` and `retired` are terminal-ish — later kinds only
      move to `disposed` (from retired) or `note` (from either).
    * `calibrated` from `awaiting_calibration` → `in_service`; from
      `in_service` stays in_service (routine cal, no status flip).
    * `maintenance_completed` → `awaiting_calibration` when the unit
      has a calibration cadence, else straight to `in_service`. (The
      cal cadence check runs in PR E4 which owns the cadence
      machinery; for now this module just returns `in_service`.)
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Equipment.{Equipment, Event}
  alias Backend.Repo

  @allowed_transitions %{
    "expected" => ~w(received note canceled),
    "received" => ~w(in_service note retired disposed),
    "in_service" =>
      ~w(maintenance_started moved assigned unassigned calibrated retired disposed note),
    "under_maintenance" => ~w(maintenance_completed disposed note),
    "awaiting_calibration" => ~w(calibrated disposed note),
    "out_for_repair" => ~w(maintenance_completed disposed note),
    "retired" => ~w(disposed note),
    "disposed" => ~w(note)
  }

  def allowed_transitions, do: @allowed_transitions

  @doc """
  Wraps in a transaction, validates the transition, writes the
  event, recomputes the projected status. Returns the updated
  equipment struct.
  """
  def record_event(%Equipment{} = equipment, kind, attrs)
      when is_binary(kind) and is_map(attrs) do
    with :ok <- ensure_allowed(equipment.status, kind) do
      Repo.transaction(fn ->
        case record_event_in_transaction(equipment, kind, attrs) do
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
    end
  end

  @doc """
  Same as `record_event/3` but assumes the caller already opened
  a `Repo.transaction/1`. Used by the create flow so the initial
  `received` event is written in the same transaction as the
  equipment row itself.
  """
  def record_event_in_transaction(%Equipment{} = equipment, kind, attrs)
      when is_binary(kind) and is_map(attrs) do
    case ensure_allowed(equipment.status, kind) do
      :ok ->
        with {:ok, event} <- insert_event(equipment, kind, attrs),
             events = list_events_raw(equipment.id),
             next_status = project_status(events),
             {:ok, updated_equipment} <- update_equipment_status(equipment, next_status),
             {:ok, updated_equipment} <-
               apply_terminal_timestamps(updated_equipment, kind, event.occurred_at),
             {:ok, updated_equipment} <-
               apply_cadence_updates(updated_equipment, kind, event.occurred_at) do
          {:ok, %{equipment: updated_equipment, event: event, status: next_status}}
        end

      other ->
        other
    end
  end

  @doc """
  Pure projection — takes a list of events (ascending) and returns
  the projected status string. Deterministic; no DB access.

  Rules:

    * `canceled` beats everything (voided before receipt).
    * `disposed` beats everything except cancel.
    * `retired` beats everything except cancel + disposed.
    * The last `maintenance_started` / `maintenance_completed`
      determines under_maintenance vs post-maintenance.
    * Latest of `calibrated` / (cal-awaiting return) is respected.
    * Otherwise: latest of received / in_service / moved / assigned /
      unassigned governs the current base state, falling back to
      `expected`.
  """
  def project_status(events) when is_list(events) do
    kinds = MapSet.new(events, & &1.kind)

    cond do
      MapSet.member?(kinds, "canceled") ->
        "canceled"

      MapSet.member?(kinds, "disposed") ->
        "disposed"

      MapSet.member?(kinds, "retired") ->
        "retired"

      true ->
        last_service_shape(events)
    end
  end

  # Rank the "service shape" events by occurred_at desc, first
  # relevant match wins.
  defp last_service_shape(events) do
    ranked =
      events
      |> Enum.filter(fn e ->
        e.kind in [
          "received",
          "in_service",
          "maintenance_started",
          "maintenance_completed",
          "calibrated",
          "moved",
          "assigned",
          "unassigned"
        ]
      end)
      |> Enum.sort_by(fn e -> {ts(e.occurred_at), ts(e.inserted_at), e.id} end, :desc)

    Enum.reduce_while(ranked, "expected", fn e, _ ->
      case e.kind do
        "maintenance_started" -> {:halt, "under_maintenance"}
        "maintenance_completed" -> {:halt, "in_service"}
        "in_service" -> {:halt, "in_service"}
        # `calibrated` alone doesn't imply in_service — the equipment
        # may still be in maintenance; keep looking.
        "calibrated" -> {:cont, "in_service"}
        # `moved` / `assigned` / `unassigned` don't change base
        # status; keep looking for a real state event.
        "moved" -> {:cont, "in_service"}
        "assigned" -> {:cont, "in_service"}
        "unassigned" -> {:cont, "in_service"}
        "received" -> {:halt, "received"}
        _ -> {:cont, "expected"}
      end
    end)
  end

  defp insert_event(%Equipment{} = equipment, kind, attrs) do
    actor = Map.get(attrs, :actor) || Map.get(attrs, "actor")
    actor_kind = Map.get(attrs, :actor_kind) || Map.get(attrs, "actor_kind") || "user"
    occurred_at = Map.get(attrs, :occurred_at) || Map.get(attrs, "occurred_at") ||
                    DateTime.utc_now() |> DateTime.truncate(:second)

    %Event{}
    |> Event.changeset(%{
      "uuid" => Ecto.UUID.generate(),
      "company_id" => equipment.company_id,
      "equipment_id" => equipment.id,
      "kind" => kind,
      "actor_kind" => actor_kind,
      "actor_id" => actor && Map.get(actor, :id),
      "reason" => Map.get(attrs, :reason) || Map.get(attrs, "reason"),
      "metadata" => Map.get(attrs, :metadata) || Map.get(attrs, "metadata") || %{},
      "from_cell_id" => Map.get(attrs, :from_cell_id) || Map.get(attrs, "from_cell_id"),
      "to_cell_id" => Map.get(attrs, :to_cell_id) || Map.get(attrs, "to_cell_id"),
      "assigned_to_user_id" =>
        Map.get(attrs, :assigned_to_user_id) || Map.get(attrs, "assigned_to_user_id"),
      "occurred_at" => occurred_at
    })
    |> Repo.insert()
  end

  defp update_equipment_status(%Equipment{status: current} = equipment, next_status)
       when current == next_status do
    {:ok, equipment}
  end

  defp update_equipment_status(%Equipment{} = equipment, next_status) do
    equipment
    |> Equipment.projected_status_changeset(next_status)
    |> Repo.update()
  end

  # Terminal-timestamp side effects — retired_at / disposed_at get
  # first-class columns on equipment so reports don't have to
  # walk the event log.
  defp apply_terminal_timestamps(%Equipment{} = equipment, "retired", occurred_at) do
    equipment
    |> Ecto.Changeset.change(retired_at: to_utc(occurred_at))
    |> Repo.update()
  end

  defp apply_terminal_timestamps(%Equipment{} = equipment, "disposed", occurred_at) do
    equipment
    |> Ecto.Changeset.change(disposed_at: to_utc(occurred_at))
    |> Repo.update()
  end

  defp apply_terminal_timestamps(equipment, _kind, _occurred_at), do: {:ok, equipment}

  # Cadence auto-compute — when the operator records a
  # `calibrated` or `maintenance_completed` event, roll the
  # `last_*_at` timestamp to the event's occurred_at and derive
  # `next_*_at` from the configured cadence. If the unit has no
  # cadence configured, `last_*_at` still updates but `next_*_at`
  # stays nil (nothing to schedule).
  defp apply_cadence_updates(%Equipment{} = equipment, "calibrated", occurred_at) do
    at = to_utc(occurred_at)
    next = add_months(at, equipment.calibration_frequency_months)

    equipment
    |> Ecto.Changeset.change(last_calibrated_at: at, next_calibration_at: next)
    |> Repo.update()
  end

  defp apply_cadence_updates(%Equipment{} = equipment, "maintenance_completed", occurred_at) do
    at = to_utc(occurred_at)
    next = add_months(at, equipment.maintenance_frequency_months)

    equipment
    |> Ecto.Changeset.change(last_maintenance_at: at, next_maintenance_at: next)
    |> Repo.update()
  end

  defp apply_cadence_updates(equipment, _kind, _occurred_at), do: {:ok, equipment}

  # Simple "months from timestamp" calculator — good enough for the
  # scheduling posture BRCGS wants. Not calendar-perfect (a 31 May
  # + 1 month lands on 30 Jun / 1 Jul depending on the OS), but
  # rounding within a day at the schedule-in-months scale is
  # meaningless. Nil months → nil result (no cadence configured).
  defp add_months(_at, nil), do: nil
  defp add_months(_at, months) when months <= 0, do: nil

  defp add_months(%DateTime{} = at, months) when is_integer(months) do
    seconds_in_month = 30 * 24 * 60 * 60
    DateTime.add(at, months * seconds_in_month, :second)
  end

  defp list_events_raw(equipment_id) do
    from(e in Event,
      where: e.equipment_id == ^equipment_id,
      order_by: [asc: e.occurred_at, asc: e.id]
    )
    |> Repo.all()
  end

  defp ensure_allowed(current_status, kind) do
    allowed = Map.get(@allowed_transitions, current_status, [])

    if kind in allowed do
      :ok
    else
      {:error, :illegal_transition,
       %{from: current_status, kind: kind, allowed: allowed}}
    end
  end

  defp to_utc(%DateTime{} = dt), do: dt
  defp to_utc(%NaiveDateTime{} = ndt), do: DateTime.from_naive!(ndt, "Etc/UTC")
  defp to_utc(_), do: DateTime.utc_now() |> DateTime.truncate(:second)

  defp ts(nil), do: 0
  defp ts(%DateTime{} = dt), do: DateTime.to_unix(dt, :microsecond)

  defp ts(%NaiveDateTime{} = ndt),
    do: ndt |> DateTime.from_naive!("Etc/UTC") |> DateTime.to_unix(:microsecond)
end
