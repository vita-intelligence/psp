defmodule Backend.Repo.Migrations.CreateHr do
  use Ecto.Migration

  # Backend.HR — the shop-floor workforce record. Modelled as a
  # superset of Backend.Accounts.User because most operators never
  # log into PSP (they only PIN into a kiosk on vita-performance).
  #
  # `employees.user_id` is nullable — a PSP user account can be
  # linked to an Employee later, but the Employee is the source of
  # truth for kiosk PIN + reputation + wage.
  #
  # This migration ships three tables:
  #
  #   * employees                     — the person record.
  #   * employee_wages                — append-only wage history.
  #                                     Point-in-time queries via
  #                                     effective_from / effective_to.
  #   * employee_reputation_events    — reputation delta log.
  #                                     Score is projected from the
  #                                     event list; never stored raw.
  #
  # Skill / shift / absence / payroll-profile tables land in a
  # follow-up migration — they're not on the integration hot path
  # for the E2E MO-to-session-to-cost demo, and each carries its own
  # design surface that deserves its own review.
  def change do
    # --------------------- employees ---------------------
    create table(:employees) do
      add :uuid, :uuid, null: false, default: fragment("gen_random_uuid()")

      add :company_id, references(:companies, on_delete: :restrict), null: false

      # Optional link to a PSP user account. Most Employees will
      # never have one — factory operators PIN into a kiosk, they
      # don't sign into the PSP UI. Managers who do both share this
      # row so their kiosk actions carry the same identity as their
      # web actions.
      add :user_id, references(:users, on_delete: :nilify_all)

      # External-system correlation. `vita-performance` mirrors this
      # employee onto its Worker table and stores our UUID here for
      # the round-trip.
      add :external_id, :string, size: 64

      add :employee_number, :string, size: 20
      add :full_name, :string, null: false, size: 200
      add :preferred_name, :string, size: 100
      add :email, :string, size: 254
      add :phone, :string, size: 30
      add :hire_date, :date
      add :termination_date, :date

      # Kiosk PIN. bcrypt cost 12 (matches password hashing per
      # PSP compliance rules). Kept here rather than on user_id so
      # non-user employees still authenticate at the kiosk.
      add :kiosk_pin_hash, :string

      add :is_active, :boolean, null: false, default: true

      # Marks operators authorised to sign off QC verdicts. Mirrors
      # vita-performance's Worker.is_qa.
      add :is_qa, :boolean, null: false, default: false

      # Cached projection of the reputation-event stream. Rebuilt by
      # Backend.HR.recompute_reputation_score/1 on every event insert.
      add :reputation_score, :integer, null: false, default: 650

      # Notes / avatar / etc. can be added in a follow-up column; the
      # E2E integration doesn't need them.

      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:employees, [:uuid])
    create unique_index(:employees, [:company_id, :employee_number],
             where: "employee_number IS NOT NULL",
             name: :employees_company_number_index
           )
    create unique_index(:employees, [:company_id, :external_id],
             where: "external_id IS NOT NULL",
             name: :employees_company_external_index
           )
    create index(:employees, [:company_id, :is_active])
    create index(:employees, [:user_id])

    # --------------------- employee_wages ---------------------
    #
    # Append-only. A wage change = new row. `effective_from` /
    # `effective_to` bracket the interval; NULL `effective_to` means
    # "current". Point-in-time lookups project the row that spans
    # the moment of interest — the cost-breakdown report uses this
    # to resolve the wage AT the session's start_time rather than
    # the employee's current wage.
    create table(:employee_wages) do
      add :uuid, :uuid, null: false, default: fragment("gen_random_uuid()")

      add :company_id, references(:companies, on_delete: :restrict), null: false
      add :employee_id, references(:employees, on_delete: :restrict), null: false

      add :effective_from, :date, null: false
      add :effective_to, :date

      # Decimal(10,4) — sub-penny precision so downstream tax /
      # rounding math has headroom.
      add :hourly_rate, :decimal, precision: 10, scale: 4, null: false
      add :currency_code, :string, size: 3, null: false, default: "GBP"

      # Payroll-friendly metadata for future BACS / Xero / Sage
      # export. Not exercised on the E2E path but captured now so
      # a later payroll module doesn't need a data-migration.
      add :tax_treatment, :string, size: 32
      add :source_kind, :string, size: 32

      add :reason, :string, size: 500

      add :approved_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:employee_wages, [:uuid])
    create index(:employee_wages, [:employee_id, :effective_from])
    # Fast "current wage" lookup — the partial index only covers open
    # intervals so the planner uses it for the point-in-time query
    # the cost-breakdown report drives.
    create index(:employee_wages, [:employee_id],
             where: "effective_to IS NULL",
             name: :employee_wages_current_index
           )

    # --------------------- employee_reputation_events ---------------------
    #
    # Every reputation delta is one event row. `event_type` covers
    # both auto-generated performance grades (fires when a
    # WorkstationSession completes) and manual QC feedback. Reputation
    # score on employees is a computed projection of this stream —
    # never mutated directly.
    create table(:employee_reputation_events) do
      add :uuid, :uuid, null: false, default: fragment("gen_random_uuid()")

      add :company_id, references(:companies, on_delete: :restrict), null: false
      add :employee_id, references(:employees, on_delete: :restrict), null: false

      # Optional reference to the vita-performance WorkSession that
      # triggered this event. Kept as a string (external uuid) rather
      # than a FK because the underlying WorkstationSession row on
      # our side may not exist yet if the writeback outbox hasn't
      # flushed.
      add :session_external_id, :string, size: 64

      add :event_type, :string, size: 32, null: false
      add :score_delta, :integer, null: false
      add :reason, :string, size: 500

      # Who submitted the feedback — either an Employee (QC operator
      # at the kiosk) or a User (a manager on the web).
      add :created_by_employee_id, references(:employees, on_delete: :nilify_all)
      add :created_by_user_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:employee_reputation_events, [:uuid])
    create index(:employee_reputation_events, [:employee_id, :inserted_at])
  end
end
