defmodule Backend.Vendors.VendorCertificate do
  @moduledoc """
  Per-vendor certificate attachment. Same shape as `item_certificates`
  — a join row that points at a definition in `certificates` (GMP,
  ISO 22000, BRC, FSSC, halal, kosher, organic, …) and carries the
  concrete instance metadata (certificate number, validity window,
  scanned document URL).

  Replaces MRPEasy's "QMS Certification / Halal / Kosher / Organic"
  hardcoded dropdowns — one cert registry, one validity workflow,
  consistent expiry queues across items and vendors.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Certificates.Certificate
  alias Backend.Companies.Company
  alias Backend.Vendors.{Vendor, VendorFile}

  schema "vendor_certificates" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :certificate_number, :string
    field :valid_from, :date
    field :valid_until, :date
    field :notes, :string

    field :uploaded_at, :utc_datetime

    belongs_to :vendor, Vendor
    belongs_to :certificate, Certificate
    belongs_to :company, Company
    belongs_to :uploaded_by, User
    belongs_to :document_file, VendorFile

    timestamps(type: :utc_datetime)
  end

  def changeset(row, attrs) do
    row
    |> cast(attrs, [
      :vendor_id,
      :certificate_id,
      :company_id,
      :uploaded_by_id,
      :uploaded_at,
      :certificate_number,
      :valid_from,
      :valid_until,
      :document_file_id,
      :notes
    ])
    |> validate_required([:vendor_id, :certificate_id, :company_id])
    |> validate_length(:certificate_number, max: 120)
    |> validate_length(:notes, max: 2000)
    |> validate_validity_window()
    |> unique_constraint([:vendor_id, :certificate_id],
      name: :vendor_certificates_vendor_certificate_index,
      message: "this vendor already has that certificate on file"
    )
  end

  defp validate_validity_window(changeset) do
    from = get_field(changeset, :valid_from)
    until = get_field(changeset, :valid_until)

    if is_struct(from, Date) and is_struct(until, Date) and Date.compare(until, from) != :gt do
      add_error(changeset, :valid_until, "must be after valid_from")
    else
      changeset
    end
  end
end
