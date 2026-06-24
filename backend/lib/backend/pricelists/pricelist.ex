defmodule Backend.Pricelists.Pricelist do
  @moduledoc """
  One pricelist — a named bag of `pricelist_items` rows that quote
  selling prices in a single currency. Pricelists are referenced by
  customers via `customers.pricelist_id`; when a customer has no
  pricelist of their own, the company's `is_default = true` pricelist
  is used as fallback.

  Display code (`PL00001`, …) is rendered from `id` + the company's
  numbering format — no stored `code` column.

  Validity window (`valid_from` / `valid_until`) lets a pricelist
  expire without being deleted, so an audit can still answer "what
  rate did we quote in May?".
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Pricelists.{Pricelist, PricelistItem}

  schema "pricelists" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :name, :string
    field :currency_code, :string, default: "GBP"
    field :is_default, :boolean, default: false
    field :is_active, :boolean, default: true

    field :valid_from, :date
    field :valid_until, :date

    field :notes, :string

    belongs_to :company, Company
    belongs_to :created_by, User
    belongs_to :updated_by, User

    has_many :items, PricelistItem, foreign_key: :pricelist_id

    timestamps(type: :utc_datetime)
  end

  @doc """
  Identity + currency + validity. `is_default` is NOT cast here — it
  flows through `set_default_changeset/2` so the partial unique index
  isn't tripped by accident from a generic save.
  """
  def changeset(%Pricelist{} = pricelist, attrs) do
    pricelist
    |> cast(attrs, [
      :company_id,
      :name,
      :currency_code,
      :is_active,
      :valid_from,
      :valid_until,
      :notes,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([:company_id, :name])
    |> validate_length(:name, min: 1, max: 160)
    |> validate_length(:currency_code, is: 3)
    |> validate_validity_window()
    |> unique_constraint([:company_id, :name],
      name: :pricelists_company_id_name_index,
      message: "a pricelist with this name already exists"
    )
  end

  @doc """
  Dedicated transition for the default-pricelist flag. The context
  layer wraps this in a transaction that clears the previous default
  before setting the new one, so the partial unique index never
  collides.
  """
  def set_default_changeset(%Pricelist{} = pricelist, attrs) do
    pricelist
    |> cast(attrs, [:is_default, :updated_by_id])
    |> validate_required([:is_default])
  end

  defp validate_validity_window(changeset) do
    from = get_field(changeset, :valid_from)
    until = get_field(changeset, :valid_until)

    if is_struct(from, Date) and is_struct(until, Date) and
         Date.compare(until, from) == :lt do
      add_error(changeset, :valid_until, "must be on or after the start date")
    else
      changeset
    end
  end
end
