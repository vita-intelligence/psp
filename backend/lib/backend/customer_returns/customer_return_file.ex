defmodule Backend.CustomerReturns.CustomerReturnFile do
  @moduledoc """
  Uploaded evidence on an RMA — photos of damaged goods, shipping
  paperwork, customer email screenshots. Bytes live in
  `Backend.Storage`; this row carries the metadata.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.CustomerReturns.{CustomerReturn, CustomerReturnFile}

  @kinds ~w(photo shipping_doc email other)

  schema "customer_return_files" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :kind, :string
    field :filename, :string
    field :mime, :string
    field :byte_size, :integer
    field :blob_path, :string

    belongs_to :company, Company
    belongs_to :customer_return, CustomerReturn
    belongs_to :uploaded_by, User

    timestamps(type: :utc_datetime)
  end

  def kinds, do: @kinds

  def changeset(%CustomerReturnFile{} = file, attrs) do
    file
    |> cast(attrs, [
      :company_id,
      :customer_return_id,
      :kind,
      :filename,
      :mime,
      :byte_size,
      :blob_path,
      :uploaded_by_id
    ])
    |> validate_required([
      :company_id,
      :customer_return_id,
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
