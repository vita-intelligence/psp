defmodule Backend.HR.EmployeeReputationEvent do
  @moduledoc """
  Reputation delta log for an `Employee`. Score is projected from
  the event stream (300..850) — the mirror field on `Employee` is
  cached, never mutated directly.

  Event types mirror vita-performance's WorkerReputationEvent so
  the forwarding path is a direct field copy:

    * `auto_perf_excellent` / `_high` / `_low` / `_very_low`
    * `manual_positive` / `manual_negative`
  """

  use Ecto.Schema
  import Ecto.Changeset

  @event_types ~w(
    auto_perf_excellent
    auto_perf_high
    auto_perf_low
    auto_perf_very_low
    manual_positive
    manual_negative
  )

  def event_types, do: @event_types

  schema "employee_reputation_events" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :session_external_id, :string
    field :event_type, :string
    field :score_delta, :integer
    field :reason, :string

    belongs_to :company, Backend.Companies.Company
    belongs_to :employee, Backend.HR.Employee

    belongs_to :created_by_employee, Backend.HR.Employee,
      foreign_key: :created_by_employee_id
    belongs_to :created_by_user, Backend.Accounts.User,
      foreign_key: :created_by_user_id

    timestamps(type: :utc_datetime)
  end

  def create_changeset(struct, attrs) do
    struct
    |> cast(attrs, [
      :company_id,
      :employee_id,
      :session_external_id,
      :event_type,
      :score_delta,
      :reason,
      :created_by_employee_id,
      :created_by_user_id
    ])
    |> validate_required([:company_id, :employee_id, :event_type, :score_delta])
    |> validate_inclusion(:event_type, @event_types)
    |> validate_length(:reason, max: 4000)
  end
end
