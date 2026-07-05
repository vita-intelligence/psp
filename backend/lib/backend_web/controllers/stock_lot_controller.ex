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

  import Ecto.Query, only: [from: 2]

  alias Backend.Stock
  alias BackendWeb.Payloads
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "stock.view" when action in [:index, :show, :cells, :pending_putaway, :scan_lot, :scan_cell, :move_recommendations, :floor_plan, :packaging_suggestions, :inventory, :events_index]
  plug RequirePermission, "stock.receive"
       when action in [:create_manual, :create_manual_bulk]
  plug RequirePermission, "stock.move" when action in [:move]
  plug RequirePermission, "stock.edit" when action in [:update]
  plug RequirePermission, "stock.adjust" when action in [:adjust]
  # `events_create` carries multi-kind dispatch — the action plug only
  # asserts "you can view this lot"; the event-kind → permission map
  # in `events_create/2` enforces the per-action gate (qc, hold,
  # dispose, …) so an operator with view but not qc can't smuggle a
  # verdict through.
  plug RequirePermission, "stock.view" when action in [:events_create]

  action_fallback BackendWeb.FallbackController

  def index(conn, params) do
    actor = conn.assigns.current_user

    opts = [
      cursor: params["cursor"],
      limit: parse_limit(params["limit"]),
      sort: parse_sort(params["sort"]),
      search: params["search"],
      column_filter: params["column_filter"],
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

  @doc """
  Item-level inventory rollup. One row per item with `qty_on_hand`,
  `total_cost`, `lots_count`, `earliest_expiry`, and
  `latest_received_at` aggregated across every non-zero placement of
  every lot. Items with no lots still appear with zeros so the
  catalogue view stays complete.
  """
  def inventory(conn, params) do
    actor = conn.assigns.current_user

    opts = [
      cursor: params["cursor"],
      limit: parse_int(params["limit"]),
      sort: params["sort"],
      search: params["search"],
      warehouse_id: parse_int(params["warehouse_id"]),
      item_type: params["item_type"],
      in_stock_only: params["in_stock_only"] in [true, "true", "1"]
    ]

    {rows, cursor} = Stock.inventory_rollup(actor.company_id, opts)

    json(conn, %{
      items: Enum.map(rows, &shape_inventory_row/1),
      next_cursor: cursor
    })
  end

  defp shape_inventory_row(r) do
    %{
      item_id: r.item_id,
      item_uuid: r.item_uuid,
      item_name: r.item_name,
      item_code: Payloads.render_entity_code(%{id: r.item_id}, "item"),
      item_external_sku: r.item_external_sku,
      item_type: r.item_type,
      stock_uom_id: r.stock_uom_id,
      qty_on_hand: r.qty_on_hand,
      total_cost: r.total_cost,
      lots_count: r.lots_count,
      earliest_expiry: r.earliest_expiry,
      latest_received_at: r.latest_received_at
    }
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
  Bulk manual receive — one delivery, mixed packaging. The FE pack
  table in `/stock/lots/new` posts here when the operator splits one
  arrival into N packs of different sizes (e.g. 100 kg as 4×25 kg
  drums + 1×50 kg sack).

  Body shape:

      {
        "item_id": 12,
        "warehouse_id": 2,
        "currency": "GBP",
        "unit_cost": "5.15",
        "country_of_origin": "IT",
        ...                         # any other shared identity fields
        "packs": [
          {
            "qty_received": "100",  # required per pack
            "package_length_mm": 400,
            "package_width_mm": 300,
            "package_height_mm": 250,
            "package_weight_kg": "25.000",
            "units_per_package": 4,
            "stack_factor": 1,
            "supplier_batch_no": "BA-..."   # optional per-pack override
          },
          ...
        ]
      }

  Returns `{"lots": [...]}` with one entry per pack. Atomic — any
  single-pack failure rolls back every other lot that was about to
  land and surfaces the failing pack's index.
  """
  def create_manual_bulk(conn, params) do
    actor = conn.assigns.current_user
    packs = List.wrap(params["packs"])
    common = Map.drop(params, ["packs"])

    case Stock.receive_lots_bulk(actor, actor.company_id, common, packs) do
      {:ok, lots} ->
        conn
        |> put_status(:created)
        |> json(%{lots: Enum.map(lots, &Payloads.stock_lot/1)})

      {:error, :no_packs} ->
        unprocessable(
          conn,
          "no_packs",
          "Send at least one pack — `packs: [...]` is required."
        )

      {:error, {idx, reason}} when is_integer(idx) ->
        bulk_pack_error(conn, idx, reason)

      {:error, reason} ->
        bulk_pack_error(conn, 0, reason)
    end
  end

  defp bulk_pack_error(conn, idx, reason) do
    case reason do
      :item_not_found ->
        not_found_error(conn, "item_not_found", "Item not found in this company.")

      :cell_not_found ->
        not_found_error(
          conn,
          "cell_not_found",
          "Destination storage cell not found."
        )

      :warehouse_not_found ->
        not_found_error(
          conn,
          "warehouse_not_found",
          "Destination warehouse not found."
        )

      :bad_qty ->
        unprocessable(
          conn,
          "bad_qty",
          "Pack ##{idx + 1}: each pack's qty must be a positive number."
        )

      :no_placements ->
        unprocessable(
          conn,
          "no_placements",
          "Pack ##{idx + 1}: pick a destination cell with a qty."
        )

      %Ecto.Changeset{} = cs ->
        # Per-pack validation failures (e.g. negative dim, missing
        # package_weight_kg) — surface the failing pack's index so the
        # FE can highlight the right row.
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{
          error: "validation_failed",
          detail: "Pack ##{idx + 1} couldn't be saved — fix the highlighted fields.",
          pack_index: idx,
          fields: BackendWeb.Errors.changeset_fields(cs)
        })

      other ->
        unprocessable(
          conn,
          "bulk_failed",
          "Pack ##{idx + 1}: #{inspect(other)}."
        )
    end
  end

  # Map each lifecycle event kind to the permission required to record
  # it. Operator-initiated kinds only — `expected`, `requested`, and
  # `received` are emitted by service code (PO approval / receive),
  # never by the public events POST.
  @event_kind_permissions %{
    "routed_to_quarantine" => "stock.qc",
    "qc_passed" => "stock.qc",
    "qc_failed" => "stock.qc",
    "held" => "stock.hold",
    "released" => "stock.hold",
    "disposed" => "stock.dispose",
    "consumed_to_zero" => "stock.adjust",
    "canceled" => "stock.dispose"
  }

  @doc """
  Record a lifecycle event against a lot. Body shape:

      { "kind": "qc_passed", "reason": "...", "metadata": {}, "evidence_file_id": null }

  Permission is dispatched per kind — `qc_passed` needs `stock.qc`,
  `held` needs `stock.hold`, `disposed` needs `stock.dispose`. Kinds
  not in the map (or reserved system-only kinds like `received`) are
  rejected before the lifecycle service even sees them.

  Returns the updated lot (with projected status) + the inserted
  event so the FE can patch the timeline without a follow-up GET.
  """
  def events_create(conn, %{"stock_lot_id" => uuid} = params) do
    actor = conn.assigns.current_user
    kind = to_string(params["kind"] || "")

    cond do
      kind == "" ->
        unprocessable(conn, "missing_kind", "Event `kind` is required.")

      not Map.has_key?(@event_kind_permissions, kind) ->
        unprocessable(
          conn,
          "event_kind_not_operator_initiated",
          "`#{kind}` events are recorded by the system, not by operators."
        )

      true ->
        required_perm = Map.fetch!(@event_kind_permissions, kind)

        if Backend.RBAC.has_permission?(actor, required_perm) do
          do_events_create(conn, actor, uuid, kind, params)
        else
          conn
          |> put_status(:forbidden)
          |> json(
            BackendWeb.Errors.payload(
              "forbidden",
              "Recording a `#{kind}` event requires the `#{required_perm}` permission."
            )
          )
        end
    end
  end

  defp do_events_create(conn, actor, uuid, kind, params) do
    attrs = %{
      "kind" => kind,
      "reason" => params["reason"],
      "metadata" => params["metadata"] || %{},
      "evidence_file_id" => parse_int(params["evidence_file_id"])
    }

    case Backend.Stock.record_lot_event(actor, actor.company_id, uuid, attrs) do
      {:ok, %{lot: lot, event: event, status: _status}} ->
        # Re-fetch with the full show-shape preloads so the FE can
        # patch the page without a follow-up GET.
        full_lot = Backend.Stock.get_for_company(actor.company_id, uuid) || lot

        json(conn, %{
          lot: Payloads.stock_lot(full_lot),
          event: Payloads.lot_event(Backend.Repo.preload(event, [:actor, :evidence_file]))
        })

      {:error, :not_found} ->
        {:error, :not_found}

      {:error, :illegal_transition, info} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(
          BackendWeb.Errors.payload(
            "illegal_lifecycle_transition",
            "Can't record `#{info.kind}` while lot status is `#{info.from}`. " <>
              allowed_hint(info.allowed),
            %{from: info.from, kind: info.kind, allowed: info.allowed}
          )
        )

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  defp allowed_hint([]), do: "This is a terminal status — no further events are accepted."

  defp allowed_hint(kinds) do
    "Allowed from this status: #{Enum.join(kinds, ", ")}."
  end

  @doc """
  Paginated timeline of lifecycle events for a lot — newest first.
  Used by the lot detail page's "Activity" tab.
  """
  def events_index(conn, %{"stock_lot_id" => uuid} = params) do
    actor = conn.assigns.current_user
    limit = parse_limit(params["limit"])

    case Backend.Stock.list_lot_events(actor.company_id, uuid, limit: limit) do
      {:ok, _lot, events} ->
        json(conn, %{items: Enum.map(events, &Payloads.lot_event/1)})

      {:error, :not_found} ->
        {:error, :not_found}
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

    # Decorate each lot with a `needs_release_quarantine_move` hint so
    # the mobile queue can tag the row with a "→ Finished quarantine"
    # badge instead of the generic put-away instructions. Lots hit
    # this flavour when they're finished-goods that owe a Final
    # Product Release ceremony (BRCGS 5.6) but aren't yet in a
    # finished_quarantine cell.
    items =
      Enum.map(lots, fn lot ->
        base = Payloads.stock_lot(lot)
        Map.put(base, :needs_release_quarantine_move, needs_release_move?(lot))
      end)

    json(conn, %{items: items})
  end

  defp needs_release_move?(%Backend.Stock.Lot{} = lot) do
    cond do
      lot.source_kind != "manufacturing_order" ->
        false

      lot.status not in ["awaiting_release", "available"] ->
        false

      not currently_outside_finished_quarantine?(lot) ->
        false

      Backend.Production.lot_committed_to_downstream_mo?(lot.company_id, lot.id) ->
        false

      true ->
        not finalized_release_row?(lot)
    end
  end

  defp currently_outside_finished_quarantine?(%Backend.Stock.Lot{placements: placements})
       when is_list(placements) do
    Enum.any?(placements, fn p ->
      p.qty && Decimal.compare(p.qty, Decimal.new(0)) == :gt and
        p.storage_cell && p.storage_cell.purpose != "finished_quarantine"
    end)
  end

  defp currently_outside_finished_quarantine?(_), do: false

  defp finalized_release_row?(%Backend.Stock.Lot{id: lot_id}) do
    Backend.Repo.exists?(
      from r in Backend.Production.FinalRelease,
        where: r.stock_lot_id == ^lot_id and r.status in ["released", "on_hold", "rejected"]
    )
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
        Enum.map(rows, fn %{row: r, score: score, base_score: base_score} ->
          %{
            score: score,
            # Reason is derived from the BASE score (the actual rule
            # that matched) — using the total score conflated tag-fit
            # cells with same-item consolidation because both can land
            # at 10 once the fit bonus is added.
            reason: reason_from_base(base_score),
            # Fit metrics — surfaced on the mobile recommendation card
            # so the operator sees WHY one shelf beats another (more
            # headroom, same item already there, etc).
            fit: %{
              free_pct: r.fit.free_pct,
              percent_used: r.fit.percent_used,
              # Show what the cell holds RIGHT NOW vs what it would
              # hold AFTER this lot lands, so the UI can read
              # "Currently 100% free → 98% free after this lot".
              current_percent_used: Map.get(r.fit, :current_percent_used, 0),
              projected_percent_used:
                Map.get(r.fit, :projected_percent_used, r.fit.percent_used)
            },
            cell: %{
              id: r.cell.id,
              uuid: r.cell.uuid,
              name: r.cell.name,
              # Auto-rendered code (e.g. CELL00040) — same format the
              # printed QR label carries, so the operator can match
              # the on-screen breadcrumb against the physical tag.
              code:
                if(r.cell.system_kind,
                  do: nil,
                  else: Payloads.render_entity_code(r.cell, "storage_cell")
                ),
              ordinal: r.cell.ordinal,
              tags: r.cell.tags || [],
              storage_location: %{
                id: r.location.id,
                uuid: r.location.uuid,
                name: r.location.name,
                # Use the rendered code instead of the raw DB column
                # so locations with a null code still produce the
                # SL00022-style identifier the label PDF uses.
                code: Payloads.render_entity_code(r.location, "storage_location"),
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

  defp reason_from_base(10), do: "Same item already here"
  defp reason_from_base(8), do: "Matches all storage tags"
  defp reason_from_base(4), do: "Matches some storage tags"
  defp reason_from_base(1), do: "Untagged item — any cell works"
  defp reason_from_base(_), do: "Available"

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

      {:error, :locked_by_pickup_in_progress} ->
        unprocessable(
          conn,
          "locked_by_pickup_in_progress",
          "Lot is on a picker's trolley right now — wait for that pickup to finish or abort before adjusting qty."
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

      {:error, :locked_by_pickup_in_progress} ->
        unprocessable(
          conn,
          "locked_by_pickup_in_progress",
          "Lot is on a picker's trolley right now — wait for that pickup to finish or abort before moving it."
        )

      {:error, {:cell_full, reason}} ->
        unprocessable(conn, "cell_full", cell_full_detail(reason))

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  defp cell_full_detail("no_room"),
    do: "Destination cell doesn't have enough footprint area for this lot. Pick a bigger cell or split the move."

  defp cell_full_detail("stack_too_tall"),
    do: "This lot's stack is taller than the destination cell's clearance. Split the load or pick a taller cell."

  defp cell_full_detail("weight_exceeded"),
    do: "Destination cell's max weight would be exceeded after this move. Pick a stronger cell or split the load."

  defp cell_full_detail(_),
    do: "Destination cell can't hold this move — footprint, height, or weight limit exceeded."

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

  # Allowed sort columns. Anything outside this list is silently
  # dropped — protects against atom-table DoS (`String.to_atom/1` on
  # arbitrary client input would exhaust the BEAM atom table).
  @sortable_fields ~w(
    code inserted_at expiry_at manufactured_at status
    supplier_batch_no qty_on_hand unit_cost country_of_origin
  )

  # Public for the security test suite — no other caller. Kept as
  # `def` rather than `defp` so the atom-injection regression can
  # drive `parse_sort/1` with hostile inputs and assert nothing new
  # ever hits the atom table.
  @doc false
  def parse_sort(nil), do: nil

  def parse_sort(spec) when is_binary(spec) do
    with [field, dir] <- String.split(spec, ":", parts: 2),
         true <- dir in ["asc", "desc"],
         true <- field in @sortable_fields do
      {String.to_existing_atom(field), String.to_existing_atom(dir)}
    else
      _ -> nil
    end
  end

  def parse_sort(_), do: nil
end
