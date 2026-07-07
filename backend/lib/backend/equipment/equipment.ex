defmodule Backend.Equipment.Equipment do
  @moduledoc """
  One physical equipment unit — a mixer, a scale, a forklift, a
  laptop, a pH meter. Distinct from a stock lot: equipment tracks
  identity per unit (serial number), lifecycle state, location,
  and calibration + maintenance cadence. Lots track qty per batch.

  Display code (`EQ00012`) is rendered from `id` + the company's
  numbering format — no stored `code` column, same pattern as
  stock lots.

  Statuses:

    * `expected`             — PO placed, unit not yet received
    * `received`             — physically received, awaiting put-in-service
    * `in_service`           — in use, cell + assignment stable
    * `under_maintenance`    — planned service in progress
    * `out_for_repair`       — sent to external repair
    * `awaiting_calibration` — service done, waiting for cal to clear
    * `retired`              — end of life, not yet disposed
    * `disposed`             — physically scrapped / sold
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Items.Item
  alias Backend.Purchasing.PurchaseOrderLine
  alias Backend.Warehouses.StorageCell

  @statuses ~w(expected received in_service under_maintenance out_for_repair
               awaiting_calibration retired disposed)

  def statuses, do: @statuses

  schema "equipment" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :serial_number, :string
    field :manufacturer_serial, :string
    field :manufacturer, :string
    field :model, :string

    field :status, :string, default: "expected"

    field :unit_cost, :decimal
    field :currency, :string
    field :acquired_at, :utc_datetime
    field :warranty_end_at, :date
    field :useful_life_years, :integer

    field :calibration_frequency_months, :integer
    field :last_calibrated_at, :utc_datetime
    field :next_calibration_at, :utc_datetime
    field :maintenance_frequency_months, :integer
    field :last_maintenance_at, :utc_datetime
    field :next_maintenance_at, :utc_datetime

    field :retired_at, :utc_datetime
    field :disposed_at, :utc_datetime

    field :notes, :string

    belongs_to :company, Company
    belongs_to :item, Item
    belongs_to :current_cell, StorageCell, foreign_key: :current_cell_id
    belongs_to :assigned_to, User, foreign_key: :assigned_to_id
    belongs_to :purchase_order_line, PurchaseOrderLine
    belongs_to :created_by, User
    belongs_to :updated_by, User

    has_many :events, Backend.Equipment.Event, foreign_key: :equipment_id

    timestamps(type: :utc_datetime)
  end

  @doc """
  Create-time changeset. Runs on goods-in receive (or manual entry
  for opening-balance imports). Enforces the serial + item + company
  invariants at the boundary.
  """
  def changeset(equipment, attrs) do
    equipment
    |> cast(attrs, [
      :uuid,
      :company_id,
      :item_id,
      :serial_number,
      :manufacturer_serial,
      :manufacturer,
      :model,
      :status,
      :unit_cost,
      :currency,
      :acquired_at,
      :warranty_end_at,
      :useful_life_years,
      :current_cell_id,
      :assigned_to_id,
      :purchase_order_line_id,
      :calibration_frequency_months,
      :last_calibrated_at,
      :next_calibration_at,
      :maintenance_frequency_months,
      :last_maintenance_at,
      :next_maintenance_at,
      :notes,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([:company_id, :item_id, :serial_number, :status])
    |> validate_inclusion(:status, @statuses)
    |> validate_length(:serial_number, min: 1, max: 120)
    |> validate_length(:manufacturer_serial, max: 120)
    |> validate_length(:manufacturer, max: 120)
    |> validate_length(:model, max: 120)
    |> validate_length(:currency, is: 3)
    |> validate_number(:unit_cost, greater_than_or_equal_to: 0)
    |> validate_number(:useful_life_years, greater_than: 0, less_than: 100)
    |> validate_number(:calibration_frequency_months,
      greater_than: 0,
      less_than_or_equal_to: 120
    )
    |> validate_number(:maintenance_frequency_months,
      greater_than: 0,
      less_than_or_equal_to: 120
    )
    |> unique_constraint(:serial_number,
      name: :equipment_company_id_serial_number_index,
      message: "already exists for this company"
    )
  end

  @doc """
  Post-creation edit. `serial_number`, `item_id`, `company_id`,
  and `purchase_order_line_id` are immutable — they identify the
  unit and cascade to the audit trail. Everything else is editable
  by an operator with `equipment.edit`.

  Status is intentionally absent from the cast list — transitions
  go through `Backend.Equipment.Lifecycle.record_event/4`, which
  writes the event and recomputes the projection.
  """
  def edit_changeset(equipment, attrs) do
    equipment
    |> cast(attrs, [
      :manufacturer_serial,
      :manufacturer,
      :model,
      :unit_cost,
      :currency,
      :acquired_at,
      :warranty_end_at,
      :useful_life_years,
      :calibration_frequency_months,
      :maintenance_frequency_months,
      :notes,
      :updated_by_id
    ])
    |> validate_length(:manufacturer_serial, max: 120)
    |> validate_length(:manufacturer, max: 120)
    |> validate_length(:model, max: 120)
    |> validate_length(:currency, is: 3)
    |> validate_number(:unit_cost, greater_than_or_equal_to: 0)
    |> validate_number(:useful_life_years, greater_than: 0, less_than: 100)
    |> validate_number(:calibration_frequency_months,
      greater_than: 0,
      less_than_or_equal_to: 120
    )
    |> validate_number(:maintenance_frequency_months,
      greater_than: 0,
      less_than_or_equal_to: 120
    )
  end

  @doc """
  Service-only status changeset — the Lifecycle module uses this to
  push the recomputed projection onto the equipment row after
  writing an event. Controllers never call this.
  """
  def projected_status_changeset(equipment, status) when is_binary(status) do
    equipment
    |> cast(%{"status" => status}, [:status])
    |> validate_required([:status])
    |> validate_inclusion(:status, @statuses)
  end
end
