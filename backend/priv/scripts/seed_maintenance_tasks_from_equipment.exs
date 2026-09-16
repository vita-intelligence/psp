# Generates one calibration + one preventive-maintenance task per
# seeded equipment unit whose config carries a cadence. Uses each
# unit's `calibration_frequency_months` / `maintenance_frequency_months`
# to drive the periodicity, and its `acquired_at` as the reference
# point for the first-due date.
#
# Idempotent — task uniqueness is (equipment_id, task_type). We
# skip a unit that already has a task of the same type.
#
# Run with:
#   MIX_ENV=dev mix run priv/scripts/seed_maintenance_tasks_from_equipment.exs

import Ecto.Query

alias Backend.Repo
alias Backend.Equipment.{Equipment, MaintenanceTask, MaintenanceTasks}
alias Backend.Accounts.User

company_id = 1
actor = Repo.get!(User, 1)

units =
  from(e in Equipment,
    where: e.company_id == ^company_id,
    preload: [:item]
  )
  |> Repo.all()

IO.puts("Seeding tasks for #{length(units)} units…")

# Canonical periodicity buckets — anything else falls through to a
# custom `periodicity_interval` (in months).
month_to_periodicity = %{
  1 => "monthly",
  3 => "quarterly",
  6 => "half_yearly",
  12 => "yearly",
  24 => "two_yearly",
  36 => "three_yearly"
}

periodicity_for = fn months ->
  case Map.get(month_to_periodicity, months) do
    nil -> {nil, months}
    str -> {str, nil}
  end
end

existing_task_types =
  from(t in MaintenanceTask,
    select: {t.equipment_id, t.task_type}
  )
  |> Repo.all()
  |> MapSet.new()

item_short = fn unit ->
  cond do
    unit.item && unit.item.name -> unit.item.name
    unit.model -> unit.model
    true -> unit.serial_number
  end
end

today = Date.utc_today()

# Snap first-due into the future so the ledger has a mix — some due
# soon (chosen by hash) but nothing shows as overdue on day one.
snap = fn %Date{} = date ->
  if Date.compare(date, today) == :lt do
    Date.add(today, :rand.uniform(90))
  else
    date
  end
end

push_out = fn %Date{} = acquired, months ->
  Date.add(acquired, months * 30)
end

{cal_added, maint_added, skipped} =
  Enum.reduce(units, {0, 0, 0}, fn unit, {cal, maint, skip} ->
    acquired_date =
      case unit.acquired_at do
        %DateTime{} = dt -> DateTime.to_date(dt)
        _ -> today
      end

    added_cal =
      if unit.calibration_frequency_months &&
           not MapSet.member?(existing_task_types, {unit.id, "calibration"}) do
        {periodicity, interval} =
          periodicity_for.(unit.calibration_frequency_months)

        first_due = snap.(push_out.(acquired_date, unit.calibration_frequency_months))

        attrs = %{
          "task_name" => "Annual calibration — #{item_short.(unit)}",
          "task_type" => "calibration",
          "periodicity" => periodicity,
          "periodicity_interval" => interval,
          "start_date" => Date.to_iso8601(first_due),
          "next_due_date" => Date.to_iso8601(first_due),
          "certificate_required" => true,
          "notes" =>
            "Seeded from equipment cadence config. Adjust or archive as needed."
        }

        case MaintenanceTasks.create(unit, attrs, actor) do
          {:ok, _} -> true
          _ -> false
        end
      else
        false
      end

    added_maint =
      if unit.maintenance_frequency_months &&
           not MapSet.member?(existing_task_types, {unit.id, "preventive"}) do
        {periodicity, interval} =
          periodicity_for.(unit.maintenance_frequency_months)

        first_due = snap.(push_out.(acquired_date, unit.maintenance_frequency_months))

        attrs = %{
          "task_name" => "Preventive service — #{item_short.(unit)}",
          "task_type" => "preventive",
          "periodicity" => periodicity,
          "periodicity_interval" => interval,
          "start_date" => Date.to_iso8601(first_due),
          "next_due_date" => Date.to_iso8601(first_due),
          "certificate_required" => false,
          "notes" =>
            "Seeded from equipment cadence config. Adjust or archive as needed."
        }

        case MaintenanceTasks.create(unit, attrs, actor) do
          {:ok, _} -> true
          _ -> false
        end
      else
        false
      end

    {
      cal + if(added_cal, do: 1, else: 0),
      maint + if(added_maint, do: 1, else: 0),
      skip + if(not added_cal and not added_maint, do: 1, else: 0)
    }
  end)

IO.puts("")
IO.puts("Maintenance-task seed complete:")
IO.puts("  calibration tasks added: #{cal_added}")
IO.puts("  preventive tasks added:  #{maint_added}")
IO.puts("  units skipped (no cadence or tasks already exist): #{skipped}")
