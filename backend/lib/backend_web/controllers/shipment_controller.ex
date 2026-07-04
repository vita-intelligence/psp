defmodule BackendWeb.ShipmentController do
  @moduledoc """
  Outbound shipments — customer-facing dispatch record.

  Mount: `/api/shipments`.

    * `POST /`                  create draft from a lot uuid
    * `GET  /`                  paginated list
    * `GET  /:uuid`             single shipment (full detail)
    * `PATCH /:uuid`            edit draft / ready fields
    * `POST /:uuid/mark-ready`  draft → ready
    * `POST /:uuid/mark-draft`  ready → draft
    * `POST /:uuid/pickup`      ready → picked_up (placeholder)
    * `POST /:uuid/cancel`      cancel with reason
  """

  use BackendWeb, :controller

  alias Backend.Shipments
  alias Backend.Shipments.Shipment
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  # Split per persona:
  # - view (index / show): shipments.view — broad audience.
  # - edit (create + update + mark_ready + mark_draft + cancel):
  #   shipments.edit — paperwork side, shipping coordinator.
  # - pickup: shipments.pickup — physical truck-arrival event
  #   (placeholder button today; mobile arrival form lands here later).
  plug RequirePermission,
       "shipments.view" when action in [:index, :show]

  plug RequirePermission,
       "shipments.edit"
       when action in [
              :create,
              :update,
              :mark_ready,
              :mark_draft,
              :cancel
            ]

  plug RequirePermission,
       "shipments.pickup" when action in [:pickup]

  action_fallback BackendWeb.FallbackController

  # -----------------------------------------------------------------
  # Create
  # -----------------------------------------------------------------
  def create(conn, %{"lot_uuid" => lot_uuid}) do
    actor = conn.assigns.current_user

    case Shipments.create_from_lot(actor, lot_uuid) do
      {:ok, shipment} ->
        preloaded = Shipments.get_shipment(actor.company_id, shipment.uuid)
        json(conn, %{shipment: Payloads.shipment(preloaded)})

      {:error, reason} ->
        shipment_error(conn, reason)
    end
  end

  def create(conn, _params),
    do: unprocessable(conn, "missing_field", "lot_uuid is required.")

  # -----------------------------------------------------------------
  # List
  # -----------------------------------------------------------------
  def index(conn, params) do
    actor = conn.assigns.current_user

    opts = [
      status: Map.get(params, "status", "all"),
      limit: parse_int(Map.get(params, "limit"), 25),
      cursor: Map.get(params, "cursor"),
      search: Map.get(params, "search")
    ]

    {items, next_cursor} = Shipments.list_shipments(actor.company_id, opts)

    json(conn, %{
      items: Enum.map(items, &Payloads.shipment/1),
      next_cursor: next_cursor
    })
  end

  # -----------------------------------------------------------------
  # Show
  # -----------------------------------------------------------------
  def show(conn, %{"uuid" => uuid}) do
    actor = conn.assigns.current_user

    case Shipments.get_shipment(actor.company_id, uuid) do
      nil -> not_found(conn, "Shipment not found.")
      shipment -> json(conn, %{shipment: Payloads.shipment(shipment)})
    end
  end

  # -----------------------------------------------------------------
  # Update
  # -----------------------------------------------------------------
  def update(conn, %{"uuid" => uuid} = params) do
    actor = conn.assigns.current_user
    attrs = Map.drop(params, ["uuid"])

    with %Shipment{} = shipment <- Shipments.get_shipment(actor.company_id, uuid),
         {:ok, updated} <- Shipments.update(actor, shipment, attrs) do
      preloaded = Shipments.get_shipment(actor.company_id, updated.uuid)
      json(conn, %{shipment: Payloads.shipment(preloaded)})
    else
      nil -> not_found(conn, "Shipment not found.")
      {:error, reason} -> shipment_error(conn, reason)
    end
  end

  # -----------------------------------------------------------------
  # Lifecycle actions
  # -----------------------------------------------------------------
  def mark_ready(conn, %{"uuid" => uuid}) do
    lifecycle(conn, uuid, &Shipments.mark_ready/2)
  end

  def mark_draft(conn, %{"uuid" => uuid}) do
    lifecycle(conn, uuid, &Shipments.mark_draft/2)
  end

  def pickup(conn, %{"uuid" => uuid}) do
    lifecycle(conn, uuid, &Shipments.confirm_pickup/2)
  end

  def cancel(conn, %{"uuid" => uuid} = params) do
    actor = conn.assigns.current_user

    with %Shipment{} = shipment <- Shipments.get_shipment(actor.company_id, uuid),
         {:ok, updated} <- Shipments.cancel(actor, shipment, params["reason"]) do
      preloaded = Shipments.get_shipment(actor.company_id, updated.uuid)
      json(conn, %{shipment: Payloads.shipment(preloaded)})
    else
      nil -> not_found(conn, "Shipment not found.")
      {:error, reason} -> shipment_error(conn, reason)
    end
  end

  defp lifecycle(conn, uuid, fun) do
    actor = conn.assigns.current_user

    with %Shipment{} = shipment <- Shipments.get_shipment(actor.company_id, uuid),
         {:ok, updated} <- fun.(actor, shipment) do
      preloaded = Shipments.get_shipment(actor.company_id, updated.uuid)
      json(conn, %{shipment: Payloads.shipment(preloaded)})
    else
      nil -> not_found(conn, "Shipment not found.")
      {:error, reason} -> shipment_error(conn, reason)
    end
  end

  # -----------------------------------------------------------------
  # Error surface
  # -----------------------------------------------------------------
  defp shipment_error(conn, reason) do
    case reason do
      :forbidden ->
        conn
        |> put_status(:forbidden)
        |> json(Errors.payload("forbidden", "You lack production.final_release.", %{}))

      :lot_not_found ->
        not_found(conn, "Lot not found.")

      :lot_not_in_dispatch ->
        unprocessable(conn, "lot_not_in_dispatch",
          "The lot isn't currently in a dispatch cell. Move it there before creating a shipment.")

      :already_open ->
        unprocessable(conn, "already_open",
          "There's already an open shipment on this lot. Finish or cancel it first.")

      :not_editable ->
        unprocessable(conn, "not_editable",
          "This shipment is already picked up or cancelled.")

      :not_cancelable ->
        unprocessable(conn, "not_cancelable",
          "Picked-up shipments can't be cancelled.")

      {:bad_status, got: got, expected: expected} ->
        unprocessable(conn, "bad_status",
          "This action needs status = #{expected}; the shipment is #{got}.")

      %Ecto.Changeset{} = cs ->
        changeset_error(conn, cs)

      other ->
        unprocessable(conn, "shipment_failed", inspect(other))
    end
  end

  # -----------------------------------------------------------------
  # Small helpers
  # -----------------------------------------------------------------
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
        %{fields: format_errors(cs)}
      )
    )
  end

  defp format_errors(cs) do
    Ecto.Changeset.traverse_errors(cs, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc ->
        String.replace(acc, "%{#{k}}", to_string(v))
      end)
    end)
  end

  defp parse_int(nil, default), do: default

  defp parse_int(v, default) when is_binary(v) do
    case Integer.parse(v) do
      {n, ""} -> n
      _ -> default
    end
  end

  defp parse_int(v, _default) when is_integer(v), do: v
  defp parse_int(_, default), do: default
end
