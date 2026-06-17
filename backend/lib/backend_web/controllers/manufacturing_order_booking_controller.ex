defmodule BackendWeb.ManufacturingOrderBookingController do
  @moduledoc """
  Per-MO stock reservations. Operators "book" qty of a specific lot
  to a MO so other MOs can't claim it. The `book_all` action picks
  oldest-expiry lots automatically; `release_all` drops every active
  booking on the MO.

  Permissions:
    * any booking action → `production.mo_edit`
    * `index` → `production.mo_view`

  The booking lives under the MO route prefix so the parent UUID
  scope check happens in one place.
  """

  use BackendWeb, :controller

  alias Backend.Production
  alias Backend.Production.{ManufacturingOrder, ManufacturingOrderBooking}
  alias BackendWeb.Errors
  alias BackendWeb.Payloads
  alias BackendWeb.Plugs.RequirePermission

  action_fallback BackendWeb.FallbackController

  plug RequirePermission, "production.mo_view" when action in [:index, :bookable_lots]

  plug RequirePermission,
       "production.mo_edit" when action in [:create, :update, :delete, :book_all, :release_all]

  def index(conn, %{"mo_id" => mo_uuid}) do
    actor = conn.assigns.current_user

    case Production.get_manufacturing_order(actor.company_id, mo_uuid) do
      nil ->
        not_found(conn, "Manufacturing order not found.")

      %ManufacturingOrder{} = mo ->
        bookings = Production.list_mo_bookings(mo)
        json(conn, %{items: Enum.map(bookings, &Payloads.mo_booking/1)})
    end
  end

  def bookable_lots(conn, %{"mo_id" => mo_uuid, "item_id" => item_raw} = params) do
    actor = conn.assigns.current_user

    case Production.get_manufacturing_order(actor.company_id, mo_uuid) do
      nil ->
        not_found(conn, "Manufacturing order not found.")

      %ManufacturingOrder{} ->
        case Integer.parse(to_string(item_raw)) do
          {item_id, ""} ->
            exclude =
              case params["exclude_booking_id"] do
                nil -> nil
                v -> Integer.parse(to_string(v)) |> elem(0)
              end

            lots =
              Production.list_bookable_lots(actor, item_id, exclude_booking_id: exclude)

            json(conn, %{
              items:
                Enum.map(lots, fn {lot, available, cell} ->
                  Payloads.mo_bookable_lot(lot, available, cell)
                end)
            })

          _ ->
            unprocessable(
              conn,
              "invalid_item_id",
              "`item_id` must be an integer."
            )
        end
    end
  end

  def create(conn, %{"mo_id" => mo_uuid} = params) do
    actor = conn.assigns.current_user

    case Production.get_manufacturing_order(actor.company_id, mo_uuid) do
      nil ->
        not_found(conn, "Manufacturing order not found.")

      %ManufacturingOrder{} = mo ->
        case Production.create_booking(actor, mo, params) do
          {:ok, booking} ->
            conn
            |> put_status(:created)
            |> json(%{booking: Payloads.mo_booking(booking)})

          {:error, code} when is_atom(code) ->
            booking_error(conn, code, nil)

          {:error, {:insufficient_stock, available}} ->
            booking_error(conn, :insufficient_stock, available)

          {:error, %Ecto.Changeset{} = cs} ->
            changeset_error(conn, cs)
        end
    end
  end

  def update(conn, %{"mo_id" => mo_uuid, "id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %ManufacturingOrder{id: mo_id} <-
           Production.get_manufacturing_order(actor.company_id, mo_uuid),
         %ManufacturingOrderBooking{manufacturing_order_id: ^mo_id} = booking <-
           Production.get_booking(actor.company_id, uuid) do
      case Production.update_booking(actor, booking, params) do
        {:ok, updated} ->
          json(conn, %{booking: Payloads.mo_booking(updated)})

        {:error, code} when is_atom(code) ->
          booking_error(conn, code, nil)

        {:error, {:insufficient_stock, available}} ->
          booking_error(conn, :insufficient_stock, available)

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      _ -> not_found(conn, "Booking not found.")
    end
  end

  def delete(conn, %{"mo_id" => mo_uuid, "id" => uuid}) do
    actor = conn.assigns.current_user

    with %ManufacturingOrder{id: mo_id} <-
           Production.get_manufacturing_order(actor.company_id, mo_uuid),
         %ManufacturingOrderBooking{manufacturing_order_id: ^mo_id} = booking <-
           Production.get_booking(actor.company_id, uuid) do
      case Production.delete_booking(actor, booking) do
        {:ok, _} -> send_resp(conn, :no_content, "")
        {:error, cs} -> changeset_error(conn, cs)
      end
    else
      _ -> not_found(conn, "Booking not found.")
    end
  end

  def book_all(conn, %{"mo_id" => mo_uuid} = params) do
    actor = conn.assigns.current_user
    strategy = parse_strategy(params["strategy"])

    case Production.get_manufacturing_order(actor.company_id, mo_uuid) do
      nil ->
        not_found(conn, "Manufacturing order not found.")

      %ManufacturingOrder{} = mo ->
        case Production.book_all_for_mo(actor, mo, strategy: strategy) do
          {:ok, bookings} ->
            json(conn, %{
              created: length(bookings),
              strategy: to_string(strategy),
              bookings: Enum.map(bookings, &Payloads.mo_booking/1)
            })

          {:error, cs} ->
            changeset_error(conn, cs)
        end
    end
  end

  defp parse_strategy("fifo"), do: :fifo
  defp parse_strategy("fefo"), do: :fefo
  defp parse_strategy(_), do: :fefo

  def release_all(conn, %{"mo_id" => mo_uuid}) do
    actor = conn.assigns.current_user

    case Production.get_manufacturing_order(actor.company_id, mo_uuid) do
      nil ->
        not_found(conn, "Manufacturing order not found.")

      %ManufacturingOrder{} = mo ->
        {:ok, %{bookings: released_bookings, children: cancelled_children}} =
          Production.release_all_for_mo(actor, mo)

        json(conn, %{
          released: released_bookings,
          cancelled_sub_mos: cancelled_children
        })
    end
  end

  # ----- helpers ---------------------------------------------------

  defp booking_error(conn, code, extra) do
    {http_code, error_code, detail} =
      case code do
        :lot_required ->
          {:unprocessable_entity, "lot_required", "Pick a lot to book against."}

        :lot_not_found ->
          {:unprocessable_entity, "lot_not_found", "That lot doesn't exist."}

        :item_lot_mismatch ->
          {:unprocessable_entity, "item_lot_mismatch",
           "Lot's item doesn't match the booking line."}

        :quantity_required ->
          {:unprocessable_entity, "quantity_required",
           "Quantity must be greater than zero."}

        :insufficient_stock ->
          {:unprocessable_entity, "insufficient_stock",
           "Lot doesn't have enough free stock. Available: #{inspect(extra)}."}

        other ->
          {:unprocessable_entity, to_string(other), "Validation failed: #{other}"}
      end

    conn
    |> put_status(http_code)
    |> json(Errors.payload(error_code, detail, %{}))
  end

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
