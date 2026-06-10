defmodule Backend.Vendors.VendorFile do
  @moduledoc """
  An uploaded file backing a vendor evidence artifact (SAQ, audit
  report, COA, cert PDF).

  Bytes live in `Backend.Storage`; this row carries the metadata
  the auditor reads — original filename, mime, size, uploader,
  upload time, plus the opaque blob path the storage adapter knows
  how to fetch.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Vendors.Vendor

  @kinds ~w(saq audit coa certificate other)

  schema "vendor_files" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :kind, :string
    field :filename, :string
    field :mime, :string
    field :byte_size, :integer
    field :blob_path, :string

    belongs_to :company, Company
    belongs_to :vendor, Vendor
    belongs_to :uploaded_by, User

    timestamps(type: :utc_datetime)
  end

  def kinds, do: @kinds

  def changeset(file, attrs) do
    file
    |> cast(attrs, [
      :company_id,
      :vendor_id,
      :kind,
      :filename,
      :mime,
      :byte_size,
      :blob_path,
      :uploaded_by_id
    ])
    |> validate_required([
      :company_id,
      :vendor_id,
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
