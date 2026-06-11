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
      :material_decision_reason
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
end
