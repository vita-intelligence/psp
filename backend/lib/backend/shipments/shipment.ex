defmodule Backend.Shipments.Shipment do
  @moduledoc """
  Customer-facing outbound shipment record — the BRCGS Issue 9 §
  5.4.6 receipt trail. One row per lot leaving the warehouse in a
  dispatch cell (bailee custody or own-stock direct shipment). See
  `Backend.Shipments` for lifecycle helpers.

  Ownership of the row's editability follows `status`:

    * `draft` — everything editable, still being filled out. Only
      the desktop shipment form writes here.
    * `ready` — paperwork complete, waiting for the truck. Editable
      still (correcting a typo pre-pickup is fine); status flips
      via `mark_ready/2` / `mark_draft/2`.
    * `picked_up` — driver signed and left. Immutable.
    * `cancelled` — never left. Immutable.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.CustomerOrders.CustomerOrder
  alias Backend.Customers.Customer
  alias Backend.Stock.Lot

  @statuses ~w(draft ready picked_up cancelled)
  def statuses, do: @statuses

  # Fields the desktop form + mobile scan flow can touch. Status is
  # driven by dedicated changesets (`ready_changeset` / friends) so
  # it can't be mutated behind the operator's back.
  @editable_fields ~w(
    customer_id
    customer_order_id
    recipient_name
    ship_to_address
    ship_to_country
    carrier
    vehicle_registration
    driver_name
    consignment_note_ref
    seal_number
    temperature_c
    qty
    planned_ship_at
    notes
    loading_photo_url
  )a

  schema "shipments" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :status, :string, default: "draft"

    field :recipient_name, :string
    field :ship_to_address, :string
    field :ship_to_country, :string

    field :carrier, :string
    field :vehicle_registration, :string
    field :driver_name, :string
    field :consignment_note_ref, :string
    field :seal_number, :string
    field :temperature_c, :decimal

    field :qty, :decimal

    field :planned_ship_at, :utc_datetime
    field :notes, :string
    field :loading_photo_url, :string

    field :ready_at, :utc_datetime
    field :picked_up_at, :utc_datetime
    field :cancelled_at, :utc_datetime
    field :cancel_reason, :string

    belongs_to :company, Company
    belongs_to :stock_lot, Lot
    belongs_to :customer, Customer
    belongs_to :customer_order, CustomerOrder
    belongs_to :created_by, User
    belongs_to :ready_by, User
    belongs_to :picked_up_by, User
    belongs_to :cancelled_by, User

    timestamps(type: :utc_datetime)
  end

  @doc """
  First-insert of a fresh draft — set at creation via
  `Backend.Shipments.create_from_lot/2`. Requires the lot + creator +
  qty; everything else is filled in later by the desktop form.
  """
  def create_changeset(shipment, attrs) do
    shipment
    |> cast(attrs, [
      :company_id,
      :stock_lot_id,
      :customer_id,
      :customer_order_id,
      :qty,
      :created_by_id,
      :status
    ])
    |> validate_required([:company_id, :stock_lot_id, :qty, :created_by_id])
    |> validate_number(:qty, greater_than: 0)
    |> validate_inclusion(:status, @statuses)
  end

  @doc """
  Desktop form edits. Cast + validate the full editable field set.
  Country codes are 2 chars (ISO 3166-1 alpha-2), consignment note
  refs and vehicle plates get length caps that match audit-friendly
  field sizes.
  """
  def update_changeset(shipment, attrs) do
    shipment
    |> cast(attrs, @editable_fields)
    |> validate_number(:qty, greater_than: 0)
    |> validate_length(:recipient_name, max: 200)
    |> validate_length(:ship_to_address, max: 2000)
    |> validate_length(:ship_to_country, is: 2)
    |> validate_length(:carrier, max: 200)
    |> validate_length(:vehicle_registration, max: 40)
    |> validate_length(:driver_name, max: 200)
    |> validate_length(:consignment_note_ref, max: 80)
    |> validate_length(:seal_number, max: 60)
    |> validate_length(:notes, max: 2000)
    |> validate_length(:loading_photo_url, max: 500)
    |> maybe_validate_upcase(:ship_to_country)
  end

  @doc "Draft → ready. Requires the mandatory paperwork fields."
  def ready_changeset(shipment, attrs) do
    shipment
    |> cast(attrs, [:ready_at, :ready_by_id])
    |> put_change(:status, "ready")
    |> validate_required([:ready_at, :ready_by_id])
    |> validate_ready_prereqs()
  end

  @doc "Ready → draft. Editors go back to correcting fields."
  def unready_changeset(shipment) do
    shipment
    |> change(%{status: "draft", ready_at: nil, ready_by_id: nil})
  end

  @doc "Ready → picked_up. Placeholder shape — the full truck-arrival " <>
         "form on mobile lives in a follow-up slice."
  def pickup_changeset(shipment, attrs) do
    shipment
    |> cast(attrs, [:picked_up_at, :picked_up_by_id])
    |> put_change(:status, "picked_up")
    |> validate_required([:picked_up_at, :picked_up_by_id])
  end

  @doc "Draft | Ready → cancelled."
  def cancel_changeset(shipment, attrs) do
    shipment
    |> cast(attrs, [:cancelled_at, :cancelled_by_id, :cancel_reason])
    |> put_change(:status, "cancelled")
    |> validate_required([:cancelled_at, :cancelled_by_id])
    |> validate_length(:cancel_reason, max: 500)
  end

  # BRCGS 5.4.6 wants recipient + address + carrier + vehicle + driver
  # + waybill on file before the truck leaves. Temperature + seal are
  # conditional on chill / sealed loads but we're not modelling those
  # gates yet — added when the item type carries a flag.
  defp validate_ready_prereqs(changeset) do
    required = [
      :recipient_name,
      :ship_to_address,
      :ship_to_country,
      :carrier,
      :vehicle_registration,
      :driver_name,
      :consignment_note_ref
    ]

    Enum.reduce(required, changeset, fn field, cs ->
      case get_field(cs, field) do
        v when is_binary(v) and byte_size(v) > 0 -> cs
        _ -> add_error(cs, field, "is required before marking Ready")
      end
    end)
  end

  defp maybe_validate_upcase(changeset, field) do
    case get_field(changeset, field) do
      v when is_binary(v) ->
        upper = String.upcase(v)
        if v == upper, do: changeset, else: put_change(changeset, field, upper)

      _ ->
        changeset
    end
  end
end
