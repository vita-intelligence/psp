defmodule Backend.Repo.Migrations.CreateEmployeeShifts do
  use Ecto.Migration

  @moduledoc """
  Mirror of vita-performance's `worker_shifts` — a worker's clock-in /
  clock-out window on the personal kiosk. vp pushes each shift via
  `POST /api/integration/hr/employees/:employee_uuid/shifts` on
  close (and open, if we want a "currently clocked in" projection).

  `external_id` is unique per company so a retry from vp's outbox
  returns the existing row rather than duplicating. `ended_at` is
  nullable — an open shift has no clock-out yet; the row will be
  updated in place when the worker clocks out (same external_id).
  """

  def change do
    create table(:employee_shifts) do
      add :uuid, :uuid, null: false
      add :external_id, :string
      add :started_at, :utc_datetime, null: false
      add :ended_at, :utc_datetime
      add :duration_seconds, :integer
      add :device_id, :string
      add :notes, :text

      add :company_id,
          references(:companies, on_delete: :delete_all),
          null: false

      add :employee_id,
          references(:employees, on_delete: :delete_all),
          null: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:employee_shifts, [:uuid])

    create unique_index(:employee_shifts, [:company_id, :external_id],
             where: "external_id IS NOT NULL",
             name: :employee_shifts_company_external_index
           )

    # List page filters + sort — every render pulls "shifts started
    # after X, ordered newest-first". The composite index carries the
    # ordering key so PG can serve the paginated fetch from an
    # index-only scan.
    create index(:employee_shifts, [:company_id, :started_at])
    create index(:employee_shifts, [:employee_id, :started_at])
  end
end
