defmodule Backend.Equipment.Repair do
  @moduledoc """
  Reactive breakdown record for a piece of equipment. See migration
  doc for the "why distinct from maintenance tasks".

  Lifecycle statuses:

    * ``reported``     — operator raised the fault, no tech assigned yet
    * ``in_progress``  — someone started work (external vendor or in-house)
    * ``completed``    — work finished, ``completion_date`` + ``downtime_minutes`` populated
    * ``canceled``     — reported in error / duplicate

  Downtime + cost are cached scalars for dashboarding; the parts list
  lives in :parts (``equipment_repair_parts`` rows).
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Equipment.{Equipment, Event, RepairPart}

  @statuses ~w(reported in_progress completed canceled)

  def statuses, do: @statuses

  schema "equipment_repairs" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :failure_date, :utc_datetime
    field :started_at, :utc_datetime
    field :completion_date, :utc_datetime
    field :downtime_minutes, :integer

    field :status, :string, default: "reported"

    field :description, :string
    field :actions_performed, :string

    field :repair_cost, :decimal
    field :currency, :string

    field :external_vendor_name, :string
    field :notes, :string

    belongs_to :company, Company
    belongs_to :equipment, Equipment
    belongs_to :assigned_to_user, User
    belongs_to :equipment_event, Event
    belongs_to :created_by, User
    belongs_to :updated_by, User

    has_many :parts, RepairPart, foreign_key: :repair_id

    timestamps(type: :utc_datetime)
  end

  def changeset(struct, attrs) do
    struct
    |> cast(attrs, [
      :company_id,
      :equipment_id,
      :failure_date,
      :started_at,
      :completion_date,
      :downtime_minutes,
      :status,
      :description,
      :actions_performed,
      :repair_cost,
      :currency,
      :assigned_to_user_id,
      :external_vendor_name,
      :equipment_event_id,
      :notes,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([:company_id, :equipment_id, :failure_date, :status])
    |> validate_inclusion(:status, @statuses)
    |> validate_length(:external_vendor_name, max: 200)
    |> validate_length(:currency, is: 3)
    |> validate_number(:repair_cost, greater_than_or_equal_to: 0)
    |> validate_number(:downtime_minutes, greater_than_or_equal_to: 0)
    |> assoc_constraint(:company)
    |> assoc_constraint(:equipment)
    |> assoc_constraint(:assigned_to_user)
    |> assoc_constraint(:equipment_event)
  end
end
