defmodule Backend.Shipments.ShipmentPickupFile do
  @moduledoc """
  Photo captured on the mobile dispatch form when the truck arrives —
  a visual record of what actually left the site (BRCGS Issue 9 §
  5.4.6). Mirrors `Backend.GoodsIn.InspectionFile` exactly so the FE
  upload component + storage layout are reusable and auditors see the
  same provenance shape on every attachment row.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Shipments.Shipment

  @kinds ~w(photo other)

  schema "shipment_pickup_files" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :kind, :string
    field :filename, :string
    field :mime, :string
    field :byte_size, :integer
    field :blob_path, :string

    belongs_to :company, Company
    belongs_to :shipment, Shipment
    belongs_to :uploaded_by, User

    timestamps(type: :utc_datetime)
  end

  def kinds, do: @kinds

  def changeset(file, attrs) do
    file
    |> cast(attrs, [
      :company_id,
      :shipment_id,
      :kind,
      :filename,
      :mime,
      :byte_size,
      :blob_path,
      :uploaded_by_id
    ])
    |> validate_required([
      :company_id,
      :shipment_id,
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
