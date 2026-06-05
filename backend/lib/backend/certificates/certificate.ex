defmodule Backend.Certificates.Certificate do
  @moduledoc """
  Company-scoped certificate definition. A row here is a *type* of
  cert the company recognises (e.g. "GMP — Site Glasgow"); per-item
  attachments live in `item_certificates`.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company

  @certificate_types ~w(organic halal kosher iso_22000 brc fssc_22000 gmp ifs haccp usda_organic non_gmo_project other)

  schema "certificates" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :name, :string
    field :certificate_type, :string
    field :issuing_body, :string
    field :default_validity_months, :integer
    field :description, :string
    field :is_active, :boolean, default: true

    belongs_to :company, Company
    belongs_to :created_by, User
    belongs_to :updated_by, User

    timestamps(type: :utc_datetime)
  end

  def certificate_types, do: @certificate_types

  def changeset(cert, attrs) do
    cert
    |> cast(attrs, [
      :company_id,
      :name,
      :certificate_type,
      :issuing_body,
      :default_validity_months,
      :description,
      :is_active,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([:company_id, :name, :certificate_type])
    |> validate_length(:name, min: 1, max: 120)
    |> validate_length(:issuing_body, max: 120)
    |> validate_inclusion(:certificate_type, @certificate_types,
      message: "must be one of: #{Enum.join(@certificate_types, ", ")}"
    )
    |> trim_name()
    |> unique_constraint([:company_id, :name],
      name: :certificates_company_id_name_index,
      message: "a certificate with this name already exists"
    )
  end

  defp trim_name(changeset) do
    case get_change(changeset, :name) do
      raw when is_binary(raw) -> put_change(changeset, :name, String.trim(raw))
      _ -> changeset
    end
  end
end
