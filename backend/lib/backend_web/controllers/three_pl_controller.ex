defmodule BackendWeb.ThreePLController do
  @moduledoc """
  3PL (bailee-custody) endpoints — mount under `/api/three-pl`.

    * `POST /route/:lot_uuid`             — route a released lot to
                                            three_pl_storage or dispatch
    * `GET  /inventory`                   — bailee lots for the 3PL tab
    * `GET  /capacity/:warehouse_id`      — free m³ per purpose, for the
                                            wizard's inline capacity hint

  All actions gate on `production.final_release` — the routing decision
  belongs to the same operator who just signed the release. Capacity
  and inventory reads use the same gate so a viewer without release
  perms doesn't see bailee inventory (compliance-flavoured info).
  """

  use BackendWeb, :controller

  alias Backend.Repo
  alias Backend.Stock.Lot
  alias Backend.ThreePL
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "production.final_release"

  action_fallback BackendWeb.FallbackController

  # ---------------------------------------------------------------
  # POST /three-pl/route/:lot_uuid
  # ---------------------------------------------------------------
  def route_lot(conn, %{"lot_uuid" => lot_uuid, "choice" => choice} = params)
      when choice in ["three_pl", "shipment"] do
    actor = conn.assigns.current_user

    with %Lot{} = lot <- get_lot(actor.company_id, lot_uuid),
         {:ok, opts} <- resolve_route_opts(actor.company_id, params),
         {:ok, %{lot: updated}} <- ThreePL.route_released_lot(actor, lot, choice, opts) do
      json(conn, %{lot: Payloads.stock_lot(preload_for_payload(updated))})
    else
      nil ->
        not_found(conn, "Lot not found.")

      {:error, :forbidden} ->
        conn
        |> put_status(:forbidden)
        |> json(Errors.payload("forbidden", "You lack production.final_release.", %{}))

      {:error, :not_available} ->
        unprocessable(conn, "not_available",
          "Only released lots (status = available) can be routed to 3PL or dispatch.")

      {:error, :already_routed} ->
        unprocessable(conn, "already_routed",
          "This lot has already been routed. Rerouting requires an override action.")

      {:error, :lot_not_placed} ->
        unprocessable(conn, "lot_not_placed",
          "The lot has no active placements — put-away must complete before routing.")

      {:error, :no_customer_for_lot} ->
        unprocessable(conn, "no_customer_for_lot",
          "This lot has no linked customer order. Pick a customer or route to 'shipment'.")

      {:error, {:bad_customer, uuid}} ->
        unprocessable(conn, "bad_customer",
          "The picked customer isn't in your company (#{uuid}).")

      {:error, {:no_capacity, %{purpose: purpose, required_m3: req, free_m3: free}}} ->
        conn
        |> put_status(:conflict)
        |> json(
          Errors.payload(
            "no_capacity",
            "Not enough space in #{purpose} cells for this lot.",
            %{
              purpose: purpose,
              required_m3: Decimal.to_string(req),
              free_m3: Decimal.to_string(free)
            }
          )
        )

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)

      {:error, reason} ->
        unprocessable(conn, "route_failed", inspect(reason))
    end
  end

  def route_lot(conn, %{"choice" => _}) do
    unprocessable(conn, "bad_choice", "choice must be 'three_pl' or 'shipment'.")
  end

  def route_lot(conn, _params) do
    unprocessable(conn, "missing_choice", "choice is required ('three_pl' or 'shipment').")
  end

  # ---------------------------------------------------------------
  # GET /three-pl/inventory
  # ---------------------------------------------------------------
  def inventory(conn, _params) do
    actor = conn.assigns.current_user
    lots = ThreePL.list_bailee_lots(actor.company_id)
    json(conn, %{items: Enum.map(lots, &bailee_lot_row/1)})
  end

  # ---------------------------------------------------------------
  # GET /three-pl/capacity/:warehouse_uuid
  # ---------------------------------------------------------------
  def capacity(conn, %{"warehouse_uuid" => warehouse_uuid}) do
    actor = conn.assigns.current_user

    case Repo.get_by(Backend.Warehouses.Warehouse, uuid: warehouse_uuid) do
      %{id: id, company_id: company_id} when company_id == actor.company_id ->
        free_three_pl = ThreePL.capacity_free_m3(id, "three_pl_storage")
        free_dispatch = ThreePL.capacity_free_m3(id, "dispatch")

        json(conn, %{
          warehouse_uuid: warehouse_uuid,
          free_m3: %{
            three_pl_storage: Decimal.to_string(free_three_pl),
            dispatch: Decimal.to_string(free_dispatch)
          }
        })

      _ ->
        not_found(conn, "Warehouse not found.")
    end
  end

  # ---------------------------------------------------------------
  # Payload / preload helpers
  # ---------------------------------------------------------------

  # Translate the optional `customer_uuid` into a proper Elixir keyword
  # list for the context module. Backend still validates that the
  # picked customer belongs to the actor's company.
  defp resolve_route_opts(company_id, %{"customer_uuid" => uuid})
       when is_binary(uuid) and uuid != "" do
    case Repo.get_by(Backend.Customers.Customer, uuid: uuid) do
      %{id: id, company_id: ^company_id} -> {:ok, [override_customer_id: id]}
      %{} -> {:error, {:bad_customer, uuid}}
      nil -> {:error, {:bad_customer, uuid}}
    end
  end

  defp resolve_route_opts(_company_id, _params), do: {:ok, []}

  defp bailee_lot_row(%Lot{} = l) do
    volume_m3 = ThreePL.lot_stored_volume_m3(l)

    %{
      lot: Payloads.stock_lot(l),
      stored_volume_m3: Decimal.to_string(Decimal.round(volume_m3, 4)),
      days_held: days_since(l.bailee_routed_at)
    }
  end

  defp days_since(nil), do: 0

  defp days_since(%DateTime{} = dt) do
    diff = DateTime.diff(DateTime.utc_now(), dt, :second)
    max(div(diff, 86_400), 0)
  end

  defp get_lot(company_id, lot_uuid) when is_binary(lot_uuid) do
    case Repo.get_by(Lot, uuid: lot_uuid) do
      %Lot{company_id: ^company_id} = lot -> lot
      _ -> nil
    end
  end

  defp preload_for_payload(%Lot{} = lot) do
    Repo.preload(lot, [
      :item,
      :unit_of_measurement,
      :bailee_customer,
      placements: [storage_cell: [storage_location: [floor: [:warehouse]]]]
    ])
  end

  # ---------------------------------------------------------------
  # Standard error responses (matches ProductionFinalReleaseController)
  # ---------------------------------------------------------------

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
end
