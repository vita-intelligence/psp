defmodule Backend.Equipment.File do
  @moduledoc """
  A file attached to an equipment unit — calibration certificate,
  service report, spec sheet, warranty PDF, photo of the nameplate.
  Bytes live in `Backend.Storage`; this row carries metadata + the
  opaque blob path the storage adapter knows how to fetch.

  Mirrors `Backend.Stock.LotFile` / `Backend.Vendors.VendorFile` so
  the upload flow + serving endpoint have identical shape.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Equipment.Equipment

  # Known kinds — the FE surfaces filter chips based on this list.
  # `other` covers anything that doesn't fit the top-level
  # categories; free text in the filename is where a specific label
  # lives.
  @kinds ~w(calibration_certificate service_report manual warranty photo other)

  def kinds, do: @kinds

  schema "equipment_files" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :kind, :string
    field :filename, :string
    field :mime, :string
    field :byte_size, :integer
    field :blob_path, :string

    belongs_to :company, Company
    belongs_to :equipment, Equipment
    belongs_to :uploaded_by, User

    timestamps(type: :utc_datetime)
  end

  def changeset(file, attrs) do
    file
    |> cast(attrs, [
      :company_id,
      :equipment_id,
      :kind,
      :filename,
      :mime,
      :byte_size,
      :blob_path,
      :uploaded_by_id
    ])
    |> validate_required([
      :company_id,
      :equipment_id,
      :kind,
      :filename,
      :mime,
      :byte_size,
      :blob_path
    ])
    |> validate_inclusion(:kind, @kinds)
    |> validate_length(:filename, min: 1, max: 255)
    |> validate_length(:mime, min: 1, max: 120)
    |> validate_number(:byte_size, greater_than: 0)
  end
end
