defmodule Backend.Claims.Claim do
  @moduledoc """
  One row from the regulator-maintained health / nutrition claim
  register. Read-mostly: seeded from regulator data, refreshable by
  migration, never user-editable.

  Finished-product specs reference rows here via JSONB id arrays
  rather than FK columns so a spec can carry per-active claim
  numerics (mg + NRV%) without inflating the schema.
  """

  use Ecto.Schema

  schema "claim_register" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :claim_code, :string
    field :claim_text, :string
    field :category, :string
    field :nutrient_substance, :string
    field :conditions_of_use, :string
    field :jurisdictions, {:array, :string}, default: []
    field :source, :string
    field :status, :string
    timestamps(type: :utc_datetime)
  end
end
