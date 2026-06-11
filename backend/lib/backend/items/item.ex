defmodule Backend.Items.Item do
  @moduledoc """
  Core stock item — name + type + identity. Per-type compliance lives
  in 1:1 joined subtables (Slice 2-4); this row is the parent
  everything else hangs off of.

  `attributes` is a JSONB bag of per-tenant custom fields, validated
  by the context against `attribute_definitions` for this item's type
  before write. Universal regulatory dimensions DO NOT live here —
  see `Backend.Items.RawMaterialCompliance` etc.

  Display code is rendered from id + numbering format in
  `BackendWeb.Payloads`. No `code` column stored.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Allergens.Allergen
  alias Backend.Catalogs.ProductFamily
  alias Backend.Companies.Company
  alias Backend.Items.{
    FinishedProductSpec,
    ItemAllergen,
    ItemFile,
    PackagingCompliance,
    RawMaterialCompliance,
    RawMaterialRiskAssessment
  }
  alias Backend.Units.UnitOfMeasurement

  @valid_item_types ~w(raw_material semi_finished finished_product packaging)
  @compliance_statuses ~w(draft ready_for_use)

  schema "items" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :name, :string
    field :description, :string
    field :item_type, :string
    field :external_sku, :string
    field :barcode, :string
    field :attributes, :map, default: %{}
    # Storage requirement tags — the receive form filters
    # destination cells to those whose effective tags
    # (location.tags ∪ cell.tags) are a superset. Shares the
    # company-scoped storage_tags registry.
    field :storage_tags, {:array, :string}, default: []
    field :is_active, :boolean, default: true

    # Two-state regulatory gate. New items start `draft`; PO lines,
    # BOM assembly, and finished-product release refuse `draft` items
    # so the form is enforced as a hard structural rule, not a UX nag.
    # Transition is validated by `Backend.Items.Compliance.check/1`.
    field :compliance_status, :string, default: "draft"
    field :compliance_readied_at, :utc_datetime
    field :compliance_revert_reason, :string

    # Typical packaging template — when set, the receive form copies
    # these values into the new lot. Operator can override per-lot if
    # this particular batch ships differently. Shape mirrors the lot
    # packaging columns:
    #
    #   %{
    #     "length_mm" => 400, "width_mm" => 400, "height_mm" => 600,
    #     "weight_kg" => "27.500",
    #     "units_per_package" => 25, "stack_factor" => 2
    #   }
    field :default_packaging, :map

    belongs_to :company, Company
    belongs_to :stock_uom, UnitOfMeasurement
    belongs_to :product_family, ProductFamily
    belongs_to :created_by, User
    belongs_to :updated_by, User
    belongs_to :compliance_readied_by, User

    # Per-type compliance subtables — only one is meaningfully
    # populated per item, depending on `item_type`. The controller
    # preloads the matching one based on type for the show payload.
    has_one :raw_material_compliance, RawMaterialCompliance,
      foreign_key: :item_id,
      on_delete: :delete_all

    has_one :raw_material_risk, RawMaterialRiskAssessment,
      foreign_key: :item_id,
      on_delete: :delete_all

    has_one :finished_product_spec, FinishedProductSpec,
      foreign_key: :item_id,
      on_delete: :delete_all

    has_one :packaging_compliance, PackagingCompliance,
      foreign_key: :item_id,
      on_delete: :delete_all

    # Certificate attachments. Each row joins to a `certificates`
    # registry definition + carries its own validity window.
    has_many :certificate_attachments, Backend.Certificates.ItemCertificate,
      foreign_key: :item_id,
      on_delete: :delete_all

    # Image gallery. Bytes stored via the Storage adapter; this row
    # carries the blob path + metadata. Primary-first ordering is
    # enforced at the read side.
    has_many :images, Backend.Items.ItemImage,
      foreign_key: :item_id,
      on_delete: :delete_all

    # Compliance file attachments (spec sheet, food-contact DoC,
    # migration test report, …). The per-type subtables carry FKs to
    # specific rows; this `has_many` is for the file-management surface.
    has_many :files, ItemFile,
      foreign_key: :item_id,
      on_delete: :delete_all

    # Allergen M:N via item_allergens, joined through the global
    # allergen lookup. Populated only on raw-material items today;
    # the FE form gates the section on item_type.
    many_to_many :allergens, Allergen,
      join_through: ItemAllergen,
      join_keys: [item_id: :id, allergen_id: :id],
      on_replace: :delete

    timestamps(type: :utc_datetime)
  end

  def valid_item_types, do: @valid_item_types
  def compliance_statuses, do: @compliance_statuses

  def changeset(item, attrs) do
    item
    |> cast(attrs, [
      :company_id,
      :name,
      :description,
      :item_type,
      :external_sku,
      :barcode,
      :stock_uom_id,
      :product_family_id,
      :attributes,
      :storage_tags,
      :default_packaging,
      :is_active,
      :compliance_status,
      :compliance_readied_at,
      :compliance_readied_by_id,
      :compliance_revert_reason,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([:company_id, :name, :item_type])
    |> trim_strings([:name, :external_sku, :barcode])
    |> validate_length(:name, min: 1, max: 200)
    |> validate_length(:external_sku, max: 80)
    |> validate_length(:barcode, max: 24)
    |> validate_inclusion(:item_type, @valid_item_types,
      message: "must be one of: #{Enum.join(@valid_item_types, ", ")}"
    )
    |> validate_inclusion(:compliance_status, @compliance_statuses,
      message: "must be one of: #{Enum.join(@compliance_statuses, ", ")}"
    )
    |> normalise_storage_tags()
    |> validate_storage_tag_membership()
    |> unique_constraint([:company_id, :name],
      name: :items_company_id_name_index,
      message: "an item with this name already exists"
    )
    |> unique_constraint([:company_id, :external_sku],
      name: :items_company_id_external_sku_index,
      message: "this external SKU is already in use"
    )
  end

  # Same normalisation as StorageLocation: lowercase trim, drop
  # blanks, dedupe. Keeps cell.tags and item.storage_tags equal-by-
  # value so the receive-form filter is a simple set check.
  defp normalise_storage_tags(changeset) do
    case get_change(changeset, :storage_tags) do
      nil ->
        changeset

      list when is_list(list) ->
        clean =
          list
          |> Enum.map(fn t -> t |> to_string() |> String.trim() |> String.downcase() end)
          |> Enum.reject(&(&1 == ""))
          |> Enum.uniq()

        put_change(changeset, :storage_tags, clean)

      _ ->
        add_error(changeset, :storage_tags, "must be a list of strings")
    end
  end

  defp validate_storage_tag_membership(changeset) do
    company_id = get_field(changeset, :company_id)

    if is_integer(company_id) do
      Backend.Warehouses.StorageTags.validate_tag_membership(
        changeset,
        :storage_tags,
        company_id
      )
    else
      changeset
    end
  end

  defp trim_strings(changeset, fields) do
    Enum.reduce(fields, changeset, fn field, cs ->
      case get_change(cs, field) do
        raw when is_binary(raw) ->
          trimmed = String.trim(raw)

          if trimmed == "" do
            put_change(cs, field, nil)
          else
            put_change(cs, field, trimmed)
          end

        _ ->
          cs
      end
    end)
  end
end
