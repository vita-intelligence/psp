defmodule Backend.Stock.LotFile do
  @moduledoc """
  An uploaded file backing a lot lifecycle event — QC certificate,
  disposal paperwork, hold notice, photo of damaged goods.

  Mirrors `Backend.Vendors.VendorFile`: bytes live in `Backend.Storage`,
  this row carries metadata + the opaque blob path the storage adapter
  knows how to fetch. The event row references the file via
  `evidence_file_id`, so the auditor sees "this QC pass was backed by
  this PDF" as one navigable record.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Stock.Lot

  @kinds ~w(qc_report disposal_certificate hold_notice photo other)

  schema "lot_files" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :kind, :string
    field :filename, :string
    field :mime, :string
    field :byte_size, :integer
    field :blob_path, :string

    belongs_to :company, Company
    belongs_to :stock_lot, Lot
    belongs_to :uploaded_by, User

    timestamps(type: :utc_datetime)
  end

  def kinds, do: @kinds

  def changeset(file, attrs) do
    file
    |> cast(attrs, [
      :company_id,
      :stock_lot_id,
      :kind,
      :filename,
      :mime,
      :byte_size,
      :blob_path,
      :uploaded_by_id
    ])
    |> validate_required([
      :company_id,
      :stock_lot_id,
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
