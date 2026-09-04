defmodule Backend.ThreePL.Dispatch do
  @moduledoc """
  One outbound send-out of a bailee lot, split into two lifecycle
  steps:

    1. **Request** (desktop). Desktop operator types qty + optional
       reference / notes and confirms. Row is inserted with
       `status = "pending"`, `requested_by_id` + `requested_at`
       stamped, evidence fields left null. No Stock.Movement fires.

    2. **Complete** (mobile). Warehouse picker scans the source
       three_pl_storage cell + the lot QR to confirm the pick,
       walks the qty to the shipping bay, scans the destination
       dispatch cell + takes a photo, confirms. THAT step flips
       `status = "completed"`, populates `dispatched_by_id`,
       `dispatched_at`, `photo_url`, and writes the physical
       Stock.Movement in the same transaction.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Shipments.Shipment
  alias Backend.Stock.Lot
  alias Backend.Warehouses.StorageCell

  # Extended lifecycle:
  #   pending        — desktop request queued, picker owes the walk out
  #   completed      — walked, lot in a dispatch cell, Shipment exists
  #   return_pending — the shipment was cancelled, picker owes a walk
  #                    back from the dispatch cell to the original 3PL cell
  #   cancelled      — end of life (either cancelled before the walk-out
  #                    or after the walk-back completed)
  @statuses ~w(pending completed return_pending cancelled)
  def statuses, do: @statuses

  # Where the request came from. Drives the mobile picker queue UI
  # (portal / Shopify requests get a badge so the picker knows the
  # customer is watching for a webhook back) + audit trail. Staff
  # remains the default for legacy rows + operator-typed requests.
  @sources ~w(staff portal shopify_webhook custom_api)
  def sources, do: @sources

  schema "three_pl_dispatches" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :qty, :decimal
    field :reference, :string
    field :notes, :string
    field :photo_url, :string
    field :status, :string, default: "pending"
    field :source, :string, default: "staff"
    field :external_reference, :string

    # Customer-supplied ship-to snapshot captured at portal
    # ``Request dispatch`` time. Nullable — desktop-typed requests
    # leave these nil and the outbound Shipment falls back to the
    # customer / CO delivery address. When set, ``spawn_outbound_shipment``
    # hands them straight to ``Backend.Shipments.create_from_lot``
    # so the mobile Paperwork form opens with the address the
    # customer actually asked for.
    field :ship_to_name, :string
    field :ship_to_address, :string
    field :ship_to_country, :string
    # Contact details required by couriers at hand-off — the post
    # office refuses the drop without both. Captured at portal
    # request time + carried through onto the outbound Shipment.
    field :ship_to_email, :string
    field :ship_to_phone, :string

    # Request half — desktop.
    field :requested_at, :utc_datetime
    # Completion half — mobile.
    field :dispatched_at, :utc_datetime

    belongs_to :company, Company
    belongs_to :stock_lot, Lot
    belongs_to :requested_by, User, foreign_key: :requested_by_id
    belongs_to :dispatched_by, User, foreign_key: :dispatched_by_id
    # Original 3PL cell captured at ``complete_dispatch`` time so the
    # cancel-and-return flow knows where to walk the goods back to.
    # See ``Backend.ThreePL.cancel_shipment_and_return_lot/2``.
    belongs_to :return_target_cell, StorageCell, foreign_key: :return_target_cell_id
    # Explicit link to the outbound shipment spawned by this dispatch.
    # Populated by ``Backend.ThreePL.spawn_outbound_shipment/3`` on
    # successful walk-out. The portal payload enrichment prefers this
    # FK over timestamp-based matching, which collided when multiple
    # dispatches walked within the same second (Shopify bursts).
    belongs_to :shipment, Shipment

    timestamps(type: :utc_datetime)
  end

  @doc """
  Desktop dispatch request. Qty + optional reference/notes; no photo
  yet. Backend adds status = "pending" + requested_at + requested_by
  in `Backend.ThreePL.request_dispatch/2`.
  """
  def request_changeset(row, attrs) do
    row
    |> cast(attrs, [
      :company_id,
      :stock_lot_id,
      :qty,
      :reference,
      :notes,
      :status,
      :source,
      :external_reference,
      :requested_by_id,
      :requested_at,
      :ship_to_name,
      :ship_to_address,
      :ship_to_country,
      :ship_to_email,
      :ship_to_phone
    ])
    |> validate_required([
      :company_id,
      :stock_lot_id,
      :qty,
      :status,
      :source,
      :requested_at
    ])
    |> validate_inclusion(:status, @statuses)
    |> validate_inclusion(:source, @sources)
    |> validate_number(:qty, greater_than: 0)
    |> validate_length(:reference, max: 200)
    |> validate_length(:external_reference, max: 200)
    |> validate_length(:ship_to_name, max: 200)
    |> validate_length(:ship_to_address, max: 500)
    |> validate_length(:ship_to_country, is: 2)
    |> validate_length(:ship_to_email, max: 200)
    |> validate_length(:ship_to_phone, max: 60)
    |> upcase_country()
    |> require_ship_to_for_portal_source()
  end

  # Portal-sourced dispatches carry a customer-typed ship-to snapshot
  # that MUST land on the outbound shipment: the courier hands the
  # parcel over to a person at an address in a country and refuses
  # the drop without an email + phone. Staff-typed desktop dispatches
  # skip this — the operator picks up ship-to from the CO defaults on
  # the paperwork form later.
  defp require_ship_to_for_portal_source(changeset) do
    case get_field(changeset, :source) do
      "portal" ->
        changeset
        |> validate_required(
          [
            :ship_to_name,
            :ship_to_address,
            :ship_to_country,
            :ship_to_email,
            :ship_to_phone
          ],
          message: "is required for portal dispatch"
        )
        |> validate_format(
          :ship_to_email,
          ~r/^[^@\s]+@[^@\s]+\.[^@\s]+$/,
          message: "must be a valid email"
        )
        |> validate_length(:ship_to_phone, min: 6)

      _ ->
        changeset
    end
  end

  defp upcase_country(changeset) do
    case get_change(changeset, :ship_to_country) do
      c when is_binary(c) -> put_change(changeset, :ship_to_country, String.upcase(c))
      _ -> changeset
    end
  end

  @doc """
  Mobile completion. Populates photo evidence + completion stamps.
  Backend enforces the status transition (pending → completed) in
  `Backend.ThreePL.complete_dispatch/3`.
  """
  def completion_changeset(row, attrs) do
    row
    |> cast(attrs, [
      :status,
      :photo_url,
      :dispatched_by_id,
      :dispatched_at,
      :return_target_cell_id,
      :shipment_id
    ])
    |> validate_required([:status, :dispatched_by_id, :dispatched_at])
    |> validate_inclusion(:status, ~w(completed cancelled))
    |> validate_length(:photo_url, max: 500)
  end

  @doc """
  Completed → return_pending. Fires when the operator cancels a
  shipment that came from this dispatch — the goods are still in
  the dispatch cell and owe a walk back to bailee custody.
  """
  def return_pending_changeset(row) do
    row
    |> change(%{status: "return_pending"})
    |> validate_inclusion(:status, @statuses)
  end

  @doc """
  Return_pending → cancelled. Fires when the picker completes the
  walk-back from the dispatch cell into the original 3PL cell.
  """
  def return_completed_changeset(row) do
    row
    |> change(%{status: "cancelled"})
    |> validate_inclusion(:status, @statuses)
  end
end
