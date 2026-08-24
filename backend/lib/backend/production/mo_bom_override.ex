defmodule Backend.Production.MOBOMOverride do
  @moduledoc """
  Per-MO delta against the master BOM. See migration
  `20260824120000_add_mo_bom_overrides` for the shape rationale.

  Rows are never mutated after write except to update `to_qty` on a
  `qty_changed` override (planner nudges the number again). Reverts
  are hard-deletes so the effective BOM cleanly collapses back to the
  master.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Items.Item
  alias Backend.Production.{BOMLine, ManufacturingOrder}
  alias Backend.Units.UnitOfMeasurement

  @actions ~w(removed qty_changed added)
  def actions, do: @actions

  schema "mo_bom_overrides" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :action, :string
    field :from_qty, :decimal
    field :to_qty, :decimal
    field :is_fixed, :boolean, default: false
    field :reason, :string

    belongs_to :company, Company
    belongs_to :manufacturing_order, ManufacturingOrder
    belongs_to :bom_line, BOMLine
    belongs_to :part, Item, foreign_key: :item_id
    belongs_to :unit_of_measurement, UnitOfMeasurement
    belongs_to :created_by, User

    timestamps(type: :utc_datetime)
  end

  def changeset(override, attrs) do
    override
    |> cast(attrs, [
      :company_id,
      :manufacturing_order_id,
      :bom_line_id,
      :item_id,
      :unit_of_measurement_id,
      :action,
      :from_qty,
      :to_qty,
      :is_fixed,
      :reason,
      :created_by_id
    ])
    |> validate_required([:company_id, :manufacturing_order_id, :action])
    |> validate_inclusion(:action, @actions)
    |> validate_shape()
    |> validate_number(:to_qty, greater_than: 0)
    |> validate_length(:reason, max: 2000)
    |> assoc_constraint(:manufacturing_order)
    |> assoc_constraint(:bom_line)
    |> assoc_constraint(:part)
    |> assoc_constraint(:unit_of_measurement)
    |> unique_constraint([:manufacturing_order_id, :bom_line_id],
      name: :mo_bom_overrides_per_line_unique,
      message: "an override for this BOM line already exists on this MO"
    )
    |> unique_constraint([:manufacturing_order_id, :item_id],
      name: :mo_bom_overrides_added_item_unique,
      message: "this item is already injected into this MO — bump its qty instead"
    )
  end

  # Reason is a hard requirement for removes — the audit needs to
  # justify why a component was dropped from a run. Qty tweaks +
  # additions are batch reality; not gated.
  defp validate_shape(cs) do
    action = get_field(cs, :action)
    bom_line_id = get_field(cs, :bom_line_id)
    item_id = get_field(cs, :item_id)
    to_qty = get_field(cs, :to_qty)
    reason = get_field(cs, :reason)

    cs =
      case action do
        "removed" ->
          cs
          |> then(&if is_nil(bom_line_id),
            do: add_error(&1, :bom_line_id, "required for remove"),
            else: &1)
          |> then(&if is_nil(reason) or String.trim(reason || "") == "",
            do: add_error(&1, :reason, "give a reason for removing this line"),
            else: &1)

        "qty_changed" ->
          cs
          |> then(&if is_nil(bom_line_id),
            do: add_error(&1, :bom_line_id, "required for qty change"),
            else: &1)
          |> then(&if is_nil(to_qty),
            do: add_error(&1, :to_qty, "required for qty change"),
            else: &1)

        "added" ->
          cs
          |> then(&if is_nil(item_id),
            do: add_error(&1, :item_id, "required for added line"),
            else: &1)
          |> then(&if is_nil(to_qty),
            do: add_error(&1, :to_qty, "required for added line"),
            else: &1)

        _ ->
          cs
      end

    cs
  end
end
