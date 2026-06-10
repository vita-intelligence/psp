defmodule Backend.Stock.Lot do
  @moduledoc """
  One stock lot — the logical batch identity for a physical batch we
  received or produced. `qty_received` is immutable; on-hand and
  available are derived from placements + movements.

  Display code (`SL00012`) is rendered from `id` + the company's
  numbering format — no stored `code` column.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Items.Item
  alias Backend.Stock.{Movement, Placement}
  alias Backend.Units.UnitOfMeasurement

  @statuses ~w(requested received quarantine depleted disposed rejected)
  @source_kinds ~w(purchase_order manufacturing_order opening_balance return adjustment manual)
  @risk_levels ~w(low medium high)
  @compliance_states ~w(pending requested received accepted rejected na)

  def statuses, do: @statuses
  def source_kinds, do: @source_kinds
  def risk_levels, do: @risk_levels
  def compliance_states, do: @compliance_states

  schema "stock_lots" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :status, :string, default: "requested"

    field :qty_received, :decimal
    field :unit_cost, :decimal
    field :currency, :string

    field :source_kind, :string
    field :source_ref, :string

    field :supplier_batch_no, :string
    field :country_of_origin, :string
    field :revision, :string

    field :overall_risk, :string
    field :allergen_status, :string
    field :coa_status, :string
    field :quality_status, :string

    field :manufactured_at, :date
    field :expiry_at, :date
    field :available_from, :utc_datetime
    field :received_at, :utc_datetime

    field :notes, :string

    # Per-lot packaging (mandatory at receive). Lengths in millimetres,
    # weight in kg with 3 decimals. Drives the volumetric + weight fit
    # checks in `list_move_recommendations`. Nullable in DB so the one
    # pre-migration lot doesn't break; the changeset enforces required.
    field :package_length_mm, :integer
    field :package_width_mm, :integer
    field :package_height_mm, :integer
    field :package_weight_kg, :decimal
    field :units_per_package, :integer, default: 1
    field :stack_factor, :integer, default: 1

    belongs_to :company, Company
    belongs_to :item, Item
    belongs_to :unit_of_measurement, UnitOfMeasurement
    belongs_to :created_by, User
    belongs_to :updated_by, User

    has_many :placements, Placement, foreign_key: :stock_lot_id
    has_many :movements, Movement, foreign_key: :stock_lot_id

    timestamps(type: :utc_datetime)
  end

  def changeset(lot, attrs) do
    lot
    |> cast(attrs, [
      :uuid,
      :company_id,
      :item_id,
      :unit_of_measurement_id,
      :status,
      :qty_received,
      :unit_cost,
      :currency,
      :source_kind,
      :source_ref,
      :supplier_batch_no,
      :country_of_origin,
      :revision,
      :overall_risk,
      :allergen_status,
      :coa_status,
      :quality_status,
      :manufactured_at,
      :expiry_at,
      :available_from,
      :received_at,
      :notes,
      :package_length_mm,
      :package_width_mm,
      :package_height_mm,
      :package_weight_kg,
      :units_per_package,
      :stack_factor,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([
      :company_id,
      :item_id,
      :unit_of_measurement_id,
      :qty_received,
      :status,
      # Packaging — every new lot must declare its physical footprint
      # so the put-away fit-check can rank cells honestly.
      :package_length_mm,
      :package_width_mm,
      :package_height_mm,
      :package_weight_kg,
      :units_per_package,
      :stack_factor
    ])
    |> validate_number(:package_length_mm, greater_than: 0)
    |> validate_number(:package_width_mm, greater_than: 0)
    |> validate_number(:package_height_mm, greater_than: 0)
    |> validate_number(:package_weight_kg, greater_than: 0)
    |> validate_number(:units_per_package, greater_than: 0)
    |> validate_number(:stack_factor, greater_than: 0, less_than_or_equal_to: 50)
    |> validate_inclusion(:status, @statuses)
    |> maybe_validate_inclusion(:source_kind, @source_kinds)
    |> maybe_validate_inclusion(:overall_risk, @risk_levels)
    |> maybe_validate_inclusion(:allergen_status, @compliance_states)
    |> maybe_validate_inclusion(:coa_status, @compliance_states)
    |> maybe_validate_inclusion(:quality_status, @compliance_states)
    |> validate_number(:qty_received, greater_than: 0)
    |> validate_number(:unit_cost, greater_than_or_equal_to: 0)
    |> validate_length(:currency, is: 3)
    |> validate_length(:supplier_batch_no, max: 120)
    |> validate_length(:country_of_origin, max: 80)
    |> validate_length(:revision, max: 40)
    |> validate_length(:source_ref, max: 80)
  end

  # Inclusion only fires when the field has a value — these are
  # optional enums, so an unset value is valid.
  defp maybe_validate_inclusion(changeset, field, allowed) do
    case get_field(changeset, field) do
      nil -> changeset
      _ -> validate_inclusion(changeset, field, allowed)
    end
  end
end
