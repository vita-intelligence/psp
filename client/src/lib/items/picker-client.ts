import type {
  SearchPickerOption,
  SearchPickerPage,
} from "@/components/forms/search-picker";

/** Row shape returned by the item search fetcher — mirrors the
 *  minimal fields the picker needs, without dragging the full Item
 *  payload through client components. */
export interface ItemPickerOption extends SearchPickerOption {
  itemType: string;
  externalSku: string | null;
}

/** Build a paginated `SearchPicker` fetcher for the item catalog.
 *  Returns `(query, cursor, signal) => Promise<{items, nextCursor}>`
 *  that hits `/api/items?picker=true&search=…&cursor=…` — filtering,
 *  paging, and sorting all run in Postgres, so a catalog of millions
 *  never lands in the browser as a single page. Pair it with
 *  `<SearchPicker paginatedFetcher={...} />` to get infinite scroll.
 *
 *  Same-origin session cookies handle auth, so no token juggling.
 *  The `AbortSignal` from SearchPicker is threaded through so a
 *  fast typist doesn't stack up in-flight requests.
 *
 *  `itemType` is comma-joined into the query — the backend accepts
 *  `item_type=finished_product,semi_finished` and returns the
 *  union.
 */
export function itemPickerFetcher(opts: {
  itemType: string | string[];
  /** Page size sent to the server. Default 25 — a good balance
   *  between "renders instantly" and "one page is often enough". */
  limit?: number;
}) {
  const typeParam = Array.isArray(opts.itemType)
    ? opts.itemType.join(",")
    : opts.itemType;
  const limit = opts.limit ?? 25;

  return async (
    query: string,
    cursor: string | null,
    signal?: AbortSignal,
  ): Promise<SearchPickerPage<ItemPickerOption>> => {
    const params = new URLSearchParams({
      picker: "true",
      item_type: typeParam,
      limit: String(limit),
    });
    if (query.trim()) params.set("search", query.trim());
    if (cursor) params.set("cursor", cursor);

    const res = await fetch(`/api/items?${params.toString()}`, {
      cache: "no-store",
      signal,
    });
    if (!res.ok) {
      throw new Error(`Item search failed (${res.status})`);
    }
    const body = (await res.json()) as {
      items: Array<{
        id: number;
        code: string | null;
        name: string;
        item_type: string;
        external_sku: string | null;
      }>;
      next_cursor: string | null;
    };
    return {
      items: body.items.map((i) => ({
        id: i.id,
        label: i.name,
        code: i.code,
        sublabel: i.external_sku ?? null,
        itemType: i.item_type,
        externalSku: i.external_sku ?? null,
      })),
      nextCursor: body.next_cursor ?? null,
    };
  };
}
