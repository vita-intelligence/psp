defmodule Backend.HR.EmployeeWage do
  @moduledoc """
  Append-only wage history for an `Employee`. Every wage change
  writes a new row; the currently-effective row has
  `effective_to == nil`. Point-in-time queries (used by the
  cost-breakdown report to resolve the wage AT each session's
  start_time) pick the row whose interval spans the target moment.

  Decimal(10, 4) precision keeps sub-penny headroom for downstream
  payroll math (tax withholding, holiday accrual).
  """

  use Ecto.Schema
  import Ecto.Changeset

  schema "employee_wages" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :effective_from, :date
    field :effective_to, :date

    field :hourly_rate, :decimal
    field :currency_code, :string, default: "GBP"

    field :tax_treatment, :string
    field :source_kind, :string
    field :reason, :string

    belongs_to :company, Backend.Companies.Company
    belongs_to :employee, Backend.HR.Employee
    belongs_to :approved_by, Backend.Accounts.User, foreign_key: :approved_by_id

    timestamps(type: :utc_datetime)
  end

  def create_changeset(struct, attrs) do
    struct
    |> cast(attrs, [
      :company_id,
      :employee_id,
      :effective_from,
      :effective_to,
      :hourly_rate,
      :currency_code,
      :tax_treatment,
      :source_kind,
      :reason,
      :approved_by_id
    ])
    |> validate_required([:company_id, :employee_id, :effective_from, :hourly_rate])
    |> validate_length(:currency_code, is: 3)
    |> validate_number(:hourly_rate, greater_than_or_equal_to: 0)
    |> validate_interval()
  end

  defp validate_interval(changeset) do
    from = get_field(changeset, :effective_from)
    to = get_field(changeset, :effective_to)

    case {from, to} do
      {%Date{} = from_d, %Date{} = to_d} ->
        if Date.compare(from_d, to_d) in [:lt, :eq] do
          changeset
        else
          add_error(changeset, :effective_to, "must be on or after effective_from")
        end

      _ ->
        changeset
    end
  end
end
