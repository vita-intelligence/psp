defmodule BackendWeb.ProductionCloseoutController do
  @moduledoc """
  Production-worker side of the post-Finish hand-off. The operator
  walks each booked material at the production-feed cell, records
  how much was consumed (0 = fully used), photos any leftovers + the
  produced output, and hands them off to a production-side dispatch
  cell. The warehouse team's "pickup from production" flow will move
  the dispatch cell's contents back to warehouse storage in a later
  slice — this controller doesn't touch the warehouse side.

  Endpoints (all under `/api/m`, mobile-first):

    * `GET  /closeout-queue`
    * `GET  /closeout/:mo_uuid`
    * `GET  /closeout/:mo_uuid/dispatch-cells`
    * `POST /closeout/:mo_uuid/bookings/:booking_uuid`
    * `POST /closeout/:mo_uuid/output-lots/:lot_uuid`
  """

  use BackendWeb, :controller

  alias Backend.Production
  alias Backend.Production.{ManufacturingOrder, ManufacturingOrderBooking}
  alias Backend.Repo
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  action_fallback BackendWeb.FallbackController

  plug RequirePermission,
       "production.closeout"
       when action in [
              :queue,
              :show,
              :dispatch_cells,
              :close_booking,
              :close_output
            ]

  def queue(conn, _params) do
    actor = conn.assigns.current_user
    mos = Production.list_closeout_queue(actor.company_id)
    json(conn, %{items: Enum.map(mos, &Payloads.closeout_queue_entry/1)})
  end

  def show(conn, %{"mo_uuid" => uuid}) do
    actor = conn.assigns.current_user

    case Production.get_closeout_detail(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      {:error, :not_completed} ->
        unprocessable(
          conn,
          "not_completed",
          "Closeout is only valid for completed MOs."
        )

      {:error, :awaiting_output_qc} ->
        unprocessable(
          conn,
          "awaiting_output_qc",
          "This MO's produced output hasn't been signed off in Output QC yet. Run Output QC first — closeout opens once the lot passes QA."
        )

      %{
        mo: mo,
        bookings: bookings,
        output_lots: output_lots,
        output_lot_reservations: reservations
      } ->
        json(conn, %{
          mo: Payloads.manufacturing_order(mo),
          bookings: Enum.map(bookings, &Payloads.mo_booking/1),
          output_lots:
            Enum.map(output_lots, fn lot ->
              Payloads.closeout_output_lot(lot, Map.get(reservations, lot.id, []))
            end)
        })
    end
  end

  def dispatch_cells(conn, %{"mo_uuid" => uuid}) do
    actor = conn.assigns.current_user
    cells = Production.list_dispatch_cells_for_mo(actor.company_id, uuid)

    json(conn, %{
      items: Enum.map(cells, &Payloads.dispatch_cell/1)
    })
  end

  def close_booking(conn, %{"booking_uuid" => booking_uuid} = params) do
    actor = conn.assigns.current_user

    with %ManufacturingOrderBooking{} = booking <-
           Repo.get_by(ManufacturingOrderBooking, uuid: booking_uuid),
         true <- booking.company_id == actor.company_id || :forbidden,
         {:ok, updated} <- Production.closeout_booking(actor, booking, params) do
      json(conn, %{booking: Payloads.mo_booking(updated)})
    else
      nil ->
        not_found(conn, "Booking not found.")

      :forbidden ->
        unprocessable(conn, "forbidden", "Booking belongs to another company.")

      {:error, :already_closed} ->
        unprocessable(
          conn,
          "already_closed",
          "This booking has already been closed out."
        )

      {:error, :output_qc_pending} ->
        unprocessable(
          conn,
          "output_qc_pending",
          "Output QC hasn't signed off this MO's produced lots yet. The QC operator must pass or fail each output lot before booking closeout (and any leftover routing) can be recorded."
        )

      {:error, :bad_remaining_qty} ->
        unprocessable(
          conn,
          "bad_remaining_qty",
          "Remaining qty must be a non-negative number."
        )

      {:error, :remaining_exceeds_on_hand} ->
        unprocessable(
          conn,
          "remaining_exceeds_on_hand",
          "Remaining qty can't exceed the lot's on-hand quantity."
        )

      {:error, :photo_or_skip_required} ->
        unprocessable(
          conn,
          "photo_or_skip_required",
          "Add a photo or pick a skip-reason — every closeout movement needs one or the other (BRCGS / FSSC traceability)."
        )

      {:error, :missing_dispatch_cell} ->
        unprocessable(
          conn,
          "missing_dispatch_cell",
          "Scan a production-dispatch cell to hand the remainder over."
        )

      {:error, :dispatch_cell_required} ->
        unprocessable(
          conn,
          "dispatch_cell_required",
          "Destination cell must have purpose=dispatch."
        )

      {:error, :cell_not_found} ->
        unprocessable(conn, "cell_not_found", "Scanned cell wasn't found.")

      {:error, {:move_failed, reason}} ->
        unprocessable(
          conn,
          "move_failed",
          "Couldn't move the remainder: #{inspect(reason)}"
        )

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)

      {:error, reason} ->
        unprocessable(conn, "closeout_failed", inspect(reason))
    end
  end

  def close_output(conn, %{"lot_uuid" => lot_uuid} = params) do
    actor = conn.assigns.current_user

    case Production.closeout_output_lot(actor, lot_uuid, params) do
      {:ok, {:reserved, lot, reservations}} ->
        # Reserved-in-place path: the output lot is already booked
        # to a live downstream MO, so closeout skips the dispatch
        # move. Return the lot + a `reserved_by` summary so the FE
        # can render the "left in place — reserved for MO-X" chip.
        json(conn, %{
          lot: Payloads.stock_lot(lot),
          reserved: true,
          reserved_by:
            Enum.map(reservations, fn r ->
              %{
                mo_uuid: r.mo_uuid,
                # `mo_code` is a rendered numbering label (e.g.
                # "MO00047") — not a column. `render_code/2` resolves
                # it from the MO's `id` via the tenant's numbering
                # sequence at serialisation time.
                mo_code: Payloads.render_code(%{id: r.mo_id}, "manufacturing_order"),
                qty: to_string(r.qty)
              }
            end)
        })

      {:ok, lot} ->
        json(conn, %{lot: Payloads.stock_lot(lot)})

      {:error, :lot_not_found} ->
        not_found(conn, "Lot not found.")

      {:error, {:wrong_status, status}} ->
        unprocessable(
          conn,
          "wrong_status",
          "Output lot is in #{status} — can't dispatch until QC passes it to `available`."
        )

      {:error, :not_reserved} ->
        unprocessable(
          conn,
          "not_reserved",
          "\"Keep in place\" only applies when the lot is reserved for a downstream MO. This one isn't — scan a dispatch cell instead."
        )

      {:error, :missing_dispatch_cell} ->
        unprocessable(
          conn,
          "missing_dispatch_cell",
          "Scan a production-dispatch cell to hand the output over."
        )

      {:error, :dispatch_cell_required} ->
        unprocessable(
          conn,
          "dispatch_cell_required",
          "Destination cell must have purpose=dispatch."
        )

      {:error, :cell_not_found} ->
        unprocessable(conn, "cell_not_found", "Scanned cell wasn't found.")

      {:error, {:move_failed, reason}} ->
        unprocessable(
          conn,
          "move_failed",
          "Couldn't move the output: #{inspect(reason)}"
        )

      {:error, reason} ->
        unprocessable(conn, "closeout_failed", inspect(reason))
    end
  end

  defp not_found(conn, detail \\ "Not found.") do
    conn
    |> put_status(:not_found)
    |> json(Errors.payload("not_found", detail, %{}))
  end

  defp unprocessable(conn, code, detail) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(Errors.payload(code, detail, %{}))
  end

  defp changeset_error(conn, cs) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(
      Errors.payload(
        "validation_failed",
        "One or more fields failed validation.",
        Errors.changeset_fields(cs)
      )
    )
  end
end
