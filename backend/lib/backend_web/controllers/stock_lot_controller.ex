defmodule BackendWeb.StockLotController do
  @moduledoc """
  Read-only endpoints for stock lots. Mutations (receive / move /
  consume / dispose) land in subsequent slices through purpose-built
  endpoints — there's no generic create/update because every qty
  change is a recorded movement.

  Routes:
    * `GET /api/stock/lots`        (cursor list w/ search + filters)
    * `GET /api/stock/lots/:uuid`  (detail with placements + movements)

  RBAC: `stock.view` on both. Per-action gates land when the
  receive/move/consume actions ship.
  """

  use BackendWeb, :controller

  alias Backend.Stock
  alias BackendWeb.Payloads
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "stock.view" when action in [:index, :show, :cells]
  plug RequirePermission, "stock.receive" when action in [:create_manual]

  action_fallback BackendWeb.FallbackController

  def index(conn, params) do
    actor = conn.assigns.current_user

    opts = [
      cursor: params["cursor"],
      limit: parse_limit(params["limit"]),
      sort: parse_sort(params["sort"]),
      search: params["search"],
      status: params["status"],
      item_id: parse_int(params["item_id"]),
      cell_id: parse_int(params["cell_id"])
    ]

    {lots, cursor} = Stock.list_page(actor.company_id, opts)

    json(conn, %{
      items: Enum.map(lots, &Payloads.stock_lot/1),
      next_cursor: cursor
    })
  end

  def show(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Stock.get_for_company(actor.company_id, uuid) do
      nil ->
        {:error, :not_found}

      lot ->
        json(conn, %{
          lot: Payloads.stock_lot(lot),
          movements: Enum.map(lot.movements, &Payloads.stock_movement/1)
        })
    end
  end

  @doc """
  Create a manual lot — operator-authored stock entry that didn't
  come through a Purchase Order. Lot row + initial placement +
  receive movement save in one atomic transaction; `source_kind` is
  forced to `"manual"` and `created_by` captures the actor.

  Real PO receives ship later from the procurement module against a
  dedicated endpoint.
  """
  def create_manual(conn, params) do
    actor = conn.assigns.current_user

    case Stock.receive_lot(actor, actor.company_id, params) do
      {:ok, lot} ->
        conn
        |> put_status(:created)
        |> json(%{lot: Payloads.stock_lot(lot)})

      {:error, :item_not_found} ->
        not_found_error(conn, "item_not_found", "Item not found in this company.")

      {:error, :cell_not_found} ->
        not_found_error(
          conn,
          "cell_not_found",
          "Destination storage cell not found."
        )

      {:error, :bad_qty} ->
        unprocessable(
          conn,
          "bad_qty",
          "Each placement quantity must be a positive number."
        )

      {:error, :no_placements} ->
        unprocessable(
          conn,
          "no_placements",
          "Pick at least one destination cell with a quantity."
        )

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  @doc """
  Picker helper: flat list of every cell in the company with
  warehouse + location breadcrumbs. Used by the receive-form cell
  selector — the operator picks a destination cell in one click.
  """
  def cells(conn, params) do
    actor = conn.assigns.current_user

    opts = [
      search: params["search"],
      warehouse_id: parse_int(params["warehouse_id"]),
      item_id: parse_int(params["item_id"]),
      match_tags: parse_bool(params["match_tags"], true),
      limit: parse_int(params["limit"]),
      cursor: params["cursor"]
    ]

    {rows, next_cursor} = Stock.list_cells_for_picker(actor.company_id, opts)

    json(conn, %{
      items: Enum.map(rows, &shape_cell_row/1),
      next_cursor: next_cursor
    })
  end

  defp shape_cell_row(%{cell: c, location: loc, floor: floor, warehouse: warehouse}) do
    cell_tags = c.tags || []
    location_tags = loc.tags || []
    effective_tags = (location_tags ++ cell_tags) |> Enum.uniq()

    %{
      id: c.id,
      uuid: c.uuid,
      ordinal: c.ordinal,
      name: c.name,
      tags: cell_tags,
      effective_tags: effective_tags,
      storage_location: %{
        id: loc.id,
        uuid: loc.uuid,
        name: loc.name,
        code: loc.code,
        tags: location_tags
      },
      floor: %{id: floor.id, uuid: floor.uuid, name: floor.name},
      warehouse: %{id: warehouse.id, uuid: warehouse.uuid, name: warehouse.name}
    }
  end

  defp parse_bool(nil, default), do: default
  defp parse_bool("true", _), do: true
  defp parse_bool("1", _), do: true
  defp parse_bool("false", _), do: false
  defp parse_bool("0", _), do: false
  defp parse_bool(b, _) when is_boolean(b), do: b
  defp parse_bool(_, default), do: default

  defp not_found_error(conn, code, detail) do
    conn
    |> put_status(:not_found)
    |> json(BackendWeb.Errors.payload(code, detail, %{}))
  end

  defp unprocessable(conn, code, detail) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(BackendWeb.Errors.payload(code, detail, %{}))
  end

  defp changeset_error(conn, cs) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(
      BackendWeb.Errors.payload(
        "validation_failed",
        "Please correct the highlighted fields.",
        BackendWeb.Errors.changeset_fields(cs)
      )
    )
  end

  ## ------------------------------------------------------------------

  defp parse_int(nil), do: nil
  defp parse_int(""), do: nil

  defp parse_int(v) when is_binary(v) do
    case Integer.parse(v) do
      {n, ""} -> n
      _ -> nil
    end
  end

  defp parse_int(v) when is_integer(v), do: v
  defp parse_int(_), do: nil

  defp parse_limit(nil), do: 25

  defp parse_limit(v) when is_binary(v) do
    case Integer.parse(v) do
      {n, ""} when n > 0 -> min(n, 200)
      _ -> 25
    end
  end

  defp parse_limit(v) when is_integer(v) and v > 0, do: min(v, 200)
  defp parse_limit(_), do: 25

  defp parse_sort(nil), do: nil

  defp parse_sort(spec) when is_binary(spec) do
    case String.split(spec, ":", parts: 2) do
      [field, dir] when dir in ["asc", "desc"] ->
        {String.to_atom(field), String.to_atom(dir)}

      _ ->
        nil
    end
  end

  defp parse_sort(_), do: nil
end
