defmodule Backend.Equipment.MaintenanceTasks do
  @moduledoc """
  Boundary for equipment maintenance / calibration tasks.

  Task lifecycle is not status-driven — a task is either active or
  inactive. Completion is an EVENT: we bump `last_completion_date`,
  recompute `next_due_date` from the periodicity, and drop an
  `equipment_events` row of kind ``note`` with
  `metadata.event_semantic = "maintenance_completed"` (routine
  clean / lubricate) or ``"calibration_completed"`` (calibration
  task) so the main timeline still tells the full story. Kind
  ``note`` is universally allowed by the lifecycle state machine.

  ## Periodicity → interval-in-months

  Mirrors ERPNext's Asset Maintenance Task cadence list. Custom
  intervals go through ``periodicity_interval`` (integer months);
  when a task has both a canonical `periodicity` string and an
  interval, the interval wins.
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Equipment.{Equipment, MaintenanceTask}
  alias Backend.Equipment.Lifecycle
  alias Backend.Repo

  @periodicity_months %{
    "daily" => 0,
    "weekly" => 0,
    "monthly" => 1,
    "quarterly" => 3,
    "half_yearly" => 6,
    "yearly" => 12,
    "two_yearly" => 24,
    "three_yearly" => 36
  }

  @doc """
  List tasks for a piece of equipment, active first, then by
  ``next_due_date`` ascending so overdue rows surface at the top.
  """
  def list_for_equipment(%Equipment{id: id}) do
    from(t in MaintenanceTask,
      where: t.equipment_id == ^id,
      order_by: [desc: t.is_active, asc: :next_due_date, asc: :id],
      preload: [:assigned_to_user, :created_by, :updated_by]
    )
    |> Repo.all()
  end

  @doc """
  Fetch one task by uuid, scoped to the equipment (so a rogue task
  uuid from another asset returns 404).
  """
  def get_for_equipment(%Equipment{id: eq_id, company_id: cid}, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        MaintenanceTask
        |> where([t], t.equipment_id == ^eq_id and t.company_id == ^cid and t.uuid == ^cast)
        |> preload([:assigned_to_user, :created_by, :updated_by])
        |> Repo.one()

      _ ->
        nil
    end
  end

  @doc """
  Create a task for `equipment`. Computes an initial `next_due_date`
  from `start_date + periodicity` when both are given.
  """
  def create(%Equipment{} = equipment, attrs, %User{} = actor) do
    attrs =
      attrs
      |> Map.put("company_id", equipment.company_id)
      |> Map.put("equipment_id", equipment.id)
      |> Map.put("created_by_id", actor.id)
      |> Map.put("updated_by_id", actor.id)
      |> maybe_seed_next_due()

    Repo.transaction(fn ->
      case %MaintenanceTask{}
           |> MaintenanceTask.changeset(attrs)
           |> Repo.insert() do
        {:ok, task} ->
          recompute_next_due_cache(equipment.id)
          task

        {:error, changeset} ->
          Repo.rollback(changeset)
      end
    end)
  end

  @doc """
  Edit `task`. Rejects any change to the immutable identity fields
  (company/equipment). Recomputes `next_due_date` when the
  periodicity or start_date shifts.
  """
  def update(%MaintenanceTask{} = task, attrs, %User{} = actor) do
    attrs =
      attrs
      |> Map.drop(["company_id", "equipment_id", "created_by_id"])
      |> Map.put("updated_by_id", actor.id)
      |> maybe_recompute_next_due(task)

    Repo.transaction(fn ->
      case task |> MaintenanceTask.changeset(attrs) |> Repo.update() do
        {:ok, updated} ->
          recompute_next_due_cache(task.equipment_id)
          updated

        {:error, changeset} ->
          Repo.rollback(changeset)
      end
    end)
  end

  @doc """
  Soft-delete a task by flipping ``is_active`` to false. Hard-delete
  is intentionally not exposed — history value.
  """
  def deactivate(%MaintenanceTask{} = task, %User{} = actor) do
    Repo.transaction(fn ->
      case task
           |> MaintenanceTask.changeset(%{
             "is_active" => false,
             "updated_by_id" => actor.id
           })
           |> Repo.update() do
        {:ok, updated} ->
          recompute_next_due_cache(task.equipment_id)
          updated

        {:error, changeset} ->
          Repo.rollback(changeset)
      end
    end)
  end

  @doc """
  Mark a task as completed on ``completed_on``. Bumps
  ``last_completion_date``, recomputes ``next_due_date``, and drops
  a matching event on the equipment timeline (so operators reading
  the events feed still see the full history).

  ``opts`` may carry ``:reason`` (free-text why-note) and
  ``:evidence_urls`` (list of certificate / attachment URLs) —
  both land in the event's metadata JSONB.
  """
  def complete(%MaintenanceTask{} = task, %User{} = actor, opts \\ []) do
    completed_on = Keyword.get(opts, :completed_on, Date.utc_today())
    reason = Keyword.get(opts, :reason, "")
    evidence = Keyword.get(opts, :evidence_urls, [])

    # BRCGS / FSSC guardrail — a task flagged
    # `certificate_required` cannot be closed without at least one
    # piece of evidence attached. Auditors on the manufacturing
    # side ask "prove the calibration happened" and the answer
    # needs to survive a scheduled walkthrough.
    if task.certificate_required and evidence == [] do
      {:error, :certificate_required}
    else
      do_complete(task, actor, completed_on, reason, evidence)
    end
  end

  defp do_complete(%MaintenanceTask{} = task, %User{} = actor, completed_on, reason, evidence) do
    task = Repo.preload(task, :equipment)

    Repo.transaction(fn ->
      # 1. Bump the task's cadence trackers.
      next_due = compute_next_due(completed_on, task.periodicity, task.periodicity_interval)

      task_result =
        task
        |> MaintenanceTask.changeset(%{
          "last_completion_date" => completed_on,
          "next_due_date" => next_due,
          "updated_by_id" => actor.id
        })
        |> Repo.update()

      case task_result do
        {:ok, updated_task} ->
          # 2. Emit a timeline event so the main equipment history
          #    reads coherently. Kind is ``note`` (allowed from every
          #    lifecycle status) with structured metadata carrying
          #    the actual semantic — the FE renders differently on
          #    ``metadata.event_semantic``.
          event_semantic =
            if task.task_type == "calibration",
              do: "calibration_completed",
              else: "maintenance_completed"

          event_reason =
            if reason != "",
              do: reason,
              else: "Task '#{task.task_name}' completed"

          case Lifecycle.record_event_in_transaction(
                 task.equipment,
                 "note",
                 %{
                   actor: actor,
                   reason: event_reason,
                   metadata: %{
                     "event_semantic" => event_semantic,
                     "task_uuid" => updated_task.uuid,
                     "task_name" => updated_task.task_name,
                     "task_type" => updated_task.task_type,
                     "completed_on" => Date.to_iso8601(completed_on),
                     "evidence_urls" => evidence
                   }
                 }
               ) do
            {:ok, _} ->
              # Refresh the unit-level cadence cache so the ledger's
              # "next calibration" / "next maintenance" columns
              # reflect the newly-bumped due date. Runs inside the
              # same transaction as the task update + event write.
              recompute_next_due_cache(task.equipment_id)
              updated_task

            {:error, reason} -> Repo.rollback(reason)
            {:error, :illegal_transition, info} -> Repo.rollback({:illegal_transition, info})
          end

        {:error, cs} ->
          Repo.rollback(cs)
      end
    end)
  end

  # ── periodicity math ─────────────────────────────────────────────

  defp maybe_seed_next_due(attrs) do
    cond do
      Map.has_key?(attrs, "next_due_date") and attrs["next_due_date"] not in [nil, ""] ->
        attrs

      Map.has_key?(attrs, "start_date") and attrs["start_date"] not in [nil, ""] ->
        Map.put(attrs, "next_due_date", attrs["start_date"])

      true ->
        attrs
    end
  end

  defp maybe_recompute_next_due(attrs, %MaintenanceTask{} = current) do
    changed_periodicity? =
      Map.has_key?(attrs, "periodicity") or Map.has_key?(attrs, "periodicity_interval")

    if changed_periodicity? and current.last_completion_date do
      next =
        compute_next_due(
          current.last_completion_date,
          Map.get(attrs, "periodicity", current.periodicity),
          Map.get(attrs, "periodicity_interval", current.periodicity_interval)
        )

      Map.put(attrs, "next_due_date", next)
    else
      attrs
    end
  end

  @doc """
  Compute the next due date from a base date + periodicity. Public
  so tests + admin scripts can reuse the same math the completion
  path uses.
  """
  def compute_next_due(nil, _, _), do: nil

  def compute_next_due(%Date{} = base, periodicity, interval) do
    cond do
      is_integer(interval) and interval > 0 -> Date.add(base, interval * 30)
      periodicity == "daily" -> Date.add(base, 1)
      periodicity == "weekly" -> Date.add(base, 7)
      match?(%_{}, Map.get(@periodicity_months, periodicity)) -> base
      is_integer(Map.get(@periodicity_months, periodicity)) ->
        months = Map.fetch!(@periodicity_months, periodicity)
        Date.add(base, months * 30)
      true -> nil
    end
  end

  # ── unit-level cache ─────────────────────────────────────────────
  #
  # The ledger (`/equipment`) columns `next_calibration_at` +
  # `next_maintenance_at` are the source of truth for sort / filter /
  # due-soon dashboard. They cache the earliest `next_due_date` from
  # active tasks on the unit, split by whether the task is a
  # calibration or anything else. Recomputed on every task write —
  # ledger and tasks card never drift.
  #
  # Cost is one indexed scan per equipment; cheap enough to run
  # synchronously in the same transaction as the write.

  @doc """
  Refresh the unit-level next-due cache from the current active task
  list. Safe to call from any write path that touches maintenance
  tasks. Called after create / update / complete / deactivate.
  """
  def recompute_next_due_cache(equipment_id) when is_integer(equipment_id) do
    next_cal_date =
      from(t in MaintenanceTask,
        where:
          t.equipment_id == ^equipment_id and
            t.is_active == true and
            t.task_type == "calibration" and
            not is_nil(t.next_due_date),
        select: min(t.next_due_date)
      )
      |> Repo.one()

    next_maint_date =
      from(t in MaintenanceTask,
        where:
          t.equipment_id == ^equipment_id and
            t.is_active == true and
            t.task_type != "calibration" and
            not is_nil(t.next_due_date),
        select: min(t.next_due_date)
      )
      |> Repo.one()

    # Same partition for the "last done" mirrors — cached so the
    # equipment payload + ledger cards don't need to join tasks on
    # every read. Uses max() so a task completed today wins over a
    # task from six months ago.
    last_cal_date =
      from(t in MaintenanceTask,
        where:
          t.equipment_id == ^equipment_id and
            t.task_type == "calibration" and
            not is_nil(t.last_completion_date),
        select: max(t.last_completion_date)
      )
      |> Repo.one()

    last_maint_date =
      from(t in MaintenanceTask,
        where:
          t.equipment_id == ^equipment_id and
            t.task_type != "calibration" and
            not is_nil(t.last_completion_date),
        select: max(t.last_completion_date)
      )
      |> Repo.one()

    from(e in Equipment, where: e.id == ^equipment_id)
    |> Repo.update_all(
      set: [
        next_calibration_at: to_utc(next_cal_date),
        next_maintenance_at: to_utc(next_maint_date),
        last_calibrated_at: to_utc(last_cal_date),
        last_maintenance_at: to_utc(last_maint_date),
        updated_at: DateTime.utc_now() |> DateTime.truncate(:second)
      ]
    )

    :ok
  end

  defp to_utc(nil), do: nil
  defp to_utc(%Date{} = d),
    do: DateTime.new!(d, ~T[00:00:00], "Etc/UTC") |> DateTime.truncate(:second)
end
