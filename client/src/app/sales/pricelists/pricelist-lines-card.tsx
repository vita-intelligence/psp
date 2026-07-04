"use client";

/**
 * Pricelist line items card — separate from the header form so the
 * Save-changes button on the header doesn't look like it would also
 * save line edits (line items each have their own per-row actions).
 *
 * Item picker is bound to the same `/api/items?picker=true` endpoint
 * that other forms use.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  SearchPicker,
  type SearchPickerOption,
} from "@/components/forms/search-picker";
import { usePageLeadership } from "@/components/realtime/page-lock-guard";
import type { CompanyDefaults, Pricelist, PricelistItemRow } from "@/lib/types";
import {
  addPricelistLineAction,
  removePricelistLineAction,
  updatePricelistLineAction,
} from "@/lib/pricelists/actions";
import { formatCompanyNumber } from "@/lib/format/company";

interface ItemPickerOption extends SearchPickerOption {
  itemId: number;
  uomSymbol: string;
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
      uuid: string;
      code: string | null;
      name: string;
      stock_uom?: { symbol?: string | null } | null;
    }>;
  };
  return body.items.map((i) => ({
    id: i.id,
    itemId: i.id,
    label: i.name,
    code: i.code,
    sublabel: null,
    uomSymbol: i.stock_uom?.symbol ?? "ea",
  }));
}

interface Props {
  pricelist: Pricelist;
  canEdit: boolean;
  prefs: CompanyDefaults;
  pageId?: string;
}

export function PricelistLinesCard({
  pricelist,
  canEdit,
  prefs,
  pageId,
}: Props) {
  const router = useRouter();
  const { isLeader, leader } = usePageLeadership(pageId ?? "", !pageId);
  const locked = !!pageId && !isLeader && !!leader;
  const effectiveCanEdit = canEdit && !locked;
  const [pending, startTransition] = useTransition();
  const [pickerValue, setPickerValue] = useState<ItemPickerOption | null>(null);
  const [newPrice, setNewPrice] = useState("");
  const [newMinQty, setNewMinQty] = useState("1");
  const [error, setError] = useState<string | null>(null);

  function addLine() {
    if (!pickerValue || !newPrice.trim()) {
      setError("Pick an item and enter a price.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await addPricelistLineAction(pricelist.uuid, {
        item_id: pickerValue.itemId,
        selling_price: newPrice.trim(),
        min_quantity: newMinQty.trim() || "1",
      });
      if (res.ok) {
        toast.success("Line added");
        setPickerValue(null);
        setNewPrice("");
        setNewMinQty("1");
        router.refresh();
      } else {
        setError(res.detail);
      }
    });
  }

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="text-base">
              Line items{" "}
              <span className="text-sm font-normal text-muted-foreground">
                ({pricelist.items.length})
              </span>
            </CardTitle>
            <CardDescription>
              One row per (item × min-qty tier). Price is{" "}
              <strong>per 1 unit</strong> of the item&rsquo;s stock UoM
              (kg / pcs / ea / …). Min qty is the threshold at which
              this tier kicks in.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {pricelist.items.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/60 px-4 py-6 text-center text-xs text-muted-foreground">
            No prices yet. Add the first one below.
          </p>
        ) : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-md border border-border/60">
            <li className="grid grid-cols-[minmax(0,1fr)_120px_140px_60px_auto] items-center gap-3 bg-muted/30 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Item</span>
              <span className="text-right">Min qty</span>
              <span className="text-right">Price / unit</span>
              <span className="sr-only">UoM</span>
              <span className="sr-only">Actions</span>
            </li>
            {pricelist.items.map((row) => (
              <LineRow
                key={row.uuid}
                row={row}
                pricelistUuid={pricelist.uuid}
                currencyCode={pricelist.currency_code}
                canEdit={effectiveCanEdit}
                prefs={prefs}
                pending={pending}
                startTransition={startTransition}
              />
            ))}
          </ul>
        )}

        {effectiveCanEdit && (
          <div className="space-y-2 rounded-md border border-border/40 bg-muted/30 p-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Add a tier
            </p>
            <div className="grid grid-cols-[minmax(0,1fr)_120px_140px_auto] items-center gap-3">
              <SearchPicker<ItemPickerOption>
                fetcher={fetchItemOptions}
                value={pickerValue}
                onChange={(o) => setPickerValue(o)}
                placeholder="Pick an item…"
              />
              <Input
                type="number"
                min={0}
                step="any"
                value={newMinQty}
                onChange={(e) => setNewMinQty(e.target.value)}
                placeholder="Min qty"
                className="h-10 text-right font-mono"
              />
              <div className="relative">
                <Input
                  type="number"
                  min={0}
                  step="any"
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                  placeholder="Price"
                  className="h-10 pr-12 text-right font-mono"
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 inline-flex items-center text-xs text-muted-foreground">
                  {pricelist.currency_code}
                </span>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={addLine}
                disabled={pending || !pickerValue || !newPrice.trim()}
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
            <p className="text-[10px] text-muted-foreground">
              Tip: add multiple rows per item with different min quantities
              for tiered pricing (1+, 100+, 1000+). Price is{" "}
              <strong>per 1 unit</strong>, not per the min qty.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LineRow({
  row,
  pricelistUuid,
  currencyCode,
  canEdit,
  prefs,
  pending,
  startTransition,
}: {
  row: PricelistItemRow;
  pricelistUuid: string;
  currencyCode: string;
  canEdit: boolean;
  prefs: CompanyDefaults;
  pending: boolean;
  startTransition: (cb: () => void) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState(row.selling_price);
  const [minQty, setMinQty] = useState(row.min_quantity);

  function save() {
    startTransition(async () => {
      const res = await updatePricelistLineAction(pricelistUuid, row.uuid, {
        selling_price: price,
        min_quantity: minQty,
      });
      if (res.ok) {
        toast.success("Line updated");
        setEditing(false);
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  function remove() {
    if (!confirm(`Remove ${row.item?.name ?? "this line"}?`)) return;
    startTransition(async () => {
      const res = await removePricelistLineAction(pricelistUuid, row.uuid);
      if (res.ok) {
        toast.success("Line removed");
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  const uomSymbol = row.item?.stock_uom?.symbol ?? "ea";

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_120px_140px_60px_auto] items-center gap-3 px-4 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{row.item?.name ?? "—"}</p>
        <p className="truncate font-mono text-[10px] text-muted-foreground">
          {row.item?.code ?? `#${row.item_id}`}
        </p>
      </div>
      {editing ? (
        <Input
          type="number"
          min={0}
          step="any"
          value={String(minQty)}
          onChange={(e) => setMinQty(e.target.value)}
          className="h-9 text-right font-mono"
        />
      ) : (
        <span className="text-right font-mono text-sm">
          {formatCompanyNumber(row.min_quantity, prefs)}
        </span>
      )}
      {editing ? (
        <Input
          type="number"
          min={0}
          step="any"
          value={String(price)}
          onChange={(e) => setPrice(e.target.value)}
          className="h-9 text-right font-mono"
        />
      ) : (
        <span className="text-right font-mono text-sm font-medium">
          {formatCompanyNumber(row.selling_price, prefs)} {currencyCode}
        </span>
      )}
      <span className="text-xs text-muted-foreground">{uomSymbol}</span>
      <div className="flex items-center gap-1">
        {canEdit && !editing && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setEditing(true)}
            disabled={pending}
            className="h-8 text-xs"
          >
            Edit
          </Button>
        )}
        {canEdit && editing && (
          <>
            <Button
              type="button"
              size="sm"
              onClick={save}
              disabled={pending}
              className="h-8 text-xs"
            >
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(false);
                setPrice(row.selling_price);
                setMinQty(row.min_quantity);
              }}
              disabled={pending}
              className="h-8 text-xs"
            >
              Cancel
            </Button>
          </>
        )}
        {canEdit && !editing && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={remove}
            disabled={pending}
            className="size-8 text-muted-foreground hover:text-destructive"
            aria-label="Remove line"
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
    </li>
  );
}
