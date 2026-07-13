"use client";

/**
 * Line items card for a CO. In draft: add / edit / remove rows with
 * auto-priced lookup from the customer's pricelist. After submit:
 * locked, table only.
 */

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
// Trash2 used inside the inline LineRow component (typed-import keeps it in scope).
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SearchPicker,
  type SearchPickerOption,
} from "@/components/forms/search-picker";
import { Badge } from "@/components/ui/badge-mini";
import type {
  CompanyDefaults,
  CustomerOrder,
  CustomerOrderLine,
} from "@/lib/types";
import {
  addCOLineAction,
  removeCOLineAction,
  suggestLinePriceAction,
  updateCOLineAction,
} from "@/lib/customer-orders/actions";
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
  co: CustomerOrder;
  canEdit: boolean;
  prefs: CompanyDefaults;
}

export function COLinesCard({ co, canEdit, prefs }: Props) {
  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="text-base">
              Line items{" "}
              <span className="text-sm font-normal text-muted-foreground">
                ({co.lines.length})
              </span>
            </CardTitle>
            <CardDescription>
              Pricelist lookup auto-fills price on add. Prices stay
              snapshot once added — a later pricelist edit doesn&rsquo;t
              re-quote a confirmed order.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {co.lines.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/60 px-4 py-6 text-center text-xs text-muted-foreground">
            No lines yet. {canEdit ? "Add the first one below." : ""}
          </p>
        ) : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-md border border-border/60">
            <li className="grid grid-cols-[minmax(0,1fr)_120px_160px_140px_110px] items-center gap-3 bg-muted/30 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Item</span>
              <span className="text-right">Qty</span>
              <span className="text-right">Price / unit</span>
              <span className="text-right">Line total</span>
              <span className="sr-only">Actions</span>
            </li>
            {co.lines.map((line) => (
              <LineRow
                key={line.uuid}
                line={line}
                coUuid={co.uuid}
                currencyCode={co.currency_code}
                canEdit={canEdit}
                prefs={prefs}
              />
            ))}
          </ul>
        )}

        {canEdit && (
          <AddLineForm
            coUuid={co.uuid}
            currencyCode={co.currency_code}
            defaultWarehouseId={co.default_warehouse_id}
          />
        )}

        {/* Footer totals — read straight from the denormalised header
            so we don't have to recompute on every render. */}
        <div className="rounded-md border border-border/40 bg-muted/30 px-4 py-3 text-sm">
          <dl className="grid grid-cols-2 gap-y-1 sm:grid-cols-[1fr_auto]">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="text-right font-mono">
              {formatCompanyNumber(co.subtotal, prefs)} {co.currency_code}
            </dd>
            {Number(co.discount_amount) > 0 && (
              <>
                <dt className="text-muted-foreground">
                  Discount ({co.discount_pct}%)
                </dt>
                <dd className="text-right font-mono">
                  − {formatCompanyNumber(co.discount_amount, prefs)} {co.currency_code}
                </dd>
              </>
            )}
            {Number(co.tax_amount) > 0 && (
              <>
                <dt className="text-muted-foreground">Tax ({co.tax_rate}%)</dt>
                <dd className="text-right font-mono">
                  {formatCompanyNumber(co.tax_amount, prefs)} {co.currency_code}
                </dd>
              </>
            )}
            {Number(co.shipping_fees) > 0 && (
              <>
                <dt className="text-muted-foreground">Shipping</dt>
                <dd className="text-right font-mono">
                  {formatCompanyNumber(co.shipping_fees, prefs)} {co.currency_code}
                </dd>
              </>
            )}
            {Number(co.additional_fees) > 0 && (
              <>
                <dt className="text-muted-foreground">Additional fees</dt>
                <dd className="text-right font-mono">
                  {formatCompanyNumber(co.additional_fees, prefs)} {co.currency_code}
                </dd>
              </>
            )}
            <dt className="pt-1 font-semibold">Grand total</dt>
            <dd className="pt-1 text-right font-mono font-semibold">
              {formatCompanyNumber(co.grand_total, prefs)} {co.currency_code}
            </dd>
          </dl>
        </div>
      </CardContent>
    </Card>
  );
}

