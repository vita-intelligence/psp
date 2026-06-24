defmodule Backend.CustomerOrders.CustomerOrderFile do
  @moduledoc """
  Uploaded file attached to a customer order — quote PDFs, proformas,
  shipping documents, signed acknowledgements. Bytes live in
  `Backend.Storage`; this row carries the metadata the auditor reads.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.CustomerOrders.{CustomerOrder, CustomerOrderFile}

  @kinds ~w(quote proforma shipping_doc acknowledgement other)

  schema "customer_order_files" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :kind, :string
    field :filename, :string
    field :mime, :string
    field :byte_size, :integer
    field :blob_path, :string

    belongs_to :company, Company
    belongs_to :customer_order, CustomerOrder
    belongs_to :uploaded_by, User

    timestamps(type: :utc_datetime)
  end

  def kinds, do: @kinds

  def changeset(%CustomerOrderFile{} = file, attrs) do
    file
    |> cast(attrs, [
      :company_id,
      :customer_order_id,
      :kind,
      :filename,
      :mime,
      :byte_size,
      :blob_path,
      :uploaded_by_id
    ])
    |> validate_required([
      :company_id,
      :customer_order_id,
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
