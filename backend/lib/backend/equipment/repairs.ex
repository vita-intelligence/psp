defmodule Backend.Equipment.Repairs do
  @moduledoc """
  Boundary for equipment repair records.

  Creating a repair drops an ``equipment_events`` row of kind
  ``breakdown_reported`` — same pattern as the maintenance-task
  completion, so the timeline stays authoritative for "what
  happened to this asset." Completing the repair drops a
  ``breakdown_resolved`` event and caches ``downtime_minutes`` on
  the repair row.

  Parts are managed independently via ``add_part/3`` / ``remove_part/2``
  — the repair total is a computed sum, we don't cache it (small N,
  no scale concern).
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Equipment.{Equipment, Repair, RepairPart}
  alias Backend.Equipment.Lifecycle
  alias Backend.Repo

  @doc """
  List repairs for a piece of equipment, newest first.
  """
  def list_for_equipment(%Equipment{id: id}) do
    from(r in Repair,
      where: r.equipment_id == ^id,
      order_by: [desc: :failure_date, desc: :id],
      preload: [:assigned_to_user, :parts, [parts: :item]]
    )
    |> Repo.all()
  end

  @doc """
  Fetch one repair by uuid, scoped to the equipment.
  """
  def get_for_equipment(%Equipment{id: eq_id, company_id: cid}, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Repair
        |> where([r], r.equipment_id == ^eq_id and r.company_id == ^cid and r.uuid == ^cast)
        |> preload([:assigned_to_user, :parts, [parts: :item]])
        |> Repo.one()

      _ ->
        nil
    end
  end

  @doc """
  Report a new breakdown. Emits a ``breakdown_reported`` event on the
  equipment timeline in the same transaction so the two records
  can't drift.
  """
  def report(%Equipment{} = equipment, attrs, %User{} = actor) do
    attrs =
      attrs
      |> Map.put("company_id", equipment.company_id)
      |> Map.put("equipment_id", equipment.id)
      |> Map.put("status", "reported")
      |> Map.put("created_by_id", actor.id)
      |> Map.put("updated_by_id", actor.id)

    Repo.transaction(fn ->
      with {:ok, repair} <- %Repair{} |> Repair.changeset(attrs) |> Repo.insert(),
           {:ok, _} <-
             Lifecycle.record_event_in_transaction(
               equipment,
               "note",
               %{
                 actor: actor,
                 reason: Map.get(attrs, "description") || "Breakdown reported",
                 metadata: %{
                   "event_semantic" => "breakdown_reported",
                   "repair_uuid" => repair.uuid,
                   "failure_date" => datetime_iso(Map.get(attrs, "failure_date"))
                 }
               }
             ) do
        repair
      else
        {:error, reason} -> Repo.rollback(reason)
      end
    end)
  end

  @doc """
  Edit fields on an in-progress repair. Status changes to
  ``completed`` route through ``complete/3`` instead (which also
  emits the timeline event + caches downtime).
  """
  def update(%Repair{} = repair, attrs, %User{} = actor) do
    attrs =
      attrs
      |> Map.drop(["company_id", "equipment_id", "created_by_id"])
      |> Map.put("updated_by_id", actor.id)

    repair
    |> Repair.changeset(attrs)
    |> Repo.update()
  end

  @doc """
  Mark the repair complete. Caches downtime_minutes from
  ``failure_date → completion_date``, flips status, and emits a
  ``breakdown_resolved`` event.
  """
  def complete(%Repair{} = repair, attrs, %User{} = actor) do
    repair = Repo.preload(repair, [:equipment, :parts])

    completion =
      Map.get(attrs, "completion_date") ||
        (DateTime.utc_now() |> DateTime.truncate(:second))

    downtime =
      case {repair.failure_date, completion} do
        {%DateTime{} = f, %DateTime{} = c} -> div(DateTime.diff(c, f, :second), 60)
        _ -> nil
      end

    # If the caller didn't specify a repair_cost, roll up the parts
    # total so downstream cost analytics don't ignore the material
    # spend. External labour / vendor invoice can still be added
    # after the fact via `update/3`.
    {cost_fill, currency_fill} = auto_cost_from_parts(repair)

    attrs =
      attrs
      |> maybe_default("repair_cost", cost_fill)
      |> maybe_default("currency", currency_fill)

    patch =
      attrs
      |> Map.drop(["company_id", "equipment_id", "created_by_id"])
      |> Map.put("status", "completed")
      |> Map.put("completion_date", completion)
      |> Map.put("downtime_minutes", downtime)
      |> Map.put("updated_by_id", actor.id)

    Repo.transaction(fn ->
      with {:ok, updated} <- repair |> Repair.changeset(patch) |> Repo.update(),
           {:ok, _} <-
             Lifecycle.record_event_in_transaction(
               repair.equipment,
               "note",
               %{
                 actor: actor,
                 reason: Map.get(attrs, "actions_performed") || "Repair completed",
                 metadata: %{
                   "event_semantic" => "breakdown_resolved",
                   "repair_uuid" => updated.uuid,
                   "downtime_minutes" => downtime,
                   "repair_cost" => decimal_to_string(updated.repair_cost),
                   "currency" => updated.currency
                 }
               }
             ) do
        updated
      else
        {:error, reason} -> Repo.rollback(reason)
      end
    end)
  end

  # ── parts ────────────────────────────────────────────────────────

  @doc """
  Attach a spare / consumable line to a repair. Item + qty required;
  unit_cost is optional (leave null until the vendor invoice lands).
  """
  def add_part(%Repair{} = repair, attrs, %User{} = actor) do
    attrs =
      attrs
      |> Map.put("company_id", repair.company_id)
      |> Map.put("repair_id", repair.id)
      |> Map.put("created_by_id", actor.id)

    %RepairPart{}
    |> RepairPart.changeset(attrs)
    |> Repo.insert()
  end

  def remove_part(%RepairPart{} = part) do
    Repo.delete(part)
  end

  def get_part(%Repair{id: repair_id}, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        RepairPart
        |> where([p], p.repair_id == ^repair_id and p.uuid == ^cast)
        |> Repo.one()

      _ ->
        nil
    end
  end

  # ── helpers ─────────────────────────────────────────────────────

  defp datetime_iso(%DateTime{} = dt), do: DateTime.to_iso8601(dt)
  defp datetime_iso(str) when is_binary(str), do: str
  defp datetime_iso(_), do: nil

  defp decimal_to_string(nil), do: nil
  defp decimal_to_string(%Decimal{} = d), do: Decimal.to_string(d)
  defp decimal_to_string(other), do: to_string(other)

  # Sum(quantity * unit_cost) across parts with a unit_cost set.
  # Returns {cost_string_or_nil, currency_string_or_nil} — the
  # currency defaults to the first part that carries one, which is
  # the pragmatic choice when parts are all sourced in one currency
  # (the common case). A mixed-currency repair is not something we
  # handle here — the operator can override on complete.
  defp auto_cost_from_parts(%Repair{parts: parts}) when is_list(parts) do
    priced =
      parts
      |> Enum.filter(fn p ->
        match?(%Decimal{}, p.unit_cost) and match?(%Decimal{}, p.quantity)
      end)

    case priced do
      [] ->
        {nil, nil}

      _ ->
        total =
          Enum.reduce(priced, Decimal.new(0), fn p, acc ->
            Decimal.add(acc, Decimal.mult(p.unit_cost, p.quantity))
          end)

        currency =
          priced
          |> Enum.map(& &1.currency)
          |> Enum.find(&(&1 not in [nil, ""]))

        {Decimal.to_string(total), currency}
    end
  end

  defp auto_cost_from_parts(_), do: {nil, nil}

  defp maybe_default(attrs, _key, nil), do: attrs

  defp maybe_default(attrs, key, value) do
    case Map.get(attrs, key) do
      v when v in [nil, ""] -> Map.put(attrs, key, value)
      _ -> attrs
    end
  end
end
