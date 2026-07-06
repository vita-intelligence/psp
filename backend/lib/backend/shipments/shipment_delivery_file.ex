defmodule Backend.Shipments.ShipmentDeliveryFile do
  @moduledoc """
  Delivery-confirmation attachment — POD scan, signed docket, or
  damage/condition evidence taken when the customer receives the
  consignment (BRCGS Issue 9 § 5.4.6, downstream half). Mirrors
  `Backend.Shipments.ShipmentPickupFile` exactly so the FE upload
  component + storage layout are reusable and auditors see the same
  provenance shape on every attachment row. Physically separate from
  pickup files so queries like "give me the POD" don't need a `kind`
  filter and the two audit trails stay clean.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Shipments.Shipment

  @kinds ~w(photo other)

  schema "shipment_delivery_files" do
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
