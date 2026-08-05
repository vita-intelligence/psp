defmodule BackendWeb.ProductionPreflightController do
  @moduledoc """
  Production-operator side of the post-pickup, pre-`in_progress`
  receipt check. The warehouse picker hands a load of raw materials /
  packaging to the production-feed cell; this controller's actions
  let the production operator weigh / count each lot and stamp a
  quality sign-off. Once every raw / packaging booking on the MO has
  `received_at` set, the MO is eligible for the
  `scheduled → in_progress` transition.

  All actions are gated on `production.preflight`. Endpoints live
  under `/api/m/preflight` so the mobile pages can reach them with
  device-token or session-token auth.

  Endpoints:

    * `GET  /api/m/preflight-queue`
    * `GET  /api/m/preflight/:mo_uuid`
    * `POST /api/m/preflight/:mo_uuid/bookings/:booking_uuid/receive`
  """

  use BackendWeb, :controller

  alias Backend.Production
  alias Backend.Production.{ManufacturingOrder, ManufacturingOrderBooking}
  alias Backend.Repo
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  action_fallback BackendWeb.FallbackController

  plug RequirePermission,
       "production.preflight" when action in [:queue, :show, :receive_booking]

  # GET /api/m/preflight-queue
  def queue(conn, _params) do
    actor = conn.assigns.current_user
    entries = Production.list_preflight_queue(actor.company_id)

    json(conn, %{
      items: Enum.map(entries, &Payloads.preflight_queue_entry/1)
    })
  end

  # GET /api/m/preflight/:mo_uuid
  def show(conn, %{"mo_uuid" => uuid}) do
    actor = conn.assigns.current_user

    case Production.get_preflight_detail(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %{mo: mo, bookings: bookings} ->
        # Look up the last put-away photo per lot so the FE can render
        # a "this is what the container looked like" thumbnail on
        # every booking row. Same shape the pickup show endpoint
        # uses — operator recognises the drum / pouch by eye rather
        # than by rack code alone. Without this map the FE thumbs
        # render the empty-camera fallback for every row.
        last_photo_urls =
          bookings
          |> Enum.map(& &1.stock_lot_id)
          |> Enum.reject(&is_nil/1)
          |> Enum.uniq()
          |> then(&Backend.Stock.last_photo_url_by_lot_ids(actor.company_id, &1))

        json(conn, %{
          mo: Payloads.manufacturing_order(mo),
          bookings: Enum.map(bookings, &Payloads.mo_booking(&1, last_photo_urls)),
          preflight_complete: Production.mo_preflight_complete?(mo)
        })
    end
  end

  # POST /api/m/preflight/:mo_uuid/bookings/:booking_uuid/receive
  # Body: %{"received_qty" => "5.0", "received_notes" => "all good"}.
  def receive_booking(conn, %{"mo_uuid" => mo_uuid, "booking_uuid" => booking_uuid} = params) do
    actor = conn.assigns.current_user

    with {:ok, mo} <- fetch_mo(actor.company_id, mo_uuid),
         {:ok, booking} <- fetch_booking(mo, booking_uuid),
         {:ok, updated} <- Production.confirm_booking_received(actor, booking, params) do
      # Include the last put-away photo in the single-booking response
      # so the row keeps its thumbnail after a hot update — the FE
      # merges this payload over the local booking on receipt sign-off.
      last_photo_urls =
        case updated.stock_lot_id do
          nil -> %{}
          lot_id -> Backend.Stock.last_photo_url_by_lot_ids(actor.company_id, [lot_id])
        end

      json(conn, %{
        booking: Payloads.mo_booking(updated, last_photo_urls),
        preflight_complete: Production.mo_preflight_complete?(mo)
      })
    else
      {:error, :mo_not_found} ->
        not_found(conn, "MO not found.")

      {:error, :booking_not_found} ->
        not_found(conn, "Booking not found.")

      {:error, :pickup_not_completed} ->
        unprocessable(
          conn,
          "pickup_not_completed",
          "Warehouse picker hasn't finished the transfer yet — wait for confirm-transfer."
        )

      {:error, :bad_qty} ->
        unprocessable(
          conn,
          "bad_qty",
          "Received quantity must be a positive number."
        )

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
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

  defp fetch_mo(company_id, uuid) do
    case Production.get_manufacturing_order(company_id, uuid) do
      %ManufacturingOrder{} = mo -> {:ok, mo}
      _ -> {:error, :mo_not_found}
    end
  end

  defp fetch_booking(%ManufacturingOrder{} = mo, booking_uuid) do
    case Repo.get_by(ManufacturingOrderBooking, uuid: booking_uuid) do
      %ManufacturingOrderBooking{manufacturing_order_id: mo_id} = b when mo_id == mo.id ->
        {:ok, Repo.preload(b, [:item, :stock_lot, :picked_by, :received_by])}

      _ ->
        {:error, :booking_not_found}
    end
  end
end
