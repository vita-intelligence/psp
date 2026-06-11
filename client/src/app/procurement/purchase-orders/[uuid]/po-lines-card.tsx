"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Layers, Loader2, Plus, X } from "lucide-react";
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
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import type { Item, PurchaseOrder } from "@/lib/types";
import type { ErrorDebug } from "@/lib/errors/types";
import {
  addLineAction,
  deleteLineAction,
} from "@/lib/purchase-orders/actions";
import { formatCompanyMoney } from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";

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

  const resource = `purchase-order:${po.uuid}`;
  useFormPresenceBeacon(resource);

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
                    <p className="truncate text-sm font-medium">
                      {l.item?.name ?? `Item #${l.item_id}`}
                    </p>
                    <p className="truncate font-mono text-[10px] text-muted-foreground">
                      {l.item?.code ?? `#${l.item_id}`}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-sm">
                    {l.qty_ordered}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-sm text-muted-foreground">
                    {l.qty_received}
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
                  onValueChange={(v) => setField("pickItemId", v)}
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
                  className="font-mono"
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
                  className="font-mono"
                />
                <FieldEditingIndicator peer={fieldEditors.price} />
              </div>
            </div>
            <Button
              size="sm"
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
        </div>
      )}
    </section>
  );
}
