defmodule Backend.Customers.CustomerFile do
  @moduledoc """
  Uploaded file attached to a customer — contracts, NDAs, credit
  checks, logos. Bytes live in `Backend.Storage`; this row carries
  the metadata the auditor reads.

  Mirror of `Backend.Vendors.VendorFile`. `kind` is a tag for
  filtering / payload shaping, not a constraint — adding a new
  artifact type is a value, not a schema change.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Customers.{Customer, CustomerFile}

  @kinds ~w(contract nda credit_check photo logo other)

  schema "customer_files" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :kind, :string
    field :filename, :string
    field :mime, :string
    field :byte_size, :integer
    field :blob_path, :string

    belongs_to :company, Company
    belongs_to :customer, Customer
    belongs_to :uploaded_by, User

    timestamps(type: :utc_datetime)
  end

  def kinds, do: @kinds

  def changeset(%CustomerFile{} = file, attrs) do
    file
    |> cast(attrs, [
      :company_id,
      :customer_id,
      :kind,
      :filename,
      :mime,
      :byte_size,
      :blob_path,
      :uploaded_by_id
    ])
    |> validate_required([
      :company_id,
      :customer_id,
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
