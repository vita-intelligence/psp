"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Package, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  SearchPicker,
  type SearchPickerOption,
} from "@/components/forms/search-picker";
import { PageControls } from "@/components/forms/page-controls";
import type { Vendor, VendorApprovedItemRow } from "@/lib/types";
import {
  addApprovedItemAction,
  removeApprovedItemAction,
} from "@/lib/vendors/actions";

interface Props {
  vendor: Vendor;
  canEdit: boolean;
}

interface ItemOption extends SearchPickerOption {
  itemType: string;
}

interface ApprovedItemsPage {
  items: VendorApprovedItemRow[];
  total: number;
  has_more: boolean;
}

const PAGE_SIZE = 25;
const DEBOUNCE_MS = 250;

/**
 * Approved-items list. Backs the PO line validator: the (vendor,
 * item) edge decides whether a supplier can fill a line. The old
 * implementation preloaded every row into a flat chip wall — fine
 * for 10 items, hostile at 10 000. This card loads one paginated
 * page at a time with a server-side search over item name / SKU /
 * barcode.
 *
 * Add via a dropdown of items not already on the list; remove via X
 * on each row.
 */
export function VendorApprovedItemsCard({ vendor, canEdit }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState<ItemOption | null>(null);

  // Search state. Debounced into `appliedSearch` so each keystroke
  // doesn't fire a request.
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setAppliedSearch(searchInput.trim());
      setPage(0);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const [rows, setRows] = useState<VendorApprovedItemRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async ({
      pageIndex,
      search,
      signal,
    }: {
      pageIndex: number;
      search: string;
      signal?: AbortSignal;
    }) => {
      setLoading(true);
      setLoadError(null);
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(pageIndex * PAGE_SIZE),
        });
        if (search) params.set("search", search);
        const res = await fetch(
          `/api/vendors/${vendor.uuid}/approved-items?${params.toString()}`,
          { signal },
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const body = (await res.json()) as ApprovedItemsPage;
        setRows(body.items);
        setTotal(body.total);
      } catch (err) {
        if ((err as DOMException)?.name === "AbortError") return;
        setLoadError(
          err instanceof Error ? err.message : "Failed to load",
        );
      } finally {
        setLoading(false);
      }
    },
    [vendor.uuid],
  );

  // Load whenever page or applied search changes.
  useEffect(() => {
    const ctrl = new AbortController();
    void fetchPage({
      pageIndex: page,
      search: appliedSearch,
      signal: ctrl.signal,
    });
    return () => ctrl.abort();
  }, [fetchPage, page, appliedSearch]);

  const approvedItemIds = useMemo(
    () => new Set(rows.map((r) => r.item_id)),
    [rows],
  );

  // Add-picker: server-side item search excluding items already on
  // the loaded page. The user can still see items on earlier pages
  // in the picker and get a server-side duplicate error — that's
  // fine (we optimise for scale, not for a redundant client-side
  // guard that would require loading the full approved list).
  const fetchItems = useCallback(
    async (query: string, signal?: AbortSignal): Promise<ItemOption[]> => {
      const params = new URLSearchParams({ limit: "50" });
      if (query) params.set("search", query);
      const res = await fetch(`/api/items?${params.toString()}`, {
        signal,
      });
      if (!res.ok) throw new Error(`Items search failed (${res.status})`);
      const body = (await res.json()) as {
        items?: Array<{
          id: number;
          code?: string | null;
          name: string;
          item_type?: string | null;
        }>;
      };
      return (body.items ?? []).map((i) => ({
        id: i.id,
        label: i.name,
        code: i.code ?? null,
        sublabel: i.item_type ?? null,
        itemType: i.item_type ?? "",
      }));
    },
    [],
  );

  function onAdd() {
    if (!picked) return;
    startTransition(async () => {
      const res = await addApprovedItemAction(vendor.uuid, picked.id);
      if (res.ok) {
        toast.success("Item added");
        setPicked(null);
        // Jump to page 0 so the new row (sorted approved_at desc)
        // is visible immediately.
        setPage(0);
        void fetchPage({ pageIndex: 0, search: appliedSearch });
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  function onRemove(rowUuid: string) {
    startTransition(async () => {
      const res = await removeApprovedItemAction(vendor.uuid, rowUuid);
      if (res.ok) {
        toast.success("Item removed");
        // Refetch the current page so a removed last-row doesn't
        // leave an empty page sitting at the end; if we fell off
        // the end, the useEffect will clamp the page back.
        void fetchPage({ pageIndex: page, search: appliedSearch });
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  const totalCountDisplay = total ?? vendor.approved_items.length;
  const firstRow = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const lastRow = total === 0 ? 0 : page * PAGE_SIZE + rows.length;

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-3 flex items-center gap-2">
        <Package className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold tracking-tight">
          Items this vendor is approved to supply
        </h2>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {totalCountDisplay}
        </span>
      </header>

      {/* Search */}
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Filter by item name, SKU, or barcode…"
          className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-8 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {searchInput && (
          <button
            type="button"
            onClick={() => setSearchInput("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {loadError ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {loadError} —{" "}
          <button
            type="button"
            onClick={() =>
              void fetchPage({ pageIndex: page, search: appliedSearch })
            }
            className="underline"
          >
            retry
          </button>
        </p>
      ) : loading && rows.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/60 px-3 py-6 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Loading…
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
          {appliedSearch
            ? `No approved items match "${appliedSearch}".`
            : "No items approved yet. PO lines for this vendor will be blocked."}
        </p>
      ) : (
        <>
          <ul className="divide-y divide-border/60 overflow-hidden rounded-md border border-border/60">
            {rows.map((row) => (
              <li
                key={row.uuid}
                className="flex items-center gap-3 px-3 py-2 hover:bg-muted/30"
              >
                <div className="min-w-0 flex-1">
                  {row.item?.uuid ? (
                    <Link
                      href={`/production/items/${row.item.uuid}`}
                      className="block min-w-0 group"
                    >
                      <p className="truncate text-sm font-medium underline-offset-2 group-hover:underline">
                        {row.item.name}
                      </p>
                      <p className="truncate font-mono text-[10px] text-muted-foreground">
                        {row.item.code ?? `#${row.item_id}`}
                        {row.item.item_type
                          ? ` · ${row.item.item_type}`
                          : ""}
                      </p>
                    </Link>
                  ) : (
                    <p className="truncate text-sm font-medium">
                      {`Item #${row.item_id}`}
                    </p>
                  )}
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => onRemove(row.uuid)}
                    disabled={pending}
                    className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50"
                    aria-label={`Remove ${row.item?.name ?? "item"}`}
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>

          {total !== null && total > PAGE_SIZE && (
            <div className="mt-3 flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">
                Showing {firstRow}-{lastRow} of {total}
              </span>
              <PageControls
                page={page}
                pageSize={PAGE_SIZE}
                total={total}
                disabled={loading}
                onPageChange={setPage}
              />
            </div>
          )}
        </>
      )}

      {canEdit && (
        <div className="mt-4 flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Add an item
            </label>
            <SearchPicker<ItemOption>
              fetcher={fetchItems}
              value={picked}
              onChange={setPicked}
              placeholder="Search items by name, SKU, or barcode…"
              emptyHint="No active items match — adjust the search."
              excludeIds={approvedItemIds}
            />
          </div>
          <Button size="sm" onClick={onAdd} disabled={pending || !picked}>
            <Plus className="mr-1.5 size-4" />
            Add
          </Button>
        </div>
      )}
    </section>
  );
}
