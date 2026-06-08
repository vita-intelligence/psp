defmodule Backend.Stock.Movement do
  @moduledoc """
  Immutable audit row for every qty change. Placements give you the
  current state; movements give you the timeline. Movements are
  append-only — corrections go through new movement rows, not edits.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Stock.Lot
  alias Backend.Warehouses.StorageCell

  @kinds ~w(receive move consume adjust_up adjust_down dispose return)
  @reference_kinds ~w(purchase_order manufacturing_order sales_order transfer_order stock_take adjustment)

  def kinds, do: @kinds
  def reference_kinds, do: @reference_kinds

  schema "stock_movements" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :delta_qty, :decimal
    field :kind, :string
    field :reason, :string

    field :reference_kind, :string
    field :reference_ref, :string

    field :occurred_at, :utc_datetime

    belongs_to :company, Company
    belongs_to :stock_lot, Lot
    belongs_to :from_cell, StorageCell, foreign_key: :from_cell_id
    belongs_to :to_cell, StorageCell, foreign_key: :to_cell_id
    belongs_to :actor, User, foreign_key: :actor_id

    timestamps(type: :utc_datetime)
  end

  def changeset(movement, attrs) do
    movement
    |> cast(attrs, [
      :uuid,
      :company_id,
      :stock_lot_id,
      :from_cell_id,
      :to_cell_id,
      :delta_qty,
      :kind,
      :reason,
      :reference_kind,
      :reference_ref,
      :actor_id,
      :occurred_at
    ])
    |> validate_required([
      :company_id,
      :stock_lot_id,
      :delta_qty,
      :kind,
      :occurred_at
    ])
    |> validate_inclusion(:kind, @kinds)
    |> maybe_validate_reference_kind()
    |> validate_kind_shape()
  end

  defp maybe_validate_reference_kind(changeset) do
    case get_field(changeset, :reference_kind) do
      nil -> changeset
      _ -> validate_inclusion(changeset, :reference_kind, @reference_kinds)
    end
  end

  # Cross-field check: every kind has a required cell shape. Catches
  # callers building movements by hand instead of going through the
  # context helpers.
  defp validate_kind_shape(changeset) do
    kind = get_field(changeset, :kind)
    from_id = get_field(changeset, :from_cell_id)
    to_id = get_field(changeset, :to_cell_id)

    case kind do
      "receive" when is_nil(to_id) ->
        add_error(changeset, :to_cell_id, "receive movements require a destination cell")

      "consume" when is_nil(from_id) ->
        add_error(changeset, :from_cell_id, "consume movements require a source cell")

      "dispose" when is_nil(from_id) ->
        add_error(changeset, :from_cell_id, "dispose movements require a source cell")

      "move" when is_nil(from_id) or is_nil(to_id) ->
        add_error(changeset, :kind, "move movements need both from + to cells")

      _ ->
        changeset
    end
  end
end
