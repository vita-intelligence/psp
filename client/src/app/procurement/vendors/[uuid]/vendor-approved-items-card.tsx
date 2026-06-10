"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Package, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import type { Item, Vendor } from "@/lib/types";
import {
  addApprovedItemAction,
  removeApprovedItemAction,
} from "@/lib/vendors/actions";

interface Props {
  vendor: Vendor;
  items: Item[];
  canEdit: boolean;
}

/**
 * Approved-items list. Each row is the vendor↔item edge a PO line
 * validator reads to decide whether the supplier can fill that line.
 *
 * Add via a dropdown of items not already on the list; remove via X
 * on each chip. No edit UI for the row's notes here — operators who
 * need a long-form record can fall back to the audit log.
 */
export function VendorApprovedItemsCard({ vendor, items, canEdit }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pickItemId, setPickItemId] = useState<string>("");

  const approvedItemIds = useMemo(
    () => new Set(vendor.approved_items.map((r) => r.item_id)),
    [vendor.approved_items],
  );

  const availableItems = items.filter((i) => !approvedItemIds.has(i.id));

  function onAdd() {
    if (!pickItemId) return;
    const itemId = Number(pickItemId);
    startTransition(async () => {
      const res = await addApprovedItemAction(vendor.uuid, itemId);
      if (res.ok) {
        toast.success("Item added");
        setPickItemId("");
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
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-3 flex items-center gap-2">
        <Package className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold tracking-tight">
          Items this vendor is approved to supply
        </h2>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {vendor.approved_items.length}
        </span>
      </header>

      {vendor.approved_items.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
          No items approved yet. PO lines for this vendor will be blocked.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {vendor.approved_items.map((row) => (
            <li
              key={row.uuid}
              className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/40 py-1 pl-3 pr-1 text-xs"
            >
              <span className="font-mono text-[10px] text-muted-foreground">
                {row.item?.code ?? `#${row.item_id}`}
              </span>
              <span className="font-medium">
                {row.item?.name ?? `Item #${row.item_id}`}
              </span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => onRemove(row.uuid)}
                  disabled={pending}
                  className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Remove"
                >
                  <X className="size-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && availableItems.length > 0 && (
        <div className="mt-4 flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Add an item
            </label>
            <Select value={pickItemId} onValueChange={setPickItemId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Pick an item…" />
              </SelectTrigger>
              <SelectContent>
                {availableItems.map((i) => (
                  <SelectItem key={i.id} value={String(i.id)}>
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {i.code ?? `#${i.id}`}
                      </span>
                      <span>{i.name}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            onClick={onAdd}
            disabled={pending || !pickItemId}
          >
            <Plus className="mr-1.5 size-4" />
            Add
          </Button>
        </div>
      )}
    </section>
  );
}
