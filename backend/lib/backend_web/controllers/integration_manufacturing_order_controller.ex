defmodule BackendWeb.IntegrationManufacturingOrderController do
  @moduledoc """
  Write surface for NPD (vita-cff) → PSP Manufacturing Orders.

  Called by NPD's trial-batch detail page when a scientist clicks
  "Create MO on PSP". Payload identifies the finished-product item,
  the target warehouse, and quantity. PSP creates the MO, auto-books
  FEFO against the R&D stock pool (guarded by the `rnd` tag stream
  isolation added in Phase B), and returns the MO uuid so NPD can
  pin it on its `TrialBatch.psp_manufacturing_order_uuid`.

  Idempotent by ``npd_trial_batch_uuid`` — a retry (network blip,
  page refresh, background queue re-fire) returns the existing MO
  rather than spawning a duplicate. The unique partial index on
  the column enforces this at the DB level; this controller layers
  a read-first fast path so retries don't even attempt an insert.

  Scoped by ``mo:write``. Token is minted on `/settings/integrations`
  and must carry the scope; the same token can also carry
  ``customer_order:sync:npd`` for the older CO sync endpoint.
  """

  use BackendWeb, :controller

  import Ecto.Query
  import BackendWeb.IntegrationScopePlug

  alias Backend.CustomerOrders.CustomerOrder
  alias Backend.CustomerOrders.CustomerOrderLine
  alias Backend.Items.Item
  alias Backend.Production
  alias Backend.Production.{ManufacturingOrder, ManufacturingOrderBooking}
  alias Backend.Repo
  alias Backend.Warehouses.Warehouse

  plug :require_integration_scope, "mo:write:npd" when action in [:create]
  plug :require_integration_scope, "mo:read"
       when action in [:list_bookings, :chain, :list_warehouses]

  action_fallback BackendWeb.FallbackController

  @doc """
  POST /api/integration/manufacturing-orders

  Payload:
      %{
        "item_uuid" => "…",              # finished-product PSP Item
        "warehouse_uuid" => "…",         # target warehouse
        "quantity" => 100,               # output units
        "project_type" => "trial",       # defaults to "trial" for this endpoint
        "npd_trial_batch_uuid" => "…",   # required — idempotency key
        "due_date" => "2026-08-15",      # optional
        "notes" => "…",                  # optional
        # Optional packaging overlay for ``sample``-kind trials.
        # Non-nil = substitute the finished item's default packaging
        # BOM lines with these items instead. Empty list ``[]`` =
        # sample with no packaging picked (loose bulk output). Nil /
        # absent = use default packaging (trial + legacy behaviour).
        "packaging_combo_items" => [
          %{"item_uuid" => "…", "quantity" => "1"}
        ]
      }

  Returns 201 on create, 200 on idempotent re-fire (same trial uuid),
  400 on missing/invalid uuids, 422 on validation failure (with
  ``fields`` map).
  """
  def create(conn, params) do
    company_id = conn.assigns.current_company_id
    token = conn.assigns.current_integration_token

    with {:ok, actor} <- resolve_actor(token),
         {:ok, trial_uuid} <- require_uuid(params, "npd_trial_batch_uuid"),
         {:ok, existing} <- lookup_by_trial(company_id, trial_uuid) do
      case existing do
        %ManufacturingOrder{} = mo ->
          # Idempotent re-fire — return the existing row with the
          # same shape as a fresh create.
          conn
          |> put_status(:ok)
          |> json(%{manufacturing_order: mo_summary(mo)})

        nil ->
          do_create(conn, actor, company_id, trial_uuid, params)
      end
    else
      {:error, :missing_uuid} ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: "missing_npd_trial_batch_uuid"})

      {:error, :invalid_uuid} ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: "invalid_npd_trial_batch_uuid"})

      {:error, :no_actor} ->
        conn
        |> put_status(:internal_server_error)
        |> json(%{error: "integration_token_has_no_owner"})
    end
  end

  defp do_create(conn, actor, company_id, trial_uuid, params) do
    with {:ok, item_id} <- resolve_item_id(company_id, params["item_uuid"]),
         {:ok, warehouse_id} <- resolve_warehouse_id(company_id, params["warehouse_uuid"]),
         {:ok, combo_items} <-
           resolve_packaging_combo_items(company_id, params["packaging_combo_items"]),
         {:ok, co_line_id} <-
           resolve_sample_co_line_id(
             company_id,
             params["npd_sample_payment_uuid"]
           ) do
      attrs = %{
        "item_id" => item_id,
        "warehouse_id" => warehouse_id,
        "quantity" => params["quantity"],
        "assigned_to_id" => actor.id,
        "project_type" => Map.get(params, "project_type", "trial"),
        "npd_trial_batch_uuid" => trial_uuid,
        # Formulation UUID is optional; the schema tolerates nil so
        # legacy payloads (before NPD started sending it) still create.
        # A malformed value falls through to Ecto's UUID cast (422 with
        # a per-field error) rather than a 500.
        "npd_formulation_uuid" => Map.get(params, "npd_formulation_uuid"),
        # When NPD sends ``npd_sample_payment_uuid`` we resolve the
        # sample CO's line and set it here — this is what lands the
        # MO on the /projects kanban attached to the correct customer.
        # Nil for trial-kind MOs and legacy payloads.
        "customer_order_line_id" => co_line_id,
        "packaging_combo_items" => combo_items,
        "due_date" => params["due_date"],
        "notes" => Map.get(params, "notes", "")
      }

      case Production.create_manufacturing_order(actor, attrs) do
        {:ok, mo} ->
          conn
          |> put_status(:created)
          |> json(%{manufacturing_order: mo_summary(mo)})

        {:error, %Ecto.Changeset{} = cs} ->
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{
            error: "validation_failed",
            fields: BackendWeb.Errors.changeset_fields(cs)
          })

        {:error, {:rd_stream_mismatch, offender_item_ids}} ->
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{
            error: "rd_stream_mismatch",
            detail:
              "One or more BOM components are R&D-only (tagged `rnd`). Set project_type=trial or remove the rnd tag from the offending items.",
            offender_item_ids: offender_item_ids
          })

        {:error, reason} ->
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{error: to_string_reason(reason)})
      end
    else
      {:error, :item_not_found} ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: "item_not_found"})

      {:error, :warehouse_not_found} ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: "warehouse_not_found"})

      {:error, {:packaging_combo_item_not_found, uuid}} ->
        conn
        |> put_status(:bad_request)
        |> json(%{
          error: "packaging_combo_item_not_found",
          detail:
            "One of the packaging combo items (`#{uuid}`) does not exist on PSP. " <>
              "Mirror the item first, then retry.",
          item_uuid: uuid
        })

      {:error, :invalid_packaging_combo_items} ->
        conn
        |> put_status(:bad_request)
        |> json(%{
          error: "invalid_packaging_combo_items",
          detail:
            "packaging_combo_items must be an array of " <>
              "%{item_uuid, quantity} objects."
        })

      {:error, :sample_co_not_found} ->
        conn
        |> put_status(:bad_request)
        |> json(%{
          error: "sample_co_not_found",
          detail:
            "npd_sample_payment_uuid was supplied but no CustomerOrder " <>
              "with that uuid exists on PSP. Sync the sample CO first via " <>
              "POST /api/integration/customer-orders/sync-sample, then retry."
        })

      {:error, :sample_co_missing_line} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{
          error: "sample_co_missing_line",
          detail:
            "The sample CustomerOrder was found but has no line to " <>
              "attach the MO to. This shouldn't happen — the sync path " <>
              "always inserts one. Re-run the sync and retry."
        })

      {:error, :invalid_sample_payment_uuid} ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: "invalid_sample_payment_uuid"})
    end
  end

  # Resolve the CustomerOrderLine.id that this MO should attach to
  # when NPD sends ``npd_sample_payment_uuid``. That uuid IS the
  # sample CO's uuid (planted by NpdSync.upsert_sample_from_npd), so
  # we can look up the CO directly + take its first (and only) line.
  #
  # Return values:
  #
  #   * ``{:ok, nil}`` — no sample uuid on the payload. Trial-kind MO
  #     or legacy sample flow. Nothing to link.
  #   * ``{:ok, line_id}`` — sample CO + its line resolved.
  #   * ``{:error, :sample_co_not_found}`` — uuid was sent but no CO
  #     exists yet on PSP. Caller should sync first.
  #   * ``{:error, :sample_co_missing_line}`` — CO exists but has no
  #     line. Data inconsistency worth surfacing loudly.
  defp resolve_sample_co_line_id(_company_id, nil), do: {:ok, nil}
  defp resolve_sample_co_line_id(_company_id, ""), do: {:ok, nil}

  defp resolve_sample_co_line_id(company_id, raw) when is_binary(raw) do
    case Ecto.UUID.cast(raw) do
      {:ok, uuid} ->
        case Repo.one(
               from co in CustomerOrder,
                 where: co.company_id == ^company_id and co.uuid == ^uuid,
                 limit: 1
             ) do
          nil ->
            {:error, :sample_co_not_found}

          %CustomerOrder{id: co_id} ->
            case Repo.one(
                   from l in CustomerOrderLine,
                     where: l.customer_order_id == ^co_id,
                     order_by: [asc: l.inserted_at],
                     limit: 1
                 ) do
              nil -> {:error, :sample_co_missing_line}
              %CustomerOrderLine{id: line_id} -> {:ok, line_id}
            end
        end

      :error ->
        {:error, :invalid_sample_payment_uuid}
    end
  end

  defp resolve_sample_co_line_id(_company_id, _),
    do: {:error, :invalid_sample_payment_uuid}

  # NPD posts an array like ``[%{"item_uuid" => "…", "quantity" => "1"}, …]``.
  # Resolve each uuid → local ``item_id`` up-front so the booking loop
  # doesn't have to hit ``items`` by uuid on every allocate call, and
  # so a bad uuid fails fast at insert time rather than mid-transaction.
  #
  # Return semantics:
  #   * ``nil`` → no field sent (legacy trial batch, or trial-kind).
  #     Overlay stays inactive; MO uses default packaging.
  #   * ``[]`` → sample MO with no combo picked. Overlay is active
  #     but empty — default packaging is skipped and nothing is
  #     booked in its place (loose bulk output).
  #   * populated list → normal combo. Same treatment as [], plus
  #     each item gets booked at ``quantity × mo.quantity``.
  defp resolve_packaging_combo_items(_company_id, nil), do: {:ok, nil}

  defp resolve_packaging_combo_items(_company_id, []), do: {:ok, []}

  defp resolve_packaging_combo_items(company_id, rows) when is_list(rows) do
    Enum.reduce_while(rows, {:ok, []}, fn row, {:ok, acc} ->
      with true <- is_map(row),
           uuid when is_binary(uuid) and uuid != "" <- Map.get(row, "item_uuid"),
           qty when qty not in [nil, ""] <- Map.get(row, "quantity") do
        case resolve_item_id(company_id, uuid) do
          {:ok, item_id} ->
            {:cont,
             {:ok,
              acc ++
                [%{"item_id" => item_id, "quantity" => to_string(qty)}]}}

          {:error, :item_not_found} ->
            {:halt, {:error, {:packaging_combo_item_not_found, uuid}}}
        end
      else
        _ -> {:halt, {:error, :invalid_packaging_combo_items}}
      end
    end)
  end

  defp resolve_packaging_combo_items(_company_id, _),
    do: {:error, :invalid_packaging_combo_items}

  @doc """
  GET /api/integration/manufacturing-orders/:uuid/bookings

  Returns the per-booking pick / consumption state so NPD can render
  the live "picker is at step 3 of 5" indicator on the trial-batch
  card.
  """
  def list_bookings(conn, %{"uuid" => uuid}) do
    company_id = conn.assigns.current_company_id

    case Repo.one(
           from mo in ManufacturingOrder,
             where: mo.company_id == ^company_id and mo.uuid == ^uuid
         ) do
      nil ->
        {:error, :not_found}

      %ManufacturingOrder{id: mo_id} ->
        bookings =
          Repo.all(
            from b in ManufacturingOrderBooking,
              where: b.manufacturing_order_id == ^mo_id,
              preload: [:item, :stock_lot, :storage_cell]
          )

        json(conn, %{
          bookings: Enum.map(bookings, &booking_payload/1),
          summary: bookings_summary(bookings)
        })
    end
  end

  @doc """
  GET /api/integration/manufacturing-orders/:uuid/chain

  Returns the full parent → child MO tree rooted at the trial MO
  (walks up to the root, then collects every descendant BFS). NPD's
  trial-batch panel uses this to render the stage chain — one row
  per stage MO, indented by depth, with per-MO status.
  """
  def chain(conn, %{"uuid" => uuid}) do
    company_id = conn.assigns.current_company_id

    case Repo.one(
           from mo in ManufacturingOrder,
             where: mo.company_id == ^company_id and mo.uuid == ^uuid
         ) do
      nil ->
        {:error, :not_found}

      %ManufacturingOrder{} = mo ->
        chain = Production.mo_chain(mo)
        depth_by_id = compute_depth_by_id(chain)

        json(conn, %{
          chain:
            chain
            |> Enum.map(fn m -> chain_node_payload(m, chain, depth_by_id) end)
            |> Enum.sort_by(fn n -> {n.depth, n.inserted_at || ""} end)
        })
    end
  end

  @doc """
  GET /api/integration/warehouses

  Lists warehouses set up for R&D use — a warehouse qualifies when
  at least one of its cells carries the ``rnd`` purpose. Matches the
  pickup allocator check in
  ``Backend.Production.fetch_pickup_target_cell/2``.

  Powers the warehouse dropdown in NPD's Create-MO-on-PSP modal —
  scientists pick per-MO instead of relying on a global setting, so
  a multi-site company can route different trial batches to
  different R&D warehouses. Filtering to R&D-purposed warehouses
  enforces the stream-isolation posture at picker time.

  Returns ``{"warehouses": [{"uuid", "name"}, ...]}``, sorted by
  name. Empty list when the company has no R&D-purposed
  warehouses — NPD surfaces "no R&D warehouse configured on PSP".
  """
  def list_warehouses(conn, _params) do
    company_id = conn.assigns.current_company_id

    # Storage sites only. The ``warehouses`` table is dual-purpose:
    # ``kind = "warehouse"`` holds raw + finished-goods stock;
    # ``kind = "production_facility"`` hosts workstations + WIP.
    # Trial batches route received stock to storage, so production
    # facilities never belong in NPD's Create-MO warehouse picker —
    # even if one carries a stray R&D-tagged cell for WIP staging.
    rnd_warehouse_ids =
      from(w in Warehouse,
        join: l in Backend.Warehouses.StorageLocation,
        on: l.warehouse_id == w.id,
        join: c in Backend.Warehouses.StorageCell,
        on: c.storage_location_id == l.id,
        where: w.company_id == ^company_id and w.is_active == true,
        where: w.kind == "warehouse",
        where: c.purpose == "rnd",
        distinct: true,
        select: w.id
      )

    warehouses =
      Repo.all(
        from w in Warehouse,
          where: w.id in subquery(rnd_warehouse_ids),
          order_by: [asc: w.name],
          select: %{uuid: w.uuid, name: w.name}
      )

    json(conn, %{warehouses: warehouses})
  end

  # ---- helpers ----

  # BFS depth from the root: root = 0, its direct children = 1, etc.
  # Computed once against the flat chain so the payload can carry
  # a stable indentation hint to the FE without it having to
  # re-derive the tree.
  defp compute_depth_by_id(chain) do
    by_id = Map.new(chain, fn m -> {m.id, m} end)

    Enum.reduce(chain, %{}, fn mo, acc ->
      Map.put(acc, mo.id, depth_for(mo, by_id, 0))
    end)
  end

  defp depth_for(%ManufacturingOrder{parent_mo_id: nil}, _by_id, depth), do: depth

  defp depth_for(%ManufacturingOrder{parent_mo_id: pid}, by_id, depth) do
    case Map.get(by_id, pid) do
      nil -> depth
      parent -> depth_for(parent, by_id, depth + 1)
    end
  end

  defp chain_node_payload(%ManufacturingOrder{} = mo, chain, depth_by_id) do
    parent =
      case mo.parent_mo_id do
        nil -> nil
        pid -> Enum.find(chain, fn m -> m.id == pid end)
      end

    %{
      uuid: mo.uuid,
      status: mo.status,
      quantity: to_string(mo.quantity),
      project_type: mo.project_type,
      npd_trial_batch_uuid: mo.npd_trial_batch_uuid,
      due_date: mo.due_date,
      inserted_at: mo.inserted_at,
      parent_uuid: parent && parent.uuid,
      depth: Map.get(depth_by_id, mo.id, 0),
      is_root: is_nil(mo.parent_mo_id),
      item: mo.item && %{uuid: mo.item.uuid, name: mo.item.name}
    }
  end

  defp resolve_actor(%{created_by_id: uid}) when is_integer(uid) do
    case Repo.get(Backend.Accounts.User, uid) do
      nil -> {:error, :no_actor}
      user -> {:ok, user}
    end
  end

  defp resolve_actor(_), do: {:error, :no_actor}

  defp require_uuid(params, key) do
    case params[key] do
      nil ->
        {:error, :missing_uuid}

      "" ->
        {:error, :missing_uuid}

      raw when is_binary(raw) ->
        case Ecto.UUID.cast(raw) do
          {:ok, cast} -> {:ok, cast}
          :error -> {:error, :invalid_uuid}
        end

      _ ->
        {:error, :invalid_uuid}
    end
  end

  defp lookup_by_trial(company_id, trial_uuid) do
    # Only ACTIVE MOs count as an idempotency hit. A cancelled MO
    # frees the trial-batch slot so NPD can re-fire ``Create MO``
    # without minting a new trial batch (the plan persists, the run
    # is what gets re-attempted). The partial unique index enforces
    # this on the DB side too.
    row =
      Repo.one(
        from mo in ManufacturingOrder,
          where:
            mo.company_id == ^company_id and
              mo.npd_trial_batch_uuid == ^trial_uuid and
              mo.status != "cancelled"
      )

    {:ok, row}
  end

  defp resolve_item_id(_company_id, nil), do: {:error, :item_not_found}
  defp resolve_item_id(_company_id, ""), do: {:error, :item_not_found}

  defp resolve_item_id(company_id, uuid) when is_binary(uuid) do
    case Repo.one(
           from i in Item,
             where: i.company_id == ^company_id and i.uuid == ^uuid,
             select: i.id
         ) do
      nil -> {:error, :item_not_found}
      id -> {:ok, id}
    end
  end

  defp resolve_warehouse_id(_company_id, nil), do: {:error, :warehouse_not_found}
  defp resolve_warehouse_id(_company_id, ""), do: {:error, :warehouse_not_found}

  defp resolve_warehouse_id(company_id, uuid) when is_binary(uuid) do
    case Repo.one(
           from w in Warehouse,
             where: w.company_id == ^company_id and w.uuid == ^uuid,
             select: w.id
         ) do
      nil -> {:error, :warehouse_not_found}
      id -> {:ok, id}
    end
  end

  defp mo_summary(%ManufacturingOrder{} = mo) do
    %{
      uuid: mo.uuid,
      status: mo.status,
      quantity: to_string(mo.quantity),
      project_type: mo.project_type,
      npd_trial_batch_uuid: mo.npd_trial_batch_uuid,
      due_date: mo.due_date,
      inserted_at: mo.inserted_at
    }
  end

  defp booking_payload(%ManufacturingOrderBooking{} = b) do
    %{
      uuid: b.uuid,
      status: b.status,
      quantity: to_string(b.quantity),
      picked_at: b.picked_at,
      item: b.item && %{uuid: b.item.uuid, name: b.item.name},
      lot: b.stock_lot && %{uuid: b.stock_lot.uuid, status: b.stock_lot.status},
      cell: b.storage_cell && %{uuid: b.storage_cell.uuid, name: b.storage_cell.name}
    }
  end

  defp bookings_summary(bookings) do
    total = length(bookings)
    picked = Enum.count(bookings, &(&1.picked_at != nil))
    released = Enum.count(bookings, &(&1.status == "released"))
    consumed = Enum.count(bookings, &(&1.status == "consumed"))

    %{
      total: total,
      picked: picked,
      released: released,
      consumed: consumed,
      outstanding: total - picked
    }
  end

  defp to_string_reason(reason) when is_atom(reason), do: Atom.to_string(reason)
  defp to_string_reason(reason) when is_binary(reason), do: reason
  defp to_string_reason(reason), do: inspect(reason)
end
