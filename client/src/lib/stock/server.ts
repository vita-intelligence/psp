import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type {
  InventoryRow,
  Item,
  StockLot,
  StockMovement,
  StockWriteOff,
  StockWriteOffRow,
  Warehouse,
} from "../types";

/**
 * Fetch the first page of stock lots from the backend. Used by the
 * /stock/lots server component for an SSR-first render — the
 * DataTable then takes over pagination + filtering on the client.
 */
export async function listStockLotsPage(
  filters: { item_id?: number } = {},
): Promise<{
  items: StockLot[];
  next_cursor: string | null;
} | null> {
  const token = await getSessionToken();
  if (!token) return null;

  const qs = new URLSearchParams();
  if (typeof filters.item_id === "number") {
    qs.set("item_id", String(filters.item_id));
  }
  const suffix = qs.toString();

  try {
    return await api<{ items: StockLot[]; next_cursor: string | null }>(
      `/api/stock/lots${suffix ? `?${suffix}` : ""}`,
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}

/** First page of the /stock/movements audit log — cursor-paginated
 *  movements enriched with lot + item + uom for the table row. Optional
 *  ``lot_id`` locks the query to a single lot when the caller wants
 *  the same table embedded on a lot detail page. */
export interface StockMovementRow extends StockMovement {
  stock_lot: {
    id: number;
    uuid: string;
    code: string | null;
    supplier_batch_no: string | null;
  } | null;
  item: {
    id: number;
    uuid: string;
    name: string;
    code: string | null;
    external_sku: string | null;
  } | null;
  unit_of_measurement: { id: number; symbol: string | null } | null;
}

export async function listStockMovementsPage(
  filters: {
    from_at?: string;
    to_at?: string;
    kinds?: string[];
    reason_categories?: string[];
    item_id?: number;
    lot_id?: number;
    cell_id?: number;
    warehouse_id?: number;
    actor_id?: number;
    search?: string;
  } = {},
): Promise<{
  items: StockMovementRow[];
  next_cursor: string | null;
} | null> {
  const token = await getSessionToken();
  if (!token) return null;

  const qs = new URLSearchParams();
  if (filters.from_at) qs.set("from_at", filters.from_at);
  if (filters.to_at) qs.set("to_at", filters.to_at);
  if (filters.kinds?.length) qs.set("kinds", filters.kinds.join(","));
  if (filters.reason_categories?.length)
    qs.set("reason_categories", filters.reason_categories.join(","));
  if (typeof filters.item_id === "number")
    qs.set("item_id", String(filters.item_id));
  if (typeof filters.lot_id === "number")
    qs.set("lot_id", String(filters.lot_id));
  if (typeof filters.cell_id === "number")
    qs.set("cell_id", String(filters.cell_id));
  if (typeof filters.warehouse_id === "number")
    qs.set("warehouse_id", String(filters.warehouse_id));
  if (typeof filters.actor_id === "number")
    qs.set("actor_id", String(filters.actor_id));
  if (filters.search) qs.set("search", filters.search);
  const suffix = qs.toString();

  try {
    return await api<{ items: StockMovementRow[]; next_cursor: string | null }>(
      `/api/stock/movements${suffix ? `?${suffix}` : ""}`,
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}

/** First page of the /stock/write-offs paperwork queue — the
 *  three-signature workflow around an eventual adjust_down. Optional
 *  filters mirror the listStockMovementsPage helper. */
export async function listStockWriteOffsPage(
  filters: {
    from_at?: string;
    to_at?: string;
    status?: string;
    reason_category?: string;
    created_by_id?: number;
    stock_lot_id?: number;
    search?: string;
  } = {},
): Promise<{
  items: StockWriteOffRow[];
  next_cursor: string | null;
} | null> {
  const token = await getSessionToken();
  if (!token) return null;

  const qs = new URLSearchParams();
  if (filters.from_at) qs.set("from_at", filters.from_at);
  if (filters.to_at) qs.set("to_at", filters.to_at);
  if (filters.status) qs.set("status", filters.status);
  if (filters.reason_category) qs.set("reason_category", filters.reason_category);
  if (typeof filters.created_by_id === "number")
    qs.set("created_by_id", String(filters.created_by_id));
  if (typeof filters.stock_lot_id === "number")
    qs.set("stock_lot_id", String(filters.stock_lot_id));
  if (filters.search) qs.set("search", filters.search);
  const suffix = qs.toString();

  try {
    return await api<{
      items: StockWriteOffRow[];
      next_cursor: string | null;
    }>(`/api/stock/write-offs${suffix ? `?${suffix}` : ""}`, {
      token,
      cache: "no-store",
    });
  } catch {
    return null;
  }
}

/** Single write-off + all sig details for the /stock/write-offs/[uuid]
 *  detail page. Null on auth failure so the page can render the
 *  not-found shell instead of a 500. */
export async function getStockWriteOff(
  uuid: string,
): Promise<StockWriteOff | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    const res = await api<{ write_off: StockWriteOff }>(
      `/api/stock/write-offs/${encodeURIComponent(uuid)}`,
      { token, cache: "no-store" },
    );
    return res.write_off;
  } catch {
    return null;
  }
}

/** First page of the item-level inventory rollup — drives the
 *  /stock/inventory page. Returns null on auth failure so the page
 *  component can render the empty shell instead of a 500. */
export async function listInventoryFirstPage(): Promise<{
  items: InventoryRow[];
  next_cursor: string | null;
} | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    return await api<{ items: InventoryRow[]; next_cursor: string | null }>(
      "/api/stock/inventory",
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}

/** Fetch the first page of items (catalogue) for the receive-form
 *  item picker. The receive form filters by name/code client-side
 *  from this initial set; large catalogues fall through to the
 *  searchable items endpoint later.
 *
 *  ``limit=200`` is deliberately bounded — the PO-lines picker is a
 *  simple dropdown, not a virtualised list. A 5000-item catalogue
 *  would ship ~2 MB of payload on every PO detail page load, so we
 *  cap the preload and add a search-endpoint fallback below for
 *  catalogues that exceed the preload. Use ``searchItems(q)`` to
 *  find items outside the first 200.
 */
export async function listItemsForReceive(): Promise<Item[]> {
  const token = await getSessionToken();
  if (!token) return [];
  try {
    const res = await api<{ items: Item[]; next_cursor: string | null }>(
      "/api/items?limit=200",
      { token, cache: "no-store" },
    );
    return res.items;
  } catch {
    return [];
  }
}

/** Search the item catalogue when the operator's target isn't in the
 *  preloaded first-200 page. Called by the PO-lines picker's search
 *  input; returns up to ``limit`` (default 30) items ranked by name
 *  match. */
export async function searchItems(
  q: string,
  limit = 30,
): Promise<Item[]> {
  const trimmed = q.trim();
  if (trimmed.length < 2) return [];
  const token = await getSessionToken();
  if (!token) return [];
  try {
    const params = new URLSearchParams({
      search: trimmed,
      limit: String(limit),
    });
    const res = await api<{ items: Item[]; next_cursor: string | null }>(
      `/api/items?${params.toString()}`,
      { token, cache: "no-store" },
    );
    return res.items;
  } catch {
    return [];
  }
}

/**
 * Fetch a single lot by uuid for the label / detail pages.
 * Returns null when not found or when the user has no session — both
 * are "render the not-found shell" cases for the caller.
 */
export async function getStockLot(uuid: string): Promise<{
  lot: StockLot;
  movements: StockMovement[];
} | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    return await api<{ lot: StockLot; movements: StockMovement[] }>(
      `/api/stock/lots/${encodeURIComponent(uuid)}`,
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}

/** Warehouse list for the Site filter dropdown on the receive form.
 *  Cheap call — typical companies have a handful of warehouses. */
export async function listWarehousesForReceive(): Promise<Warehouse[]> {
  const token = await getSessionToken();
  if (!token) return [];
  try {
    const res = await api<{ items: Warehouse[]; next_cursor: string | null }>(
      "/api/warehouses?limit=200",
      { token, cache: "no-store" },
    );
    return res.items;
  } catch {
    return [];
  }
}

/**
 * Warehouse-home "Parked at production" card fetch. Returns two lists:
 * stranded (ingredients kept at production_feed > N hours, no live claim)
 * and expired (any placement at production_feed whose lot has passed
 * its expiry date). Empty arrays on auth failure or network drop so
 * the card renders "all clear" instead of a red error banner — no
 * stranding is a real signal too.
 */
export interface ParkedAtProductionRow {
  lot_uuid: string | null;
  lot_code: string | null;
  supplier_batch_no: string | null;
  item_name: string | null;
  qty: string | number | null;
  kept_at: string | null;
  kept_hours_ago: number | null;
  expiry_at: string | null;
  cell_name: string | null;
  location_name: string | null;
  warehouse_name: string | null;
  warehouse_uuid: string | null;
}

export async function fetchParkedAtProduction(
  maxAgeHours = 24,
): Promise<{
  stranded: ParkedAtProductionRow[];
  expired: ParkedAtProductionRow[];
  max_age_hours: number;
}> {
  const token = await getSessionToken();
  if (!token) return { stranded: [], expired: [], max_age_hours: maxAgeHours };
  try {
    return await api<{
      stranded: ParkedAtProductionRow[];
      expired: ParkedAtProductionRow[];
      max_age_hours: number;
    }>(`/api/stock/lots/parked-at-production?max_age_hours=${maxAgeHours}`, {
      token,
      cache: "no-store",
    });
  } catch {
    return { stranded: [], expired: [], max_age_hours: maxAgeHours };
  }
}