function AddLineForm({
  coUuid,
  currencyCode,
  defaultWarehouseId,
}: {
  coUuid: string;
  currencyCode: string;
  defaultWarehouseId: number | null;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<ItemPickerOption | null>(null);
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [pricelistName, setPricelistName] = useState<string | null>(null);
  const [pricelistId, setPricelistId] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced price lookup on item or qty change.
  function refreshPriceSuggestion(itemId: number | null, qtyVal: string) {
    if (!itemId || !qtyVal.trim()) {
      setPricelistName(null);
      setPricelistId(null);
      return;
    }
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    suggestTimer.current = setTimeout(async () => {
      const res = await suggestLinePriceAction(coUuid, itemId, qtyVal);
      if (res.ok && res.suggestion) {
        setPrice(String(res.suggestion.unit_price));
        setPricelistName(res.suggestion.pricelist_name);
        setPricelistId(res.suggestion.pricelist_id);
      } else {
        setPricelistName(null);
        setPricelistId(null);
      }
    }, 250);
  }

  function onItemPicked(o: ItemPickerOption | null) {
    setPicked(o);
    refreshPriceSuggestion(o?.itemId ?? null, qty);
  }

  function onQtyChange(v: string) {
    setQty(v);
    refreshPriceSuggestion(picked?.itemId ?? null, v);
  }

  function add() {
    if (!picked || !qty.trim() || !price.trim()) {
      setError("Pick an item, set qty, set price.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await addCOLineAction(coUuid, {
        item_id: picked.itemId,
        qty_ordered: qty,
        unit_price: price,
        warehouse_id: defaultWarehouseId,
        pricelist_id: pricelistId,
      });
      if (res.ok) {
        toast.success("Line added");
        setPicked(null);
        setQty("1");
        setPrice("");
        setPricelistName(null);
        setPricelistId(null);
        router.refresh();
      } else {
        setError(res.detail);
      }
    });
  }

  return (
    <div className="space-y-2 rounded-md border border-border/40 bg-muted/30 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        Add a line
      </p>
      <div className="grid grid-cols-[minmax(0,1fr)_120px_160px_auto] items-center gap-3">
        <SearchPicker<ItemPickerOption>
          fetcher={fetchItemOptions}
          value={picked}
          onChange={onItemPicked}
          placeholder="Pick an item…"
        />
        <div className="relative">
          <Input
            type="number"
            min={0}
            step="any"
            value={qty}
            onChange={(e) => onQtyChange(e.target.value)}
            placeholder="Qty"
            aria-label="Quantity"
            className="h-10 pr-12 text-right font-mono"
          />
          <span className="pointer-events-none absolute inset-y-0 right-2.5 inline-flex items-center text-[11px] font-medium text-muted-foreground">
            {picked?.uomSymbol ?? "ea"}
          </span>
        </div>
        <div className="relative">
          <Input
            type="number"
            min={0}
            step="any"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Unit price"
            aria-label={`Unit price in ${currencyCode}`}
            className="h-10 pr-16 text-right font-mono"
          />
          <span className="pointer-events-none absolute inset-y-0 right-2.5 inline-flex items-center gap-0.5 text-[11px] font-medium text-muted-foreground">
            <span>{currencyCode}</span>
            <span className="text-muted-foreground/60">
              /{picked?.uomSymbol ?? "ea"}
            </span>
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={add}
          disabled={pending || !picked || !qty.trim() || !price.trim()}
        >
          {pending ? (
            <Loader2 className="mr-1.5 size-4 animate-spin" />
          ) : (
            <Plus className="mr-1.5 size-4" />
          )}
          Add
        </Button>
      </div>
      {pricelistName && (
        <p className="text-[10px] text-muted-foreground">
          <Badge tone="sky">{pricelistName}</Badge>{" "}
          quoted automatically. You can override the price before adding.
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function LineRow({
  line,
  coUuid,
  currencyCode,
  canEdit,
  prefs,
}: {
  line: CustomerOrderLine;
  coUuid: string;
  currencyCode: string;
  canEdit: boolean;
  prefs: CompanyDefaults;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(line.qty_ordered);
  const [price, setPrice] = useState(line.unit_price);
  const [pending, startTransition] = useTransition();

  // Suffix labels inside the inputs — these are what disambiguate
  // "which box is qty vs unit price" once the operator's focus has
  // moved past the column headers. Fallback "ea" (each) for items
  // without a stock UoM configured yet.
  const uomSymbol = line.item?.stock_uom?.symbol ?? "ea";

  function save() {
    startTransition(async () => {
      const res = await updateCOLineAction(coUuid, line.uuid, {
        qty_ordered: qty,
        unit_price: price,
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
    if (!confirm(`Remove ${line.item?.name ?? "this line"}?`)) return;
    startTransition(async () => {
      const res = await removeCOLineAction(coUuid, line.uuid);
      if (res.ok) {
        toast.success("Line removed");
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_120px_160px_140px_110px] items-center gap-3 px-4 py-2">
      <div className="min-w-0">
        {line.item?.uuid ? (
          <Link
            href={`/settings/items/${line.item.uuid}`}
            className="block group"
          >
            <p className="truncate text-sm font-medium underline-offset-2 group-hover:underline">
              {line.item.name}
            </p>
            <p className="truncate font-mono text-[10px] text-muted-foreground">
              {line.item.code ?? `#${line.item_id}`}{" "}
              {line.item.stock_uom?.symbol ? `· ${line.item.stock_uom.symbol}` : ""}
            </p>
          </Link>
        ) : (
          <>
            <p className="truncate text-sm font-medium">—</p>
            <p className="truncate font-mono text-[10px] text-muted-foreground">
              {`#${line.item_id}`}
            </p>
          </>
        )}
      </div>
      {editing ? (
        <div className="relative">
          <Input
            type="number"
            min={0}
            step="any"
            value={String(qty)}
            onChange={(e) => setQty(e.target.value)}
            aria-label="Quantity"
            className="h-9 pr-10 text-right font-mono"
          />
          <span className="pointer-events-none absolute inset-y-0 right-2.5 inline-flex items-center text-[11px] font-medium text-muted-foreground">
            {uomSymbol}
          </span>
        </div>
      ) : (
        <span className="text-right font-mono text-sm">
          {formatCompanyNumber(line.qty_ordered, prefs)}{" "}
          <span className="text-[11px] font-normal text-muted-foreground">
            {uomSymbol}
          </span>
        </span>
      )}
      {editing ? (
        <div className="relative">
          <Input
            type="number"
            min={0}
            step="any"
            value={String(price)}
            onChange={(e) => setPrice(e.target.value)}
            aria-label={`Unit price in ${currencyCode}`}
            className="h-9 pr-14 text-right font-mono"
          />
          <span className="pointer-events-none absolute inset-y-0 right-2.5 inline-flex items-center gap-0.5 text-[11px] font-medium text-muted-foreground">
            <span>{currencyCode}</span>
            <span className="text-muted-foreground/60">/{uomSymbol}</span>
          </span>
        </div>
      ) : (
        <span className="text-right font-mono text-sm">
          {formatCompanyNumber(line.unit_price, prefs)}{" "}
          <span className="text-[11px] font-normal text-muted-foreground">
            {currencyCode} /{uomSymbol}
          </span>
        </span>
      )}
      <span className="text-right font-mono text-sm font-medium">
        {formatCompanyNumber(
          editing ? computeLineTotal(qty, price) : line.line_subtotal,
          prefs,
        )}{" "}
        <span className="text-[11px] font-normal text-muted-foreground">
          {currencyCode}
        </span>
      </span>
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
                setQty(line.qty_ordered);
                setPrice(line.unit_price);
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
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
    </li>
  );
}

// Live line-total preview while the operator is editing qty / price.
// Returns a string in the same shape line.line_subtotal comes back as
// (decimal-ish) so formatCompanyNumber renders it consistently. A
// non-numeric input (blank field mid-typing) folds to "0" so the
// preview shows something rather than "NaN".
function computeLineTotal(qty: string, price: string): string {
  const q = Number(qty);
  const p = Number(price);
  if (!Number.isFinite(q) || !Number.isFinite(p)) return "0";
  return String(q * p);
}
