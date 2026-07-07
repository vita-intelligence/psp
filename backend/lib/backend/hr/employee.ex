defmodule Backend.HR.Employee do
  @moduledoc """
  A shop-floor person record. Superset of `Backend.Accounts.User`
  because most operators PIN into a kiosk without ever logging into
  PSP directly; only the subset who need web access get a linked
  `User` row.

  Owns:

    * The kiosk PIN (bcrypt-hashed, cost 12) — set here rather than
      on `User` so non-user employees still authenticate.
    * The current `reputation_score` — a projection of
      `EmployeeReputationEvent`; never mutated directly.
    * The current wage — projected from
      `EmployeeWage` where `effective_to IS NULL`. Point-in-time
      wage lookups project the row whose interval spans the target
      time (used by the cost-breakdown report to resolve the wage
      that applied AT each session's start_time).

  Not-in-scope-yet fields (deferred to a follow-up HR PR):
  `Skill` matrix, `Shift` pattern, `Absence` log, `PayrollProfile`
  (encrypted NI + bank + tax code). Those don't gate the E2E
  integration test.
  """

  use Ecto.Schema
  import Ecto.Changeset

  schema "employees" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :external_id, :string
    field :employee_number, :string
    field :full_name, :string
    field :preferred_name, :string
    field :email, :string
    field :phone, :string
    field :hire_date, :date
    field :termination_date, :date

    field :kiosk_pin_hash, :string, redact: true
    field :kiosk_pin, :string, virtual: true, redact: true

    field :is_active, :boolean, default: true
    field :is_qa, :boolean, default: false
    field :reputation_score, :integer, default: 650

    belongs_to :company, Backend.Companies.Company
    belongs_to :user, Backend.Accounts.User
    belongs_to :created_by, Backend.Accounts.User, foreign_key: :created_by_id
    belongs_to :updated_by, Backend.Accounts.User, foreign_key: :updated_by_id

    has_many :wages, Backend.HR.EmployeeWage
    has_many :reputation_events, Backend.HR.EmployeeReputationEvent

    timestamps(type: :utc_datetime)
  end

  @create_fields ~w(full_name preferred_name email phone hire_date is_qa external_id
                    employee_number company_id user_id created_by_id kiosk_pin)a
  @update_fields ~w(full_name preferred_name email phone hire_date termination_date
                    is_qa is_active updated_by_id kiosk_pin)a

  def create_changeset(struct, attrs) do
    struct
    |> cast(attrs, @create_fields)
    |> validate_required([:full_name, :company_id])
    |> validate_length(:full_name, min: 1, max: 200)
    |> maybe_hash_pin()
    |> unique_constraint(:employee_number, name: :employees_company_number_index)
    |> unique_constraint(:external_id, name: :employees_company_external_index)
  end

  def update_changeset(struct, attrs) do
    struct
    |> cast(attrs, @update_fields)
    |> validate_length(:full_name, min: 1, max: 200)
    |> maybe_hash_pin()
  end

  def set_pin_changeset(struct, pin) when is_binary(pin) do
    struct
    |> cast(%{kiosk_pin: pin}, [:kiosk_pin])
    |> validate_length(:kiosk_pin, min: 4, max: 32)
    |> maybe_hash_pin()
  end

  defp maybe_hash_pin(changeset) do
    case get_change(changeset, :kiosk_pin) do
      nil ->
        changeset

      pin when is_binary(pin) and pin != "" ->
        changeset
        |> put_change(:kiosk_pin_hash, Bcrypt.hash_pwd_salt(pin))
        |> put_change(:kiosk_pin, nil)

      _ ->
        changeset
    end
  end
end
