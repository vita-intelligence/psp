defmodule Backend.Catalogs.ProductFamily do
  @moduledoc """
  Marketing-grade grouping of variant SKUs (e.g. "Vitamin D" → 30/60/90
  capsule children). Children are first-class items with their own
  specs and BOMs; the family carries the brand-side identity only.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company

  schema "product_families" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :name, :string
    field :description, :string
    field :is_active, :boolean, default: true

    belongs_to :company, Company
    belongs_to :created_by, User
    belongs_to :updated_by, User

    timestamps(type: :utc_datetime)
  end

  def changeset(family, attrs) do
    family
    |> cast(attrs, [
      :company_id,
      :name,
      :description,
      :is_active,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([:company_id, :name])
    |> validate_length(:name, min: 1, max: 120)
    |> trim_name()
    |> unique_constraint([:company_id, :name],
      name: :product_families_company_id_name_index,
      message: "a family with this name already exists"
    )
  end

  defp trim_name(changeset) do
    case get_change(changeset, :name) do
      raw when is_binary(raw) -> put_change(changeset, :name, String.trim(raw))
      _ -> changeset
    end
  end
end
