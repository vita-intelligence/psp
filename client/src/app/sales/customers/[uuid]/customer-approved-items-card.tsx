"use client";

/**
 * Per-customer approved-products list. Empty list = customer can be
 * sold anything (default open shop); non-empty = restricted to the
 * listed items. The gate runs at Customer Order submit time.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, PackageOpen, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  SearchPicker,
  type SearchPickerOption,
} from "@/components/forms/search-picker";
import { Badge } from "@/components/ui/badge-mini";
import type { Customer } from "@/lib/types";
import {
  addCustomerApprovedItemAction,
  removeCustomerApprovedItemAction,
} from "@/lib/customer-orders/actions";

interface ItemPickerOption extends SearchPickerOption {
  itemId: number;
}

async function fetchItemOptions(
  query: string,
  signal?: AbortSignal,
): Promise<ItemPickerOption[]> {
  const qs = new URLSearchParams({ picker: "true", limit: "50" });
  if (query) qs.set("search", query);
  const res = await fetch(`/api/items?${qs.toString()}`, {
    cache: "no-store",
    signal,
  });
  if (!res.ok) return [];
  const body = (await res.json()) as {
    items: Array<{
      id: number;
      code: string | null;
      name: string;
    }>;
  };
  return body.items.map((i) => ({
    id: i.id,
    itemId: i.id,
    label: i.name,
    code: i.code,
  }));
}

interface Props {
  customer: Customer;
  canEdit: boolean;
}

export function CustomerApprovedItemsCard({ customer, canEdit }: Props) {
  const router = useRouter();
  const [picked, setPicked] = useState<ItemPickerOption | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const rows = customer.approved_items ?? [];
  const isRestricted = rows.length > 0;
  const excludeIds = new Set(rows.map((r) => r.item_id));

  function add() {
    if (!picked) return;
    setError(null);
    startTransition(async () => {
      const res = await addCustomerApprovedItemAction(customer.uuid, picked.itemId);
      if (res.ok) {
        toast.success("Item added to approved list");
        setPicked(null);
        router.refresh();
      } else {
        setError(res.detail);
      }
    });
  }

  function remove(rowUuid: string, itemName: string) {
    if (!confirm(`Remove ${itemName} from the approved-items list?`)) return;
    startTransition(async () => {
      const res = await removeCustomerApprovedItemAction(customer.uuid, rowUuid);
      if (res.ok) {
        toast.success("Item removed");
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <PackageOpen className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold tracking-tight">
            Approved products
          </h2>
          <Badge tone={isRestricted ? "amber" : "emerald"}>
            {isRestricted
              ? `Restricted (${rows.length})`
              : "Open — all items sellable"}
          </Badge>
        </div>
      </header>

      <p className="mb-3 text-[11px] text-muted-foreground">
        Empty list = customer can be sold anything. Adding rows turns it
        into a whitelist — Customer Orders are blocked at submit time
        when any line item is not on this list.
      </p>

      {rows.length > 0 && (
        <ul className="mb-4 divide-y divide-border/60 rounded-md border border-border/60">
          {rows.map((r) => (
            <li
              key={r.uuid}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2"
            >
              <div className="min-w-0">
                {r.item?.uuid ? (
                  <Link
                    href={`/settings/items/${r.item.uuid}`}
                    className="block group"
                  >
                    <p className="truncate text-sm font-medium underline-offset-2 group-hover:underline">
                      {r.item.name}
                    </p>
                    <p className="truncate font-mono text-[10px] text-muted-foreground">
                      {r.item.code ?? `#${r.item_id}`}
                    </p>
                  </Link>
                ) : (
                  <>
                    <p className="truncate text-sm font-medium">—</p>
                    <p className="truncate font-mono text-[10px] text-muted-foreground">
                      {`#${r.item_id}`}
                    </p>
                  </>
                )}
              </div>
              {canEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-destructive"
                  onClick={() => remove(r.uuid, r.item?.name ?? "this item")}
                  disabled={pending}
                  aria-label="Remove"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="space-y-2 rounded-md border border-border/40 bg-muted/30 p-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Add an item
          </p>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <SearchPicker<ItemPickerOption>
              fetcher={fetchItemOptions}
              value={picked}
              onChange={(o) => setPicked(o)}
              placeholder="Pick an item…"
              excludeIds={excludeIds}
            />
            <Button
              type="button"
              size="sm"
              onClick={add}
              disabled={pending || !picked}
            >
              {pending ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <Plus className="mr-1.5 size-4" />
              )}
              Add
            </Button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </section>
  );
}
