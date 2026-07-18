"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Layers, Loader2, Package, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorBanner } from "@/components/forms/error-banner";
import { CollabAvatars } from "@/components/realtime/collab-avatars";
import { FieldEditingIndicator } from "@/components/realtime/field-editing-indicator";
import { useLiveForm } from "@/lib/realtime/use-live-form";
import { useEntityChannel } from "@/lib/realtime/use-entity-channel";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import type {
  Item,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderSuggestPrice,
} from "@/lib/types";
import type { ErrorDebug } from "@/lib/errors/types";
import {
  addLineAction,
  deleteLineAction,
  suggestLinePriceAction,
} from "@/lib/purchase-orders/actions";
import { formatCompanyDate, formatCompanyMoney } from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";

// Mirrors the server-side `Backend.Purchasing.VendorPrices` threshold.
// Symmetric — proposed prices outside ±20% surface the warning banner.
const DEVIATION_THRESHOLD = 0.2;

interface Props {
  po: PurchaseOrder;
  items: Item[];
  canEdit: boolean;
}

interface AddLineState {
  pickItemId: string;
  qty: string;
  price: string;
}

const INITIAL: AddLineState = { pickItemId: "", qty: "", price: "" };

export function POLinesCard({ po, items, canEdit }: Props) {
  const router = useRouter();
  const prefs = useFormatPrefs();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{
    detail: string;
    code?: string;
    debug?: ErrorDebug;
  } | null>(null);

  // Cached last-paid for the currently-picked item. Refetched every
  // time the worker swaps the item dropdown; cleared when the dropdown
  // empties so a stale caption doesn't survive a reset.
  const [lastPaid, setLastPaid] = useState<
    PurchaseOrderSuggestPrice["last_paid"] | null
  >(null);
  const [suggestLoading, setSuggestLoading] = useState(false);

  const resource = `purchase-order:${po.uuid}`;
  useFormPresenceBeacon(resource);

  // PO detail refresh on peer edits (line add / remove / mark_ordered).
  // useEntityChannel calls router.refresh() internally on every event,
  // so the SSR-fed child_lot chips + line rows re-render with fresh
  // data without the operator hitting reload.
  useEntityChannel({ entity: "purchase-order", uuid: po.uuid });
  // Child-lot lifecycle events (mint / promote / cancel) fire on the
  // stock-lot channel. Tenant-scoped subscription refreshes the page
  // whenever any lot changes; the debounce inside the hook collapses
  // bursts. Slight over-fire for lots not on this PO is a trivial cost
  // compared to filtering by FK per event.
  useEntityChannel({ entity: "stock-lot" });

  const {
    state,
    setField,
    resetState,
    presence,
    fieldEditors,
    focusField,
    blurField,
    creator,
    isCreator,
    broadcastCommit,
  } = useLiveForm<AddLineState>({
    resource,
    disabled: !canEdit,
    initialState: INITIAL,
    onCommit: () => {
      // A peer added/removed a line — pull fresh PO state.
      router.refresh();
    },
  });

  // Refetch the last-paid lookup whenever the picked item changes —
  // the parent PO already pins vendor + currency, so item is the only
  // axis the FE has to vary.
  useEffect(() => {
    if (!state.pickItemId) return;

    let cancelled = false;
    // Spinner + cached row are externally-fed state — both flow from
    // the suggest-price fetch, which is the canonical effect use case.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSuggestLoading(true);

    (async () => {
      const res = await suggestLinePriceAction(po.uuid, Number(state.pickItemId));
      if (cancelled) return;

      if (res.ok) {
        setLastPaid(res.last_paid);
        // Pre-fill unit_price ONLY when the worker hasn't typed yet.
        // Once they've started entering a value (even by editing the
        // suggested one), don't clobber their input.
        if (res.last_paid && state.price === "") {
          setField("price", res.last_paid.unit_price);
        }
      } else {
        // Soft failure — the worker can still type the price by hand.
        setLastPaid(null);
      }

      setSuggestLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.pickItemId, po.uuid]);

  // Clearing the picker (resetState / X) wipes the cached suggestion
  // synchronously — fielded here instead of in the effect so the lint
  // rule against effect-driven setState stays happy.
  function pickItem(itemId: string) {
    setField("pickItemId", itemId);
    if (!itemId) setLastPaid(null);
  }

  // ±20% deviation check against the cached last-paid price. Yellow
  // warning only — does NOT block submission. Worker confirms or
  // revises with eyes open.
  const deviation = computeDeviation(state.price, lastPaid?.unit_price);

  function onAdd() {
    if (!state.pickItemId || !state.qty || !state.price) return;
    if (!isCreator) return;
    setError(null);
    startTransition(async () => {
      const res = await addLineAction(po.uuid, {
        item_id: Number(state.pickItemId),
        qty_ordered: state.qty,
        unit_price: state.price,
      });
      if (res.ok) {
        toast.success("Line added");
        resetState(INITIAL);
        setLastPaid(null);
        broadcastCommit({ kind: "line_added" });
        router.refresh();
      } else {
        setError({ detail: res.detail, code: res.code, debug: res.debug });
      }
    });
  }

  function onRemove(lineUuid: string) {
    if (!isCreator) return;
    startTransition(async () => {
      const res = await deleteLineAction(po.uuid, lineUuid);
      if (res.ok) {
        toast.success("Line removed");
        broadcastCommit({ kind: "line_removed" });
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-3 flex items-center gap-2">
        <Layers className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold tracking-tight">Lines</h2>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {po.lines.length}
        </span>
        {canEdit && <CollabAvatars peers={presence} className="ml-2" />}
      </header>

      {po.lines.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
          No lines yet. Add at least one before submitting.
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border border-border/60">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Item</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
                <th className="px-3 py-2 text-right font-medium">Received</th>
                <th className="px-3 py-2 text-right font-medium">Unit price</th>
                <th className="px-3 py-2 text-right font-medium">Subtotal</th>
                {canEdit && <th className="w-8" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {po.lines.map((l) => (
                <tr key={l.uuid}>
                  <td className="px-3 py-2">
                    {l.item?.uuid ? (
                      <Link
                        href={`/production/items/${l.item.uuid}`}
                        className="block group"
                      >
                        <p className="truncate text-sm font-medium underline-offset-2 group-hover:underline">
                          {l.item.name}
                        </p>
                        <p className="truncate font-mono text-[10px] text-muted-foreground">
                          {l.item.code ?? `#${l.item_id}`}
                        </p>
                      </Link>
                    ) : (
                      <>
                        <p className="truncate text-sm font-medium">
                          {l.item?.name ?? `Item #${l.item_id}`}
                        </p>
                        <p className="truncate font-mono text-[10px] text-muted-foreground">
                          {l.item?.code ?? `#${l.item_id}`}
                        </p>
                      </>
                    )}
                    <ChildLotChip line={l} />
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-sm">
                    {fmtQty(l.qty_ordered)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-sm text-muted-foreground">
                    {fmtQty(l.qty_received)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-sm">
                    {formatCompanyMoney(l.unit_price, prefs, {
                      currency_code: po.currency_code,
                    })}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-sm font-semibold">
                    {formatCompanyMoney(l.line_subtotal, prefs, {
                      currency_code: po.currency_code,
                    })}
                  </td>
                  {canEdit && (
                    <td className="px-2 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => onRemove(l.uuid)}
                        disabled={pending || !isCreator}
                        title={
                          isCreator
                            ? undefined
                            : creator
                              ? `Only ${creator.name} can remove from this room.`
                              : undefined
                        }
                        className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label="Remove"
                      >
                        <X className="size-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-border/60 bg-muted/20 text-sm">
              <tr>
                <td colSpan={4} className="px-3 py-2 text-right text-muted-foreground">
                  Subtotal
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {formatCompanyMoney(po.subtotal, prefs, {
                    currency_code: po.currency_code,
                  })}
                </td>
                {canEdit && <td />}
              </tr>
              <tr>
                <td colSpan={4} className="px-3 py-2 text-right font-semibold">
                  Total
                </td>
                <td className="px-3 py-2 text-right font-mono font-semibold">
                  {formatCompanyMoney(po.total_amount, prefs, {
                    currency_code: po.currency_code,
                  })}
                </td>
                {canEdit && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {canEdit && (
        <div className="mt-4 space-y-3 rounded-md border border-dashed border-border/60 p-3">
          {error && (
            <ErrorBanner
              detail={error.detail}
              code={error.code}
              debug={error.debug}
            />
          )}
          {deviation && lastPaid && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <p className="leading-snug">
                This is{" "}
                <span className="font-semibold">
                  {formatPctChange(deviation.pctChange)}
                </span>{" "}
                {deviation.pctChange > 0 ? "higher" : "lower"} than the last
                paid price of{" "}
                <span className="font-mono font-semibold">
                  {formatCompanyMoney(lastPaid.unit_price, prefs, {
                    currency_code: lastPaid.currency_code,
                  })}
                </span>{" "}
                on {formatCompanyDate(lastPaid.last_paid_at, prefs)} — confirm
                or revise.
              </p>
            </div>
          )}
          <div className="grid items-end gap-3 sm:grid-cols-[2fr_1fr_1fr_auto]">
            <div className="space-y-1.5">
              <Label
                htmlFor="line-pickItemId"
                className="text-[11px] uppercase tracking-wider text-muted-foreground"
              >
                Item
              </Label>
              <div className="relative">
                <Select
                  value={state.pickItemId}
                  onValueChange={pickItem}
                >
                  <SelectTrigger
                    id="line-pickItemId"
                    className="h-9"
                    onFocus={() => focusField("pickItemId")}
                    onBlur={() => blurField("pickItemId")}
                  >
                    <SelectValue placeholder="Pick an item…" />
                  </SelectTrigger>
                  <SelectContent>
                    {items.map((i) => (
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
                <FieldEditingIndicator peer={fieldEditors.pickItemId} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label
                htmlFor="line-qty"
                className="text-[11px] uppercase tracking-wider text-muted-foreground"
              >
                Qty
              </Label>
              <div className="relative">
                <Input
                  id="line-qty"
                  value={state.qty}
                  onChange={(e) => setField("qty", e.target.value)}
                  onFocus={() => focusField("qty")}
                  onBlur={() => blurField("qty")}
                  placeholder="100"
                  inputMode="decimal"
                  className="h-9 font-mono"
                />
                <FieldEditingIndicator peer={fieldEditors.qty} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label
                htmlFor="line-price"
                className="text-[11px] uppercase tracking-wider text-muted-foreground"
              >
                Unit price
              </Label>
              <div className="relative">
                <Input
                  id="line-price"
                  value={state.price}
                  onChange={(e) => setField("price", e.target.value)}
                  onFocus={() => focusField("price")}
                  onBlur={() => blurField("price")}
                  placeholder="5.15"
                  inputMode="decimal"
                  className="h-9 font-mono"
                />
                <FieldEditingIndicator peer={fieldEditors.price} />
              </div>
            </div>
            <Button
              size="sm"
              className="h-9"
              onClick={onAdd}
              disabled={
                pending ||
                !state.pickItemId ||
                !state.qty ||
                !state.price ||
                !isCreator
              }
              title={
                isCreator
                  ? undefined
                  : creator
                    ? `Only ${creator.name} can add from this room.`
                    : undefined
              }
            >
              {pending ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <Plus className="mr-1.5 size-4" />
              )}
              Add line
            </Button>
          </div>
          {/* Suggest-price hint lives on its own row so it doesn't push
              the Unit price input out of alignment with the others. */}
          {(suggestLoading || lastPaid || state.pickItemId) && (
            <p className="text-[11px] text-muted-foreground">
              {suggestLoading
                ? "Looking up last paid price…"
                : lastPaid
                  ? `Last paid ${formatCompanyMoney(lastPaid.unit_price, prefs, { currency_code: lastPaid.currency_code })} on ${formatCompanyDate(lastPaid.last_paid_at, prefs)}.`
                  : "No prior purchases — first time buying this item from this vendor."}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

interface Deviation {
  pctChange: number;
  proposed: number;
  last: number;
}

/**
 * Mirrors `Backend.Purchasing.VendorPrices.deviation_check/5`. Returns
 * a Deviation object only when the proposed price is strictly outside
 * ±20% of the last paid value; otherwise returns null so the banner
 * stays hidden.
 */
function computeDeviation(
  proposedRaw: string,
  lastRaw: string | undefined,
): Deviation | null {
  if (!proposedRaw || !lastRaw) return null;
  const proposed = Number(proposedRaw);
  const last = Number(lastRaw);
  if (!Number.isFinite(proposed) || !Number.isFinite(last)) return null;
  if (last <= 0) return null;

  const pct = (proposed - last) / last;
  if (Math.abs(pct) <= DEVIATION_THRESHOLD) return null;

  return { pctChange: pct, proposed, last };
}

function formatPctChange(pct: number): string {
  const sign = pct > 0 ? "+" : "−";
  return `${sign}${Math.round(Math.abs(pct) * 100)}%`;
}

/**
 * Format a Decimal string (e.g. "500.0000") for display in the lines
 * table — strip trailing zeros after the decimal so `500.0000` reads
 * as `500` and `12.3450` reads as `12.345`. Falls back to the raw
 * input for non-numeric values.
 */
function fmtQty(value: string | null | undefined): string {
  if (!value) return "0";
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  // toFixed-then-parseFloat trims trailing zeros while keeping the
  // significant decimals (10.0000 → "10", 10.5000 → "10.5").
  return parseFloat(n.toFixed(4)).toString();
}

/** Small chip under the item name showing the day-one LOT number
 *  minted from this PO line + its current status. Clickable — deep
 *  links into the stock lot detail page so a planner can jump from
 *  PO detail into the lot's booking / event history in one click.
 *  Rendered only when the backend has a child_lot for this line
 *  (nil for legacy pre-PR-1 lines). */
function ChildLotChip({ line }: { line: PurchaseOrderLine }) {
  const lot = line.child_lot;
  if (!lot) return null;

  return (
    <Link
      href={`/stock/lots/${lot.uuid}`}
      className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
      title={`Open lot ${lot.code}`}
    >
      <Package className="size-3" />
      <span>{lot.code}</span>
      <span
        className={
          "rounded px-1 text-[9px] uppercase tracking-wider " +
          LOT_STATUS_CHIP[lot.status]
        }
      >
        {lot.status.replace("_", " ")}
      </span>
    </Link>
  );
}

// Tailwind class map keyed by lot status — each chip picks up its own
// tone so a glance across the lines table tells the planner which
// lots are still paperwork (`requested`) vs financially committed
// (`expected`) vs physically here (`available`).
const LOT_STATUS_CHIP: Record<string, string> = {
  requested: "bg-slate-100 text-slate-700",
  expected: "bg-indigo-100 text-indigo-800",
  received: "bg-sky-100 text-sky-800",
  quarantine: "bg-amber-100 text-amber-800",
  awaiting_release: "bg-amber-100 text-amber-800",
  available: "bg-emerald-100 text-emerald-800",
  on_hold: "bg-amber-100 text-amber-800",
  depleted: "bg-muted text-muted-foreground",
  disposed: "bg-muted text-muted-foreground",
  rejected: "bg-red-100 text-red-800",
  canceled: "bg-muted text-muted-foreground line-through",
};
