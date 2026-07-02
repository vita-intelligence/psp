defmodule BackendWeb.WarehouseReturnPickupController do
  @moduledoc """
  Warehouse-side return pickup — Phase C. After production closeout
  parks lots on production-side dispatch cells, this controller drives
  the mobile flow that walks the dispatch cells, scans lots onto the
  warehouse worker's trolley, and places them back into warehouse
  storage with per-lot photo evidence.

  Endpoints (all `/api/m`):

    * `GET  /return-pickup-queue` — per-MO queue
    * `GET  /return-pickup/loose` — orphan lots (no MO source_ref)
    * `GET  /return-pickup/trolley` — the actor's open trolley rows
    * `GET  /return-pickup/:mo_uuid` — per-MO detail
    * `POST /return-pickup/lots/:lot_uuid/pick` — scan onto trolley
    * `POST /return-pickup/picks/:pick_uuid/place` — scan + photo + place
    * `POST /return-pickup/picks/:pick_uuid/abort` — drop trolley row
  """

  use BackendWeb, :controller

  alias Backend.Warehouses.ReturnPickup
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  action_fallback BackendWeb.FallbackController

  plug RequirePermission,
       "warehouse.return_pickup"
       when action in [
              :queue,
              :loose,
              :trolley,
              :show,
              :pick,
              :recommendations,
              :place,
              :abort
            ]

  # ----- Queues + detail --------------------------------------------

  def queue(conn, _params) do
    actor = conn.assigns.current_user
    mos = ReturnPickup.list_queue(actor.company_id)

    # Per-MO lot count drives the badge on each card.
    counts =
      Enum.map(mos, fn mo ->
        detail = ReturnPickup.get_detail(actor, mo.uuid)
        {mo, length(detail.lots_at_dispatch)}
      end)

    json(conn, %{
      items:
        Enum.map(counts, fn {mo, n} ->
          Payloads.return_pickup_queue_entry(mo, n)
        end)
    })
  end

  def loose(conn, _params) do
    actor = conn.assigns.current_user
    %{lots_at_dispatch: lots, last_photo_urls: photos} =
      ReturnPickup.get_loose_detail(actor)

    json(conn, %{
      items: Enum.map(lots, &Payloads.return_pickup_lot(&1, photos))
    })
  end

  def trolley(conn, _params) do
    actor = conn.assigns.current_user

    %{trolley: mine, trolley_others: others, last_photo_urls: photos} =
      ReturnPickup.get_loose_detail(actor)

    json(conn, %{
      items: Enum.map(mine, &Payloads.return_pick_row(&1, photos)),
      others: Enum.map(others, &Payloads.return_pick_row(&1, photos))
    })
  end

  def show(conn, %{"mo_uuid" => mo_uuid}) do
    actor = conn.assigns.current_user

    case ReturnPickup.get_detail(actor, mo_uuid) do
      nil ->
        not_found(conn, "MO not found.")

      %{
        mo: mo,
        lots_at_dispatch: lots,
        trolley: mine,
        trolley_others: others,
        last_photo_urls: photos
      } ->
        json(conn, %{
          mo: Payloads.manufacturing_order(mo),
          lots_at_dispatch: Enum.map(lots, &Payloads.return_pickup_lot(&1, photos)),
          trolley: Enum.map(mine, &Payloads.return_pick_row(&1, photos)),
          trolley_others: Enum.map(others, &Payloads.return_pick_row(&1, photos))
        })
    end
  end

  # ----- Actions ----------------------------------------------------

  def pick(conn, %{"lot_uuid" => lot_uuid} = params) do
    actor = conn.assigns.current_user

    case ReturnPickup.pick_to_trolley(actor, lot_uuid, params) do
      {:ok, pick} ->
        json(conn, %{pick: Payloads.return_pick_row(pick)})

      {:error, :lot_not_found} ->
        not_found(conn, "Lot not found.")

      {:error, :cell_not_found} ->
        unprocessable(conn, "cell_not_found", "Scanned cell wasn't found.")

      {:error, :not_a_dispatch_cell} ->
        unprocessable(
          conn,
          "not_a_dispatch_cell",
          "That cell isn't a production-dispatch cell — scan the dispatch lane."
        )

      {:error, :lot_not_at_scanned_cell} ->
        unprocessable(
          conn,
          "lot_not_at_scanned_cell",
          "That lot isn't sitting on the cell you scanned."
        )

      {:error, :already_on_trolley} ->
        unprocessable(
          conn,
          "already_on_trolley",
          "That lot is already on a warehouse worker's trolley."
        )

      {:error, :lot_unavailable} ->
        unprocessable(
          conn,
          "lot_unavailable",
          "Lot status must be available — it may still be in quarantine or rejected."
        )

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)

      {:error, reason} ->
        unprocessable(conn, "pick_failed", inspect(reason))
    end
  end

  def recommendations(conn, %{"pick_uuid" => pick_uuid}) do
    actor = conn.assigns.current_user

    case ReturnPickup.list_place_recommendations(actor, pick_uuid) do
      {:ok, rows} ->
        json(conn, %{items: Enum.map(rows, &Payloads.move_recommendation/1)})

      {:error, :pick_not_found} ->
        not_found(conn, "Trolley row not found.")

      {:error, :forbidden} ->
        unprocessable(
          conn,
          "forbidden",
          "That trolley row belongs to another worker."
        )

      {:error, :already_placed} ->
        unprocessable(
          conn,
          "already_placed",
          "That lot has already been placed."
        )
    end
  end

  def place(conn, %{"pick_uuid" => pick_uuid} = params) do
    actor = conn.assigns.current_user

    case ReturnPickup.place_from_trolley(actor, pick_uuid, params) do
      {:ok, pick} ->
        json(conn, %{pick: Payloads.return_pick_row(pick)})

      {:error, :pick_not_found} ->
        not_found(conn, "Trolley row not found.")

      {:error, :forbidden} ->
        unprocessable(
          conn,
          "forbidden",
          "That trolley row belongs to another worker."
        )

      {:error, :already_placed} ->
        unprocessable(
          conn,
          "already_placed",
          "That lot is already placed."
        )

      {:error, :cell_not_found} ->
        unprocessable(conn, "cell_not_found", "Scanned target cell wasn't found.")

      {:error, :destination_invalid} ->
        unprocessable(
          conn,
          "destination_invalid",
          "Place into a regular or quarantine cell — not a dispatch / rejected / hold lane."
        )

      {:error, :requires_finished_quarantine} ->
        unprocessable(
          conn,
          "requires_finished_quarantine",
          "This finished-product lot is awaiting QA release — it has to land in a Finished Quarantine cell, not general storage (BRCGS § 5.6)."
        )

      {:error, :same_cell} ->
        unprocessable(
          conn,
          "same_cell",
          "Destination can't be the dispatch cell the lot came from."
        )

      {:error, {:move_failed, reason}} ->
        unprocessable(
          conn,
          "move_failed",
          "Couldn't move the lot: #{inspect(reason)}"
        )

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)

      {:error, reason} ->
        unprocessable(conn, "place_failed", inspect(reason))
    end
  end

  def abort(conn, %{"pick_uuid" => pick_uuid}) do
    actor = conn.assigns.current_user

    case ReturnPickup.abort_pick(actor, pick_uuid) do
      {:ok, _} ->
        json(conn, %{ok: true})

      {:error, :pick_not_found} ->
        not_found(conn, "Trolley row not found.")

      {:error, :forbidden} ->
        unprocessable(
          conn,
          "forbidden",
          "That trolley row belongs to another worker."
        )

      {:error, :already_placed} ->
        unprocessable(
          conn,
          "already_placed",
          "That lot has already been placed — can't abort."
        )

      {:error, reason} ->
        unprocessable(conn, "abort_failed", inspect(reason))
    end
  end

  # ----- Helpers ----------------------------------------------------

  defp not_found(conn, detail) do
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
