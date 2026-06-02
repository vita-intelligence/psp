defmodule Backend.Repo.Migrations.CreateCompaniesAndRbac do
  use Ecto.Migration

  def change do
    create table(:companies) do
      add :name, :string, null: false, size: 200
      add :legal_address, :text
      add :email, :string, size: 160
      add :website, :string, size: 200
      add :phone, :string, size: 60
      add :registration_number, :string, size: 60
      add :tax_number, :string, size: 60
      add :tax_rate, :decimal, precision: 6, scale: 3
      add :payment_details, :text

      add :timezone, :string, size: 80, default: "Europe/London"
      add :date_format, :string, size: 32, default: "dd/MM/yyyy"
      add :first_day_of_week, :integer, default: 1
      add :decimal_separator, :string, size: 4, default: "."
      add :thousands_separator, :string, size: 4, default: ","
      add :csv_separator, :string, size: 4, default: ","
      add :currency_code, :string, size: 8, default: "GBP"
      add :currency_format, :string, size: 32, default: "[Sign] [Price]"
      add :generic_place_name, :string, size: 80, default: "Holding Room"

      # JSONB bags so we don't sprout one join table per list. Order of
      # items inside each bag is preserved; the API layer is the
      # validation source of truth for the shape inside.
      add :working_hours, :map, default: %{}
      add :holidays, :map, default: %{}
      add :currency_rates, :map, default: %{}
      add :allowed_ips, :map, default: %{}
      add :numbering_formats, :map, default: %{}

      timestamps(type: :utc_datetime)
    end

    # PSP is single-tenant per deployment for now, so we expect ONE row
    # in companies. Unique on name keeps the table clean against a
    # double-insert; singleton-ness is enforced at the service layer.
    create unique_index(:companies, [:name])

    create table(:roles) do
      add :company_id, references(:companies, on_delete: :delete_all), null: false
      add :name, :string, null: false, size: 80
      add :slug, :string, null: false, size: 80
      add :description, :string, size: 200
      # System roles ship with the app; the UI can't delete them.
      add :is_system, :boolean, default: false, null: false
      # Owner bypasses all permission checks — must be exactly one per
      # company. Enforced in services, not the schema.
      add :is_owner, :boolean, default: false, null: false
      # Array of permission codes ("company.view", "users.invite", …).
      # JSONB-via-array so changes are atomic; PG can query with ? / @>.
      add :permissions, {:array, :string}, default: [], null: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:roles, [:company_id, :slug])
    create index(:roles, [:company_id])

    create table(:user_roles, primary_key: false) do
      add :user_id, references(:users, on_delete: :delete_all),
        null: false,
        primary_key: true

      add :role_id, references(:roles, on_delete: :delete_all),
        null: false,
        primary_key: true

      add :assigned_at, :utc_datetime, default: fragment("NOW()")
    end

    create index(:user_roles, [:user_id])
    create index(:user_roles, [:role_id])

    alter table(:users) do
      add :company_id, references(:companies, on_delete: :nilify_all)
    end

    create index(:users, [:company_id])
  end
end
