defmodule Backend.GoodsIn.InspectionFile do
  @moduledoc """
  Photo / supplier-document attachment on a goods-in inspection.

  Mirrors `Backend.Vendors.VendorFile` / `Backend.Purchasing.PurchaseOrderFile`
  exactly so the FE upload component is reusable and the auditor sees
  the same provenance shape on every attachment row.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.GoodsIn.Inspection

  @kinds ~w(photo coa other)

  schema "goods_in_inspection_files" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :kind, :string
    field :filename, :string
    field :mime, :string
    field :byte_size, :integer
    field :blob_path, :string

    belongs_to :company, Company
    belongs_to :goods_in_inspection, Inspection
    belongs_to :uploaded_by, User

    timestamps(type: :utc_datetime)
  end

  def kinds, do: @kinds

  def changeset(file, attrs) do
    file
    |> cast(attrs, [
      :company_id,
      :goods_in_inspection_id,
      :kind,
      :filename,
      :mime,
      :byte_size,
      :blob_path,
      :uploaded_by_id
    ])
    |> validate_required([
      :company_id,
      :goods_in_inspection_id,
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
