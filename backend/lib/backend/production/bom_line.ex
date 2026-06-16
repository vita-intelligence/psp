defmodule Backend.Production.BOMLine do
  @moduledoc """
  Component row on a BOM — one part with its quantity.

  Qty is stored at Decimal(14,4) — matches stock.qty precision so a
  recipe and the lots it consumes line up to four decimals without
  rounding drift.

  `is_fixed = true` means "this overhead is per-batch, not per-unit".
  Used for cleaning consumables, filter membranes, in-process samples
  that the manufacturing-order calc shouldn't multiply by output qty.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Companies.Company
  alias Backend.Items.Item
  alias Backend.Production.BOM
  alias Backend.Units.UnitOfMeasurement

  schema "bom_lines" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :sort_order, :integer, default: 0
    field :qty, :decimal
    field :is_fixed, :boolean, default: false
    field :notes, :string

    belongs_to :company, Company
    belongs_to :bom, BOM
    belongs_to :part, Item
    belongs_to :unit_of_measurement, UnitOfMeasurement

    timestamps(type: :utc_datetime)
  end

  def changeset(line, attrs) do
    line
    |> cast(attrs, [
      :company_id,
      :bom_id,
      :part_id,
      :unit_of_measurement_id,
      :sort_order,
      :qty,
      :is_fixed,
      :notes
    ])
    |> validate_required([:company_id, :bom_id, :part_id, :qty])
    |> validate_number(:qty, greater_than: 0)
    |> validate_length(:notes, max: 2000)
    |> assoc_constraint(:bom)
    |> assoc_constraint(:part)
    |> assoc_constraint(:unit_of_measurement)
    |> unique_constraint([:bom_id, :part_id],
      name: :bom_lines_bom_part_index,
      message: "this part is already on the BOM — bump the qty instead"
    )
  end
end
