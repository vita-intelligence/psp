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
  import Ecto.Query, only: [from: 2]

  alias Backend.Companies.Company
  alias Backend.Items.Item
  alias Backend.Production.BOM
  alias Backend.Repo
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
    |> validate_uom_dimension_matches_part()
    |> unique_constraint([:bom_id, :part_id],
      name: :bom_lines_bom_part_index,
      message: "this part is already on the BOM — bump the qty instead"
    )
  end

  # Loud-failure guard at the write boundary: when a line names a UoM
  # AND the part has a stock UoM, both must share a `dimension`. Kills
  # the class of bug where an integration silently ships a mass qty
  # (mg / kg) against a piece item — the row used to render as
  # "0.0005 kg" on a capsule shell whose stock_uom is `pcs`, with no
  # error anywhere. A missing line UoM or a part with no stock_uom set
  # skip this check (the fallback path already handles that gracefully).
  defp validate_uom_dimension_matches_part(changeset) do
    line_uom_id = get_field(changeset, :unit_of_measurement_id)
    part_id = get_field(changeset, :part_id)

    if line_uom_id && part_id do
      case lookup_dimensions(line_uom_id, part_id) do
        {line_dim, part_dim}
        when is_binary(line_dim) and is_binary(part_dim) and line_dim != part_dim ->
          add_error(
            changeset,
            :unit_of_measurement_id,
            "unit dimension (#{line_dim}) doesn't match the part's stock UoM (#{part_dim})"
          )

        _ ->
          changeset
      end
    else
      changeset
    end
  end

  defp lookup_dimensions(line_uom_id, part_id) do
    query =
      from u in UnitOfMeasurement,
        where: u.id == ^line_uom_id,
        left_join: i in Item,
        on: i.id == ^part_id,
        left_join: p in UnitOfMeasurement,
        on: p.id == i.stock_uom_id,
        select: {u.dimension, p.dimension}

    case Repo.one(query) do
      nil -> {nil, nil}
      pair -> pair
    end
  end
end
