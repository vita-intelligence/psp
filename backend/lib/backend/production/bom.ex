defmodule Backend.Production.BOM do
  @moduledoc """
  Bill of Materials — the recipe for one manufactured item.

  Headers are slim: name, notes, primary/active flags, plus the
  output item. The components live on `bom_lines` (the `:lines`
  association); the order matters for display, so each row carries a
  `sort_order` integer.

  An item may carry several named BOMs (variant recipes, regional
  factory differences, allergen-free alts). Exactly one row per item
  is flagged `is_primary` (enforced by a Postgres partial unique
  index); the context layer flips this atomically.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Items.Item
  alias Backend.Production.BOMLine

  schema "boms" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :name, :string
    field :notes, :string
    field :is_primary, :boolean, default: false
    field :is_active, :boolean, default: true

    belongs_to :company, Company
    belongs_to :item, Item
    belongs_to :created_by, User
    belongs_to :updated_by, User

    has_many :lines, BOMLine, foreign_key: :bom_id

    timestamps(type: :utc_datetime)
  end

  @doc """
  Header changeset — name + flags + notes. Output item + company are
  stamped on create; `is_primary` is flipped via
  `Backend.Production.set_primary/2` which clears the previous
  primary in the same transaction. Operators set the flag through
  that explicit action rather than freely editing it on save, but
  the field is still in `cast` so the BE can stamp it during
  promotion.
  """
  def changeset(bom, attrs) do
    bom
    |> cast(attrs, [
      :company_id,
      :item_id,
      :name,
      :notes,
      :is_primary,
      :is_active,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([:company_id, :item_id, :name])
    |> validate_length(:name, min: 1, max: 200)
    |> validate_length(:notes, max: 4000)
    |> trim_name()
    |> assoc_constraint(:company)
    |> assoc_constraint(:item)
    |> unique_constraint([:item_id],
      name: :boms_one_primary_per_item_index,
      message: "this item already has a primary BOM"
    )
  end

  defp trim_name(changeset) do
    case get_change(changeset, :name) do
      raw when is_binary(raw) -> put_change(changeset, :name, String.trim(raw))
      _ -> changeset
    end
  end
end
