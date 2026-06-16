defmodule Backend.Production.BOMVersion do
  @moduledoc """
  Snapshot of a BOM at a point in time. Each create + update on a
  BOM writes one of these so the recipe history is immutable.

  The `snapshot` jsonb captures the entire BOM state — header
  fields + ordered line list with part identity + qty + UoM. Reads
  pull this directly; nothing on the live BOM tables is needed to
  render a historical version.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Production.BOM

  schema "bom_versions" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :version_no, :integer
    field :snapshot, :map, default: %{}
    field :notes, :string

    belongs_to :company, Company
    belongs_to :bom, BOM
    belongs_to :created_by, User

    timestamps(type: :utc_datetime, updated_at: false)
  end

  def changeset(version, attrs) do
    version
    |> cast(attrs, [
      :company_id,
      :bom_id,
      :version_no,
      :snapshot,
      :notes,
      :created_by_id
    ])
    |> validate_required([:company_id, :bom_id, :version_no, :snapshot])
    |> validate_number(:version_no, greater_than: 0)
    |> validate_length(:notes, max: 2000)
    |> unique_constraint([:bom_id, :version_no],
      name: :bom_versions_bom_version_no_index
    )
  end
end
