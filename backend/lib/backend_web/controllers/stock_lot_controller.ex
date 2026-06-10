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

  plug RequirePermission, "stock.view" when action in [:index, :show, :cells, :pending_putaway, :scan_lot, :scan_cell, :move_recommendations, :floor_plan, :packaging_suggestions]
  plug RequirePermission, "stock.receive" when action in [:create_manual]
  plug RequirePermission, "stock.move" when action in [:move]
  plug RequirePermission, "stock.edit" when action in [:update]
  plug RequirePermission, "stock.adjust" when action in [:adjust]

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
      cell_id: parse_int(params["cell_id"]),
      warehouse_id: parse_int(params["warehouse_id"])
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
  Edit a lot's mutable fields (identity + packaging + status). The
  parent item, the UoM, and `qty_received` are immutable — qty
  changes always go through a movement. Returns the freshly preloaded
  lot + movements so the FE can patch the page state without a
  follow-up GET.
  """
  def update(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user
    attrs = Map.drop(params, ["id", "_method"])

    case Stock.update_lot(actor, actor.company_id, uuid, attrs) do
      {:ok, lot} ->
        json(conn, %{
          lot: Payloads.stock_lot(lot),
          movements: Enum.map(lot.movements, &Payloads.stock_movement/1)
        })

      {:error, :not_found} ->
        {:error, :not_found}

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
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

      {:error, :warehouse_not_found} ->
        not_found_error(
          conn,
          "warehouse_not_found",
          "Destination warehouse not found."
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
  @doc """
  Lots that still have stock in a system Unregistered cell. The /m
  shell pulls this on load so operators see what needs put-away.
  """
  def pending_putaway(conn, _params) do
    actor = conn.assigns.current_user
    lots = Stock.list_pending_putaway(actor.company_id)

    json(conn, %{items: Enum.map(lots, &Payloads.stock_lot/1)})
  end

  @doc """
  Look up a lot by uuid for the scanner. Returns the same shape as
  `show/2` so the FE can reuse rendering helpers.
  """
  def scan_lot(conn, %{"uuid" => uuid}) do
    actor = conn.assigns.current_user

    case Stock.get_for_scan(actor.company_id, uuid) do
      nil ->
        not_found_error(conn, "lot_not_found", "Lot not found.")

      lot ->
        json(conn, %{
          lot: Payloads.stock_lot(lot),
          movements: Enum.map(lot.movements, &Payloads.stock_movement/1)
        })
    end
  end

  @doc """
  Look up a cell by uuid for the move-flow destination scan. Returns
  warehouse / floor / location breadcrumbs so the FE can confirm
  "you're moving stock to: WH1 > Floor 2 > Rack A > Level 3".
  """
  def scan_cell(conn, %{"uuid" => uuid}) do
    actor = conn.assigns.current_user

    case Stock.get_cell_for_scan(actor.company_id, uuid) do
      nil ->
        not_found_error(conn, "cell_not_found", "Cell not found.")

      cell ->
        loc = cell.storage_location
        floor = loc && loc.floor
        warehouse = floor && floor.warehouse

        json(conn, %{
          cell: %{
            id: cell.id,
            uuid: cell.uuid,
            name: cell.name,
            # Render via the company's `storage_cell` numbering format
            # (e.g. CELL00010) so the label PDF + mobile flow show the
            # same code admins configured under Settings → Numbering.
            # System cells return nil — operator-facing surfaces fall
            # back to generic_place_name there.
            code:
              if(cell.system_kind,
                do: nil,
                else: Payloads.render_entity_code(cell, "storage_cell")
              ),
            ordinal: cell.ordinal,
            tags: cell.tags || [],
            system_kind: cell.system_kind,
            storage_location:
              loc &&
                %{
                  id: loc.id,
                  uuid: loc.uuid,
                  name: loc.name,
                  # Same — prefer the rendered code over the raw DB
                  # column so empty `code:` columns still produce
                  # SL00004-style labels.
                  code:
                    Payloads.render_entity_code(loc, "storage_location"),
                  system_kind: loc.system_kind
                },
            floor:
              floor &&
                %{
                  id: floor.id,
                  uuid: floor.uuid,
                  name: floor.name,
                  system_kind: floor.system_kind
                },
            warehouse:
              warehouse &&
                %{id: warehouse.id, uuid: warehouse.uuid, name: warehouse.name}
          }
        })
    end
  end

  @doc """
  Floor plan for the mobile directions card. Renders into a mini SVG
  on /m/lots/:uuid/move so the operator sees where to walk before the
  camera opens.
  """
  def floor_plan(conn, %{"uuid" => floor_uuid}) do
    actor = conn.assigns.current_user

    case Stock.get_floor_plan(actor.company_id, floor_uuid) do
      nil ->
        not_found_error(conn, "floor_not_found", "Floor not found.")

      %{floor: floor, locations: locations} ->
        json(conn, %{
          floor: %{
            id: floor.id,
            uuid: floor.uuid,
            name: floor.name,
            # Pass the editor's full canvas_json straight through —
            # the mobile mini plan renders walls + outline from it so
            # operators can see the floor structure, not just floating
            # rack rectangles.
            canvas_json: floor.canvas_json || %{},
            warehouse:
              floor.warehouse &&
                %{
                  id: floor.warehouse.id,
                  uuid: floor.warehouse.uuid,
                  name: floor.warehouse.name
                }
          },
          locations:
            Enum.map(locations, fn l ->
              %{
                id: l.id,
                uuid: l.uuid,
                name: l.name,
                code: l.code,
                x: l.x,
                y: l.y,
                width: l.width,
                height: l.height,
                color: l.color
              }
            end)
        })
    end
  end

  @doc """
  Suggest cells for moving this lot, ranked by tag fit + consolidation.
  The mobile UI shows these as one-tap cards so most put-away flows
  never need to fire up the camera.
  """
  def move_recommendations(conn, %{"stock_lot_id" => uuid}) do
    actor = conn.assigns.current_user
    rows = Stock.list_move_recommendations(actor.company_id, uuid)

    json(conn, %{
      items:
        Enum.map(rows, fn %{row: r, score: score} ->
          %{
            score: score,
            reason: reason_from_score(score),
            # Fit metrics — surfaced on the mobile recommendation card
            # so the operator sees WHY one shelf beats another (more
            # headroom, same item already there, etc).
            fit: %{
              free_pct: r.fit.free_pct,
              percent_used: r.fit.percent_used
            },
            cell: %{
              id: r.cell.id,
              uuid: r.cell.uuid,
              name: r.cell.name,
              ordinal: r.cell.ordinal,
              tags: r.cell.tags || [],
              storage_location: %{
                id: r.location.id,
                uuid: r.location.uuid,
                name: r.location.name,
                code: r.location.code,
                tags: r.location.tags || []
              },
              floor: %{id: r.floor.id, uuid: r.floor.uuid, name: r.floor.name},
              warehouse: %{
                id: r.warehouse.id,
                uuid: r.warehouse.uuid,
                name: r.warehouse.name
              }
            }
          }
        end)
    })
  end

  @doc """
  Packaging suggestions for an item — used by the receive form to
  pre-fill the dimensions section. Three sources surface in the
  payload (any may be nil): item-level default, last lot, average of
  the last 10 lots.
  """
  def packaging_suggestions(conn, %{"item_id" => raw_id}) do
    actor = conn.assigns.current_user

    case Integer.parse(to_string(raw_id)) do
      {item_id, _} ->
        suggestions = Stock.packaging_suggestions(actor.company_id, item_id)
        json(conn, %{suggestions: suggestions || nil})

      :error ->
        unprocessable(conn, "bad_item_id", "Invalid item id.")
    end
  end

  defp reason_from_score(10), do: "Same item already here"
  defp reason_from_score(8), do: "Matches all storage tags"
  defp reason_from_score(4), do: "Matches some storage tags"
  defp reason_from_score(1), do: "Available cell"
  defp reason_from_score(_), do: "Available"

  @doc """
  Atomic move: pulls qty out of the source placement, lands it at the
  destination, records a `move` movement carrying the photo URL or
  skip-reason. Source defaults to the lot's only non-zero placement
  (the common put-away-from-Unregistered case).
  """
  @doc """
  Manual qty adjustment. Operator picks a signed delta and a reason
  (stock-take, damage, shrinkage). Records an `adjust_up` or
  `adjust_down` movement; the placement's qty moves accordingly.
  """
  def adjust(conn, %{"stock_lot_id" => uuid} = params) do
    actor = conn.assigns.current_user

    case Stock.adjust_placement(actor, uuid, params) do
      {:ok, lot} ->
        json(conn, %{
          lot: Payloads.stock_lot(lot),
          movements: Enum.map(lot.movements, &Payloads.stock_movement/1)
        })

      {:error, :lot_not_found} ->
        not_found_error(conn, "lot_not_found", "Lot not found.")

      {:error, :placement_not_found} ->
        unprocessable(conn, "placement_not_found", "Lot has no stock to adjust.")

      {:error, :ambiguous_placement} ->
        unprocessable(
          conn,
          "ambiguous_placement",
          "Lot is split across cells — pick which placement to adjust."
        )

      {:error, :insufficient_qty} ->
        unprocessable(
          conn,
          "insufficient_qty",
          "Can't go below zero — that placement only has the current qty available."
        )

      {:error, :bad_qty} ->
        unprocessable(
          conn,
          "bad_qty",
          "Delta must be a non-zero number."
        )

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  def move(conn, %{"stock_lot_id" => uuid} = params) do
    actor = conn.assigns.current_user

    case Stock.move_placement(actor, uuid, params) do
      {:ok, lot} ->
        json(conn, %{lot: Payloads.stock_lot(lot)})

      {:error, :lot_not_found} ->
        not_found_error(conn, "lot_not_found", "Lot not found.")

      {:error, :cell_not_found} ->
        not_found_error(conn, "cell_not_found", "Destination cell not found.")

      {:error, :placement_not_found} ->
        unprocessable(
          conn,
          "placement_not_found",
          "Lot has no stock to move from."
        )

      {:error, :ambiguous_placement} ->
        unprocessable(
          conn,
          "ambiguous_placement",
          "Lot is split across cells — say which one to move from."
        )

      {:error, :insufficient_qty} ->
        unprocessable(
          conn,
          "insufficient_qty",
          "Not enough stock at the source cell."
        )

      {:error, :same_cell} ->
        unprocessable(
          conn,
          "same_cell",
          "Source and destination are the same cell."
        )

      {:error, :bad_qty} ->
        unprocessable(conn, "bad_qty", "Quantity must be a positive number.")

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

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
