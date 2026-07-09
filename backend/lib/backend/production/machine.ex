defmodule Backend.Production.Machine do
  @moduledoc """
  Physical machine attached to a Workstation. See the accompanying
  migration for the full data-model rationale.

  Cost cascade (implemented in Backend.Production.Costing):

      SUM(active_machines.hourly_rate) → workstation.hourly_rate
        → workstation_group.hourly_rate → 0

  Validation rules:
    * `name` required, unique per company
    * `hourly_rate` required + non-negative iff `hourly_rate_enabled`
    * `calibration_frequency_months` strictly positive when set
    * `next_calibration_due_at` auto-computed from
      `last_calibrated_at + calibration_frequency_months` at the
      context layer (recalibrate_machine/3), not here — the changeset
      lets you set it manually for the initial commissioning event
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Production.Workstation

  schema "machines" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :name, :string
    field :notes, :string

    field :hourly_rate_enabled, :boolean, default: false
    field :hourly_rate, :decimal

    field :asset_tag, :string
    field :serial_number, :string
    field :manufacturer, :string
    field :model, :string

    field :commissioned_at, :date
    field :last_calibrated_at, :date
    field :next_calibration_due_at, :date
    field :calibration_frequency_months, :integer

    field :is_active, :boolean, default: true

    belongs_to :company, Company
    belongs_to :workstation, Workstation
    belongs_to :created_by, User
    belongs_to :updated_by, User

    timestamps(type: :utc_datetime)
  end

  @cast_fields ~w(
    company_id workstation_id
    name notes
    hourly_rate_enabled hourly_rate
    asset_tag serial_number manufacturer model
    commissioned_at last_calibrated_at next_calibration_due_at
    calibration_frequency_months
    is_active
    created_by_id updated_by_id
  )a

  def changeset(machine, attrs) do
    machine
    |> cast(attrs, @cast_fields)
    |> validate_required([:company_id, :workstation_id, :name])
    |> validate_length(:name, min: 1, max: 200)
    |> validate_length(:notes, max: 4000)
    |> validate_length(:asset_tag, max: 100)
    |> validate_length(:serial_number, max: 200)
    |> validate_length(:manufacturer, max: 200)
    |> validate_length(:model, max: 200)
    |> validate_hourly_rate()
    |> validate_calibration_frequency()
    |> trim(:name)
    |> trim(:asset_tag)
    |> trim(:serial_number)
    |> trim(:manufacturer)
    |> trim(:model)
    |> assoc_constraint(:company)
    |> assoc_constraint(:workstation)
    |> unique_constraint([:company_id, :name],
      name: :machines_company_name_index,
      message: "another machine already uses this name"
    )
    |> unique_constraint([:company_id, :asset_tag],
      name: :machines_company_asset_tag_index,
      message: "another machine already uses this asset tag"
    )
    |> check_constraint(:hourly_rate,
      name: :machines_hourly_rate_non_negative,
      message: "must be zero or greater"
    )
    |> check_constraint(:calibration_frequency_months,
      name: :machines_calibration_frequency_positive,
      message: "must be greater than zero"
    )
  end

  defp validate_hourly_rate(cs) do
    case get_field(cs, :hourly_rate_enabled) do
      true ->
        cs
        |> validate_required([:hourly_rate],
          message: "set the hourly rate or untick the box"
        )
        |> validate_number(:hourly_rate, greater_than_or_equal_to: 0)

      false ->
        put_change(cs, :hourly_rate, nil)

      _ ->
        cs
    end
  end

  defp validate_calibration_frequency(cs) do
    case get_field(cs, :calibration_frequency_months) do
      nil -> cs
      n when is_integer(n) and n > 0 -> cs
      _ -> add_error(cs, :calibration_frequency_months, "must be greater than zero")
    end
  end

  defp trim(cs, field) do
    case get_change(cs, field) do
      raw when is_binary(raw) -> put_change(cs, field, String.trim(raw))
      _ -> cs
    end
  end
end
