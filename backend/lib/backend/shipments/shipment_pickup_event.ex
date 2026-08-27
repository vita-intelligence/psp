defmodule Backend.Shipments.ShipmentPickupEvent do
  @moduledoc """
  One truck visit for a shipment. Replaces the old "one shot"
  ``confirm_pickup`` model — a shipment now accumulates a list of
  pickup events, each carrying its own qty + BRCGS Issue 9 § 5.4.6
  checklist + driver / vehicle identity + evidence photos.

  Life story:

      shipment status = ready
        └─ Log event #1: qty = 3_000 of 10_000
             ↳ shipment auto-transitions to ``partially_picked``
        └─ Log event #2: qty = 4_000 (remaining = 3_000)
             ↳ still ``partially_picked``
        └─ Log event #3: qty = 3_000 (drains it)
             ↳ auto-transition to ``picked_up``

  Every event validates:

    * qty > 0 and qty ≤ remaining_qty (shipment.qty − sum of prior
      events' qty),
    * all five checklist booleans = ``true``,
    * at least one evidence photo attached to THIS event
      (enforced by the context on insert, not the changeset).

  Cascade-deleted with the parent shipment so cancelling / deleting
  a shipment doesn't leave orphan event rows.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Shipments.Shipment

  schema "shipment_pickup_events" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :qty, :decimal
    field :picked_up_at, :utc_datetime

    field :driver_name, :string
    field :vehicle_registration, :string
    field :consignment_note_ref, :string

    # Per-truck paperwork. Multi-visit shipments carry one tracking
    # number PER truck (carriers issue one per consignment), a
    # per-truck seal number (regulatory), and a per-truck temperature
    # reading. Editable after departure via the per-event paperwork
    # PATCH endpoint — carriers often email the tracking number after
    # the driver has left the site.
    field :tracking_number, :string
    field :seal_number, :string
    field :temperature_c, :decimal

    field :packaging_intact, :boolean, default: false
    field :labels_verified, :boolean, default: false
    field :vehicle_clean_suitable, :boolean, default: false
    field :transport_condition_acceptable, :boolean, default: false
    field :dispatch_approved, :boolean, default: false

    field :notes, :string

    # Per-event delivery confirmation. A shipment split across
    # multiple truck visits lands at the customer's site over
    # multiple days — each pickup event carries its OWN POD stamp
    # so a Tuesday arrival can be confirmed independently of a
    # Thursday one. Filled either by the customer via the portal
    # or by the PSP customer-service team via the shipment detail
    # page. Nullable until confirmed.
    field :delivered_at, :utc_datetime
    field :recipient_signatory, :string
    field :delivery_notes, :string

    belongs_to :company, Company
    belongs_to :shipment, Shipment
    belongs_to :picked_up_by, User
    belongs_to :delivered_by, User
    belongs_to :created_by, User
    belongs_to :updated_by, User

    has_many :photos, Backend.Shipments.ShipmentPickupFile,
      foreign_key: :shipment_pickup_event_id,
      preload_order: [asc: :inserted_at]

    has_many :delivery_files, Backend.Shipments.ShipmentDeliveryFile,
      foreign_key: :shipment_pickup_event_id,
      preload_order: [asc: :inserted_at]

    timestamps(type: :utc_datetime)
  end

  @checklist_fields ~w(packaging_intact labels_verified vehicle_clean_suitable
                        transport_condition_acceptable dispatch_approved)a

  def checklist_fields, do: @checklist_fields

  def changeset(event, attrs) do
    event
    |> cast(attrs, [
      :company_id,
      :shipment_id,
      :qty,
      :picked_up_at,
      :picked_up_by_id,
      :driver_name,
      :vehicle_registration,
      :consignment_note_ref,
      :tracking_number,
      :seal_number,
      :temperature_c,
      :packaging_intact,
      :labels_verified,
      :vehicle_clean_suitable,
      :transport_condition_acceptable,
      :dispatch_approved,
      :notes,
      :delivered_at,
      :delivered_by_id,
      :recipient_signatory,
      :delivery_notes,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([
      :company_id,
      :shipment_id,
      :qty,
      :picked_up_at,
      :packaging_intact,
      :labels_verified,
      :vehicle_clean_suitable,
      :transport_condition_acceptable,
      :dispatch_approved
    ])
    |> validate_number(:qty, greater_than: 0)
    |> validate_length(:driver_name, max: 200)
    |> validate_length(:vehicle_registration, max: 60)
    |> validate_length(:consignment_note_ref, max: 120)
    |> validate_length(:tracking_number, max: 120)
    |> validate_length(:seal_number, max: 60)
    |> validate_number(:temperature_c, greater_than_or_equal_to: -60, less_than_or_equal_to: 60)
    |> validate_length(:notes, max: 2_000)
    |> validate_length(:recipient_signatory, max: 200)
    |> validate_length(:delivery_notes, max: 2_000)
    |> validate_checklist_all_true()
    |> assoc_constraint(:company)
    |> assoc_constraint(:shipment)
    |> check_constraint(:qty,
      name: :shipment_pickup_events_qty_positive,
      message: "must be greater than zero"
    )
  end

  # Every checklist item must be affirmatively ticked before we log
  # the event. A single ``false`` fails validation with a targeted
  # error so the FE can render "you must tick every box" per row.
  defp validate_checklist_all_true(cs) do
    Enum.reduce(@checklist_fields, cs, fn field, acc ->
      case get_field(acc, field) do
        true -> acc
        _ -> add_error(acc, field, "must be ticked before logging the pickup")
      end
    end)
  end

  @doc """
  Narrow changeset for the per-event POD confirmation. Called
  either by the customer via the portal or by the PSP CS team from
  the shipment detail page. Requires an audit-trail signatory + a
  timestamp; ``delivered_by_id`` is the confirming actor (may be
  ``nil`` when the customer submitted directly, in which case the
  audit rail reads "System (portal)").
  """
  @doc """
  Narrow changeset for editing paperwork on an event AFTER the truck
  has left the site. Carriers frequently email the tracking number
  once the driver has departed; the seal number sometimes needs
  correcting from a smudged handwritten copy; the temperature reading
  is captured from a data-logger download on some fleets.

  Does NOT re-run the checklist gate — those booleans were affirmed
  on the mobile form at pickup time and shouldn't be re-litigated by
  the paperwork edit. Also does NOT touch qty / photos / driver
  identity — those are load-bearing traceability fields amended via
  their own audited flows.
  """
  def paperwork_changeset(event, attrs) do
    event
    |> cast(attrs, [
      :driver_name,
      :vehicle_registration,
      :consignment_note_ref,
      :tracking_number,
      :seal_number,
      :temperature_c,
      :notes,
      :updated_by_id
    ])
    |> validate_length(:driver_name, max: 200)
    |> validate_length(:vehicle_registration, max: 60)
    |> validate_length(:consignment_note_ref, max: 120)
    |> validate_length(:tracking_number, max: 120)
    |> validate_length(:seal_number, max: 60)
    |> validate_number(:temperature_c,
      greater_than_or_equal_to: -60,
      less_than_or_equal_to: 60
    )
    |> validate_length(:notes, max: 2_000)
  end

  def delivery_changeset(event, attrs) do
    event
    |> cast(attrs, [
      :delivered_at,
      :delivered_by_id,
      :recipient_signatory,
      :delivery_notes,
      :updated_by_id
    ])
    |> validate_required([:delivered_at, :recipient_signatory])
    |> validate_length(:recipient_signatory, min: 1, max: 200)
    |> validate_length(:delivery_notes, max: 2_000)
  end
end
