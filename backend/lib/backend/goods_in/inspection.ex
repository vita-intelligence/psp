defmodule Backend.GoodsIn.Inspection do
  @moduledoc """
  One BRCGS 3.5.1 / FSSC 22000 incoming-inspection record against a
  delivery on a PO.

  Status flow (driven by `Backend.GoodsIn`):

      draft
        ↓ sign_operator    (operator fills sections + signs as goods-in operator)
      submitted
        ↓ sign_quality     (quality approver signs + records the verdict)
      approved | hold | rejected   (terminal — `quality_decision`)

  Section JSONB columns each carry a map of check_key →
  `%{passed: bool, notes: string?}`. Allowed keys per section live in
  the boundary module; the schema only enforces shape (map of maps).

  Display code (`GI00001`, …) is rendered from `id` + the company's
  numbering format — no stored `code` column.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.GoodsIn.{InspectionFile, InspectionItem}
  alias Backend.Purchasing.PurchaseOrder

  @statuses ~w(draft submitted approved hold rejected)
  @quality_decisions ~w(approved hold rejected)

  schema "goods_in_inspections" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :status, :string, default: "draft"

    # Section 1 — Delivery information.
    field :delivery_date, :date
    field :delivery_time, :time
    field :transport_company, :string
    field :vehicle_registration, :string
    field :seal_number, :string

    # Sections 2 / 4-7 — JSONB check bags.
    field :vehicle_inspection, :map, default: %{}
    field :documentation_verification, :map, default: %{}
    field :physical_inspection, :map, default: %{}
    field :food_safety_checks, :map, default: %{}
    field :storage_verification, :map, default: %{}

    # Section 8 — Final quality decision (set by approver-sign).
    field :quality_decision, :string
    field :quality_decision_reason, :string

    # Goods-in operator ESIGN.
    field :goods_in_operator_signature_image, :string
    field :goods_in_operator_signed_at, :utc_datetime

    # Quality approver ESIGN.
    field :quality_approver_signature_image, :string
    field :quality_approver_signed_at, :utc_datetime

    belongs_to :company, Company
    belongs_to :purchase_order, PurchaseOrder
    belongs_to :goods_in_operator, User
    belongs_to :quality_approver, User
    belongs_to :created_by, User
    belongs_to :updated_by, User

    has_many :items, InspectionItem, foreign_key: :goods_in_inspection_id
    has_many :files, InspectionFile, foreign_key: :goods_in_inspection_id

    timestamps(type: :utc_datetime)
  end

  def statuses, do: @statuses
  def quality_decisions, do: @quality_decisions

  @doc """
  Draft-create changeset. Identity columns (company, PO) + section 1
  delivery info are the bare minimum the operator captures before the
  inspection becomes useful; section 2-7 JSONBs default to empty and
  get filled by `update_section/4` patches.
  """
  def create_changeset(inspection, attrs) do
    inspection
    |> cast(attrs, [
      :company_id,
      :purchase_order_id,
      :delivery_date,
      :delivery_time,
      :transport_company,
      :vehicle_registration,
      :seal_number,
      :vehicle_inspection,
      :documentation_verification,
      :physical_inspection,
      :food_safety_checks,
      :storage_verification,
      :created_by_id,
      :updated_by_id
    ])
    |> put_change(:status, "draft")
    |> validate_required([
      :company_id,
      :purchase_order_id,
      :delivery_date
    ])
    |> validate_length(:transport_company, max: 160)
    |> validate_length(:vehicle_registration, max: 40)
    |> validate_length(:seal_number, max: 80)
  end

  @doc """
  Section 1 patch — delivery info edits while the inspection is still
  in draft. Refusing a write after `draft` is the boundary's job; we
  only carry the shape here.
  """
  def delivery_info_changeset(inspection, attrs) do
    inspection
    |> cast(attrs, [
      :delivery_date,
      :delivery_time,
      :transport_company,
      :vehicle_registration,
      :seal_number,
      :updated_by_id
    ])
    |> validate_required([:delivery_date])
    |> validate_length(:transport_company, max: 160)
    |> validate_length(:vehicle_registration, max: 40)
    |> validate_length(:seal_number, max: 80)
  end

  @doc """
  Section 2 / 4-7 JSONB patch. Callers pass the whole new map for one
  section — partial merges are the boundary's responsibility because
  the boundary owns the allowed-key registry per section.
  """
  def section_changeset(inspection, field, value, actor_id)
      when field in [
             :vehicle_inspection,
             :documentation_verification,
             :physical_inspection,
             :food_safety_checks,
             :storage_verification
           ] do
    inspection
    |> cast(%{field => value, updated_by_id: actor_id}, [field, :updated_by_id])
    |> validate_required([field])
  end

  @doc """
  Operator-sign transition: draft → submitted. Stamps the operator's
  signature image, FK, and signed_at. Validates only the shape; the
  boundary enforces "all sections touched + every PO line decided"
  before invoking this changeset.
  """
  def operator_sign_changeset(inspection, attrs) do
    inspection
    |> cast(attrs, [
      :goods_in_operator_id,
      :goods_in_operator_signature_image,
      :goods_in_operator_signed_at,
      :updated_by_id
    ])
    |> put_change(:status, "submitted")
    |> validate_required([
      :goods_in_operator_id,
      :goods_in_operator_signed_at
    ])
  end

  @doc """
  Approver-sign transition: submitted → approved | hold | rejected.
  Stamps the approver's signature + records the verdict + reason.
  `quality_decision_reason` is required when the decision isn't
  `approved`.
  """
  def approver_sign_changeset(inspection, attrs) do
    inspection
    |> cast(attrs, [
      :quality_approver_id,
      :quality_approver_signature_image,
      :quality_approver_signed_at,
      :quality_decision,
      :quality_decision_reason,
      :status,
      :updated_by_id
    ])
    |> validate_required([
      :quality_approver_id,
      :quality_approver_signed_at,
      :quality_decision,
      :status
    ])
    |> validate_inclusion(:status, @statuses)
    |> validate_inclusion(:quality_decision, @quality_decisions)
    |> validate_decision_reason()
    |> validate_length(:quality_decision_reason, max: 2000)
  end

  defp validate_decision_reason(changeset) do
    case get_field(changeset, :quality_decision) do
      decision when decision in ["hold", "rejected"] ->
        case get_field(changeset, :quality_decision_reason) do
          nil ->
            add_error(changeset, :quality_decision_reason, "is required for hold/reject")

          "" ->
            add_error(changeset, :quality_decision_reason, "is required for hold/reject")

          _ ->
            changeset
        end

      _ ->
        changeset
    end
  end
end
