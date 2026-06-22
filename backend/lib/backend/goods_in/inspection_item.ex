defmodule Backend.GoodsIn.InspectionItem do
  @moduledoc """
  Per-PO-line decision row inside one goods-in inspection.

  The operator records what they actually counted (`qty_received`),
  the packaging condition they saw, and their per-line verdict
  (`material_decision`). The inspection-level `quality_decision` set
  by the approver is the outer envelope — the per-line `material_decision`
  is what drives which lifecycle event the linked lots get.

  Unique (goods_in_inspection_id, purchase_order_line_id) — one
  inspection carries at most one verdict per line.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Companies.Company
  alias Backend.GoodsIn.Inspection
  alias Backend.Purchasing.PurchaseOrderLine

  @packaging_conditions ~w(good damaged)
  @material_decisions ~w(accept hold reject)

  schema "goods_in_inspection_items" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :qty_received, :decimal
    field :packaging_condition, :string
    field :packaging_condition_notes, :string
    field :material_decision, :string
    field :material_decision_reason, :string

    # Multi-pack breakdown. Each map carries:
    #   %{
    #     "qty" => decimal-string,
    #     "package_length_mm" => integer,
    #     "package_width_mm"  => integer,
    #     "package_height_mm" => integer,
    #     "package_weight_kg" => decimal-string,
    #     "units_per_package" => decimal-string,
    #     "supplier_batch_no" => string (optional)
    #   }
    # Sum of `qty` is reconciled into `qty_received` server-side so the
    # two never drift. Empty list means "single implicit pack of size
    # qty_received" — legacy rows stay valid.
    field :packs, {:array, :map}, default: []

    belongs_to :company, Company
    belongs_to :goods_in_inspection, Inspection
    belongs_to :purchase_order_line, PurchaseOrderLine

    timestamps(type: :utc_datetime)
  end

  def packaging_conditions, do: @packaging_conditions
  def material_decisions, do: @material_decisions

  def changeset(item, attrs) do
    item
    |> cast(attrs, [
      :company_id,
      :goods_in_inspection_id,
      :purchase_order_line_id,
      :qty_received,
      :packaging_condition,
      :packaging_condition_notes,
      :material_decision,
      :material_decision_reason,
      :packs
    ])
    |> validate_required([
      :company_id,
      :goods_in_inspection_id,
      :purchase_order_line_id,
      :qty_received,
      :material_decision
    ])
    |> validate_inclusion(:material_decision, @material_decisions)
    |> maybe_validate_inclusion(:packaging_condition, @packaging_conditions)
    |> validate_number(:qty_received, greater_than_or_equal_to: 0)
    |> validate_decision_reason()
    |> validate_packs()
    |> validate_length(:packaging_condition_notes, max: 2000)
    |> validate_length(:material_decision_reason, max: 2000)
    |> unique_constraint([:goods_in_inspection_id, :purchase_order_line_id],
      name: :goods_in_items_inspection_line_index,
      message: "a decision row for this line already exists on this inspection"
    )
  end

  defp validate_decision_reason(changeset) do
    case get_field(changeset, :material_decision) do
      d when d in ["hold", "reject"] ->
        case get_field(changeset, :material_decision_reason) do
          nil ->
            add_error(changeset, :material_decision_reason, "is required for hold/reject")

          "" ->
            add_error(changeset, :material_decision_reason, "is required for hold/reject")

          _ ->
            changeset
        end

      _ ->
        changeset
    end
  end

  defp maybe_validate_inclusion(changeset, field, allowed) do
    case get_field(changeset, field) do
      nil -> changeset
      _ -> validate_inclusion(changeset, field, allowed)
    end
  end

  # Pack-array validation. Per-pack required keys + sum reconciliation
  # against the row-level qty_received. Empty list is allowed (legacy
  # rows skip the pack breakdown).
  defp validate_packs(changeset) do
    case get_field(changeset, :packs) do
      [] ->
        changeset

      packs when is_list(packs) ->
        case Enum.reduce_while(Enum.with_index(packs), :ok, &validate_pack/2) do
          :ok ->
            changeset
            |> validate_pack_sum(packs)

          {:error, idx, field, msg} ->
            add_error(changeset, :packs, "pack ##{idx + 1} #{field}: #{msg}")
        end

      _ ->
        add_error(changeset, :packs, "must be a list of pack objects")
    end
  end

  # Required: qty > 0, three integer dims >= 0, weight >= 0,
  # units_per_package > 0. Supplier batch is free text.
  defp validate_pack({pack, idx}, _acc) do
    with {:ok, _} <- require_positive_decimal(pack, "qty"),
         {:ok, _} <- require_non_negative_int(pack, "package_length_mm"),
         {:ok, _} <- require_non_negative_int(pack, "package_width_mm"),
         {:ok, _} <- require_non_negative_int(pack, "package_height_mm"),
         {:ok, _} <- require_non_negative_decimal(pack, "package_weight_kg"),
         # `units_per_package` accepts decimals — continuous-UoM lots
         # (kg, L) need fractional values like 4.4 kg/bag.
         {:ok, _} <- require_positive_decimal(pack, "units_per_package") do
      {:cont, :ok}
    else
      {:error, field, msg} -> {:halt, {:error, idx, field, msg}}
    end
  end

  defp validate_pack_sum(changeset, packs) do
    qty_received = get_field(changeset, :qty_received) || Decimal.new(0)

    sum =
      Enum.reduce(packs, Decimal.new(0), fn pack, acc ->
        case decimal_from(pack["qty"] || pack[:qty]) do
          {:ok, dec} -> Decimal.add(acc, dec)
          _ -> acc
        end
      end)

    # Allow tiny float-rounding drift (operators key in 25.000 vs
    # 25 etc.); 0.0001 is below any practical UoM resolution.
    if Decimal.compare(Decimal.abs(Decimal.sub(qty_received, sum)), Decimal.new("0.0001")) ==
         :gt do
      add_error(
        changeset,
        :packs,
        "sum of pack quantities (#{Decimal.to_string(sum)}) must equal qty_received (#{Decimal.to_string(qty_received)})"
      )
    else
      changeset
    end
  end

  defp require_positive_decimal(pack, key) do
    case decimal_from(pack[key] || pack[String.to_atom(key)]) do
      {:ok, dec} ->
        if Decimal.compare(dec, Decimal.new(0)) == :gt do
          {:ok, dec}
        else
          {:error, key, "must be greater than 0"}
        end

      :error ->
        {:error, key, "is required and must be a number"}
    end
  end

  defp require_non_negative_decimal(pack, key) do
    case decimal_from(pack[key] || pack[String.to_atom(key)]) do
      {:ok, dec} ->
        if Decimal.compare(dec, Decimal.new(0)) != :lt do
          {:ok, dec}
        else
          {:error, key, "must be 0 or greater"}
        end

      :error ->
        {:error, key, "is required and must be a number"}
    end
  end

  defp require_non_negative_int(pack, key) do
    case pack[key] || pack[String.to_atom(key)] do
      n when is_integer(n) and n >= 0 -> {:ok, n}
      n when is_float(n) and n >= 0 -> {:ok, trunc(n)}
      _ -> {:error, key, "is required and must be a non-negative whole number"}
    end
  end

  defp require_positive_int(pack, key) do
    case pack[key] || pack[String.to_atom(key)] do
      n when is_integer(n) and n > 0 -> {:ok, n}
      n when is_float(n) and n > 0 -> {:ok, trunc(n)}
      _ -> {:error, key, "is required and must be greater than 0"}
    end
  end

  defp decimal_from(nil), do: :error
  defp decimal_from(%Decimal{} = d), do: {:ok, d}
  defp decimal_from(n) when is_integer(n) or is_float(n), do: {:ok, Decimal.new(to_string(n))}

  defp decimal_from(str) when is_binary(str) do
    case Decimal.parse(String.trim(str)) do
      {dec, ""} -> {:ok, dec}
      _ -> :error
    end
  end

  defp decimal_from(_), do: :error
end
