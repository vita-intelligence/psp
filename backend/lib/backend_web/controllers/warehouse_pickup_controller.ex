defmodule BackendWeb.WarehousePickupController do
  @moduledoc """
  Warehouse-operator side of the pickup workflow. Every action gates
  on `warehouse.pick`. Endpoints live under `/api/m/pickup` because
  the consumers are the mobile picker pages — same convention as
  `/m/incoming`, `/m/lots`, `/m/inspections`.

  Lifecycle is column-derived on the MO; this controller just
  dispatches to the Production context which owns the state machine
  + audit.

  Endpoints:

    * `GET    /api/m/pickup-queue`                        — queue
    * `POST   /api/m/pickup/:mo_uuid/start`               — head-of-picker lock
    * `POST   /api/m/pickup/:mo_uuid/abort`               — clear in-flight state
    * `POST   /api/m/pickup/:mo_uuid/bookings/:b_uuid/mark-picked` — per-booking
    * `POST   /api/m/pickup/:mo_uuid/confirm-transfer`    — final, batch movements
  """

  use BackendWeb, :controller

  alias Backend.Production
  alias Backend.Production.{ManufacturingOrder, ManufacturingOrderBooking}
  alias Backend.Repo
  alias BackendWeb.Errors
  alias BackendWeb.Payloads
  alias BackendWeb.Plugs.RequirePermission

  action_fallback BackendWeb.FallbackController

  plug RequirePermission,
       "warehouse.pick"
       when action in [
              :queue,
              :show,
              :start,
              :abort,
              :mark_picked,
              :confirm_transfer,
              :production_feed_cells
            ]

  # GET /api/m/pickup-queue
  # Released MOs whose visibility window has opened and whose pickup
  # isn't yet complete. Sorted by `pickup_by` ascending.
  def queue(conn, _params) do
    actor = conn.assigns.current_user
    entries = Production.list_pickup_queue(actor.company_id)
    json(conn, %{items: Enum.map(entries, &Payloads.pickup_queue_entry/1)})
  end

  # GET /api/m/pickup/production-feed-cells
  # Empty production-feed cells for the confirm-transfer auto-pick.
  # The FE picks the first one as the suggested target; operator can
  # override with a different scan.
  def production_feed_cells(conn, _params) do
    actor = conn.assigns.current_user
    cells = Production.list_empty_production_feed_cells(actor.company_id)

    json(conn, %{
      items:
        Enum.map(cells, fn cell ->
          loc = cell.storage_location

          %{
            id: cell.id,
            uuid: cell.uuid,
            name: cell.name,
            code:
              if(loc,
                do: loc.code || loc.name || cell.name || "Cell ##{cell.id}",
                else: cell.name || "Cell ##{cell.id}"
              ),
            location: loc && %{id: loc.id, uuid: loc.uuid, name: loc.name, code: loc.code}
          }
        end)
    })
  end

  # GET /api/m/pickup/:mo_uuid
  # Full per-MO pickup detail: MO header + bookings (raw + packaging
  # only) + pickup state stamps. The scan flow reads this to render
  # the bookings list, then walks them.
  def show(conn, %{"mo_uuid" => uuid}) do
    actor = conn.assigns.current_user

    case Production.get_manufacturing_order(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %ManufacturingOrder{} = mo ->
        bookings = Production.list_pickup_bookings(mo)

        json(conn, %{
          mo: Payloads.manufacturing_order(mo),
          bookings: Enum.map(bookings, &Payloads.mo_booking/1)
        })
    end
  end

  # POST /api/m/pickup/:mo_uuid/start
  # Stamps pickup_started_* and claims the head-of-picker lock.
  def start(conn, %{"mo_uuid" => uuid}) do
    actor = conn.assigns.current_user

    case Production.get_manufacturing_order(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %ManufacturingOrder{} = mo ->
        case Production.start_mo_pickup(actor, mo) do
          {:ok, updated} ->
            json(conn, %{mo: Payloads.manufacturing_order(updated)})

          {:error, :not_released} ->
            unprocessable(
              conn,
              "not_released",
              "MO isn't released to the warehouse yet."
            )

          {:error, :pickup_already_started} ->
            unprocessable(
              conn,
              "pickup_already_started",
              "Pickup is already in progress."
            )

          {:error, :pickup_already_completed} ->
            unprocessable(
              conn,
              "pickup_already_completed",
              "Pickup has already been transferred to production."
            )

          {:error, %Ecto.Changeset{} = cs} ->
            changeset_error(conn, cs)
        end
    end
  end

  # POST /api/m/pickup/:mo_uuid/abort
  # Clears every booking.picked_at + the MO's pickup_started_*. Lots
  # stay put (no movements were emitted yet).
  def abort(conn, %{"mo_uuid" => uuid}) do
    actor = conn.assigns.current_user

    case Production.get_manufacturing_order(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %ManufacturingOrder{} = mo ->
        case Production.abort_mo_pickup(actor, mo) do
          {:ok, updated} ->
            json(conn, %{mo: Payloads.manufacturing_order(updated)})

          {:error, :pickup_not_in_progress} ->
            unprocessable(
              conn,
              "pickup_not_in_progress",
              "Pickup isn't currently in progress."
            )

          {:error, %Ecto.Changeset{} = cs} ->
            changeset_error(conn, cs)
        end
    end
  end

  # POST /api/m/pickup/:mo_uuid/bookings/:booking_uuid/mark-picked
  # Body: %{"scanned_lot_uuid": "...", "scanned_cell_uuid": "..."}
  #
  # Validates that both scans match the booking's pinned lot + cell,
  # then stamps the booking's picked_at. No stock movement yet.
  def mark_picked(
        conn,
        %{
          "mo_uuid" => mo_uuid,
          "booking_uuid" => booking_uuid,
          "scanned_lot_uuid" => lot_uuid,
          "scanned_cell_uuid" => cell_uuid
        }
      )
      when is_binary(lot_uuid) and is_binary(cell_uuid) do
    actor = conn.assigns.current_user

    with %ManufacturingOrder{} = mo <-
           Production.get_manufacturing_order(actor.company_id, mo_uuid),
         %ManufacturingOrderBooking{} = booking <-
           fetch_mo_booking(mo, booking_uuid) do
      case Production.mark_booking_picked(actor, booking, lot_uuid, cell_uuid) do
        {:ok, updated} ->
          json(conn, %{booking: Payloads.mo_booking(updated)})

        {:error, :pickup_not_in_progress} ->
          unprocessable(
            conn,
            "pickup_not_in_progress",
            "Tap Start Pickup before scanning."
          )

        {:error, :booking_not_pickable} ->
          unprocessable(
            conn,
            "booking_not_pickable",
            "Booking is cancelled or already consumed."
          )

        {:error, :wrong_lot} ->
          unprocessable(
            conn,
            "wrong_lot",
            "Scanned lot doesn't match the expected booking — check the label."
          )

        {:error, :wrong_cell} ->
          unprocessable(
            conn,
            "wrong_cell",
            "Scanned cell doesn't match where this lot was booked from."
          )

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      nil -> not_found(conn)
    end
  end

  def mark_picked(conn, _),
    do:
      unprocessable(
        conn,
        "invalid_payload",
        "Pass scanned_lot_uuid + scanned_cell_uuid as strings."
      )

  # POST /api/m/pickup/:mo_uuid/confirm-transfer
  # Body: %{
  #   "production_cell_uuid": "...",
  #   "photo_urls_by_booking_uuid": %{"<booking-uuid>" => "<photo-url>"}
  # }
  #
  # Final action — emits one Stock.Movement per booking, stamps
  # pickup_completed_*. All-or-nothing: any failure rolls back.
  def confirm_transfer(
        conn,
        %{
          "mo_uuid" => mo_uuid,
          "production_cell_uuid" => target_uuid,
          "photo_urls_by_booking_uuid" => photos
        }
      )
      when is_binary(target_uuid) and is_map(photos) do
    actor = conn.assigns.current_user

    case Production.get_manufacturing_order(actor.company_id, mo_uuid) do
      nil ->
        not_found(conn)

      %ManufacturingOrder{} = mo ->
        case Production.confirm_pickup_transfer(actor, mo, target_uuid, photos) do
          {:ok, updated} ->
            json(conn, %{mo: Payloads.manufacturing_order(updated)})

          {:error, :pickup_not_in_progress} ->
            unprocessable(
              conn,
              "pickup_not_in_progress",
              "Pickup isn't currently in progress."
            )

          {:error, :bookings_not_all_picked} ->
            unprocessable(
              conn,
              "bookings_not_all_picked",
              "Scan every booking before confirming the transfer."
            )

          {:error, :no_bookings_to_transfer} ->
            unprocessable(
              conn,
              "no_bookings_to_transfer",
              "Nothing booked to transfer."
            )

          {:error, :production_cell_not_found} ->
            unprocessable(
              conn,
              "production_cell_not_found",
              "Production cell doesn't exist."
            )

          {:error, :production_cell_wrong_purpose} ->
            unprocessable(
              conn,
              "production_cell_wrong_purpose",
              "Scanned cell isn't a production-feed cell."
            )

          {:error, :placement_not_found} ->
            unprocessable(
              conn,
              "placement_not_found",
              "Booked lot is no longer at its origin cell — abort and re-pick."
            )

          {:error, :insufficient_qty} ->
            unprocessable(
              conn,
              "insufficient_qty",
              "Booked qty isn't available at the origin cell anymore."
            )

          {:error, %Ecto.Changeset{} = cs} ->
            changeset_error(conn, cs)
        end
    end
  end

  def confirm_transfer(conn, _),
    do:
      unprocessable(
        conn,
        "invalid_payload",
        "Pass production_cell_uuid + photo_urls_by_booking_uuid."
      )

  # ----- helpers ---------------------------------------------------

  defp fetch_mo_booking(%ManufacturingOrder{id: mo_id, company_id: company_id}, uuid)
       when is_binary(uuid) do
    Repo.get_by(ManufacturingOrderBooking,
      uuid: uuid,
      manufacturing_order_id: mo_id,
      company_id: company_id
    )
  end

  defp not_found(conn) do
    conn
    |> put_status(:not_found)
    |> json(Errors.payload("not_found", "Not found.", %{}))
  end

  defp unprocessable(conn, code, detail) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(Errors.payload(code, detail, %{}))
  end

  defp changeset_error(conn, cs) do
    payload =
      Errors.payload(
        "validation_failed",
        "One or more fields failed validation.",
        Errors.changeset_fields(cs)
      )

    conn
    |> put_status(:unprocessable_entity)
    |> json(payload)
  end
end
