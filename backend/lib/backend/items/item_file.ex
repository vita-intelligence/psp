defmodule Backend.Items.ItemFile do
  @moduledoc """
  Uploaded file backing an item-level compliance artifact (spec sheet,
  food-contact DoC, migration test report, …).

  Bytes live in `Backend.Storage`; this row carries the metadata the
  auditor reads — original filename, mime, byte size, uploader,
  upload time, and the opaque blob path the storage adapter
  resolves.

  Shape mirrors `Backend.Vendors.VendorFile` so the FE upload widget
  pattern + API contract are uniform across the codebase.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Items.Item

  @kinds ~w(spec_sheet food_contact_declaration migration_test safety_data_sheet allergen_declaration nutritional_analysis other)

  schema "item_files" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :kind, :string
    field :filename, :string
    field :mime, :string
    field :byte_size, :integer
    field :blob_path, :string

    belongs_to :company, Company
    belongs_to :item, Item
    belongs_to :uploaded_by, User

    timestamps(type: :utc_datetime)
  end

  def kinds, do: @kinds

  def changeset(file, attrs) do
    file
    |> cast(attrs, [
      :company_id,
      :item_id,
      :kind,
      :filename,
      :mime,
      :byte_size,
      :blob_path,
      :uploaded_by_id
    ])
    |> validate_required([
      :company_id,
      :item_id,
      :kind,
      :filename,
      :mime,
      :byte_size,
      :blob_path
    ])
    |> validate_inclusion(:kind, @kinds)
    |> validate_length(:filename, max: 255)
    |> validate_length(:mime, max: 120)
    |> validate_length(:blob_path, max: 500)
    |> validate_number(:byte_size, greater_than: 0)
  end
end
