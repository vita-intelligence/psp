"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Lock,
  LockKeyhole,
  Plus,
  ShieldAlert,
  Trash2,
  Truck,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { CountryPicker } from "@/components/forms/country-picker";
import { PackBoxPreview } from "@/components/packaging/pack-box-preview";
import { CollabAvatars } from "@/components/realtime/collab-avatars";
import { FieldEditingIndicator } from "@/components/realtime/field-editing-indicator";
import { RemoteCursor } from "@/components/realtime/remote-cursor";
import { useLiveForm } from "@/lib/realtime/use-live-form";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import { cn } from "@/lib/utils";
import type { PurchaseOrder, Warehouse } from "@/lib/types";
import type { ErrorDebug } from "@/lib/errors/types";
import {
  receivePOAction,
  type ReceivePOPack,
} from "@/lib/purchase-orders/actions";

interface Props {
  po: PurchaseOrder;
  warehouses: Warehouse[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional — defaults to `true`. When false, the dialog renders
   *  read-only (no channel join, no presence chips, no inputs). The
   *  caller usually gates on `procurement.po_receive` upstream and
   *  doesn't render this dialog at all without permission. */
  canEdit?: boolean;
}

/** Stable client-side id keys the React list + lets the dialog refer
 *  to packs by handle while the operator adds/removes rows. */
interface PackDraft extends ReceivePOPack {
  tempId: string;
  /** Toggles the "advanced" override row (batch / dates / country /
   *  revision / quarantine). Collapsed by default to keep the dialog
   *  scannable. */
  expanded: boolean;
}

interface LineState {
  /** Stable per-line key derived from the PO line uuid. */
  line_uuid: string;
  packs: PackDraft[];
}

/** The portion of the dialog state we sync via the live form. Pack
 *  rows themselves are local React state (an array doesn't fit cleanly
 *  into per-field broadcast), but the top-level fields + per-pack
 *  individual values get individual `setField` keys so peers see
 *  the typing in flight. */
interface LiveState {
  warehouse_id: string;
  supplier_batch_no_default: string;
  /** Mirror of each pack's editable values, keyed by `pack:<tempId>:<field>`.
   *  Kept inside the live form state so the snapshot:request handshake
   *  catches up late joiners with the in-flight pack edits too. */
  [packField: string]: string;
}

/**
 * Per-pack receive dialog. Each pack row becomes its own stock_lot
 * with its own packaging, so a PO line for 100kg arriving as
 * "4 × 25kg drums + 1 × 100kg sack" yields 2 lots (the drums roll up
 * via units_per_package=4; the sack stands alone).
 *
 * Sum of pack qtys per line must not exceed the line's remaining;
 * sum below remaining is fine (partial receipt, PO line stays open).
 * 0 packs on a line skips that line entirely with no error.
 *
 * Top-level supplier batch is a default — each pack can override.
 * Advanced fields (manufactured / expiry / country / revision /
 * quarantine route) live behind a per-pack expand toggle so the
 * common case stays compact.
 *
 * Realtime collab per psp/CLAUDE.md: two operators commonly receive
 * the same shipment together (one with the BOL, one keying packs).
 * Presence avatars, per-field editing indicators, live cursors, and
 * the head-of-room gate on Submit stop them from racing each other.
 */
export function PoReceiveDialog({
  po,
  warehouses,
  open,
  onOpenChange,
  canEdit = true,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{
    detail: string;
    code?: string;
    debug?: ErrorDebug;
  } | null>(null);

  const eligibleLines = useMemo(
    () =>
      po.lines.filter(
        (l) => Number(l.qty_ordered) - Number(l.qty_received || 0) > 0,
      ),
    [po.lines],
  );

  // Pre-seed each eligible line with ONE pack pre-filled to the full
  // remaining qty + sensible default packaging. Operators tweak the
  // pack qty or hit "Add pack" to split.
  const initialLines = useMemo<LineState[]>(
    () =>
      eligibleLines.map((l) => ({
        line_uuid: l.uuid,
        packs: [makeDefaultPack(remainingOf(l))],
      })),
    [eligibleLines],
  );
  const [lines, setLines] = useState<LineState[]>(initialLines);

  // One channel per PO. Operators receiving the same PO simultaneously
  // share this room. PO id (uuid) is stable for the life of the PO,
  // so the room is too.
  const resource = `po-receive:${po.uuid}`;
  useFormPresenceBeacon(resource);

  const liveInitial = useMemo<LiveState>(
    () => ({ warehouse_id: "", supplier_batch_no_default: "" }),
    [],
  );

  const {
    state: live,
    setField,
    presence,
    fieldEditors,
    focusField,
    blurField,
    joinError,
    creator,
    isCreator,
    cursors,
    setCursor,
    hideCursor,
    broadcastCommit,
  } = useLiveForm<LiveState>({
    resource,
    // Closed dialog or viewer (no perm) ⇒ skip the channel.
    disabled: !canEdit || !open,
    initialState: liveInitial,
    onCommit: (raw) => {
      // Creator just hit Record receipt. Close everyone's dialog and
      // refresh the page so the new lots show up.
      const msg = raw as { kind?: string } | null;
      if (!msg) return;
      if (msg.kind === "received") {
        toast.success("Receipt recorded", {
          description: `${creator?.name ?? "The host"} just recorded the receipt.`,
        });
        onOpenChange(false);
        router.refresh();
      }
    },
  });

  // Local mirrors of the two top-level live fields. Keeps the existing
  // computed-state code untouched; reads go through `live.*`.
  const warehouseId = live.warehouse_id ?? "";
  const batchDefault = live.supplier_batch_no_default ?? "";

  function setWarehouseId(v: string) {
    setField("warehouse_id", v);
  }
  function setBatchDefault(v: string) {
    setField("supplier_batch_no_default", v);
  }

  // Per-pack helpers — broadcast each keystroke under a stable
  // `pack:<tempId>:<field>` key so late joiners + peers see the
  // edits as they happen. The authoritative array stays in local
  // React state because the submit payload reads it directly.
  function patchPackLive(tempId: string, patch: Partial<PackDraft>) {
    for (const [k, v] of Object.entries(patch)) {
      const key = `pack:${tempId}:${k}`;
      // Only string-able primitives go through the live form. Booleans
      // (expanded), nulls, and numerics get coerced to strings for
      // transport; the local React state keeps the typed value.
      setField(key, v == null ? "" : String(v));
    }
  }

  function updateLine(line_uuid: string, mut: (ls: LineState) => LineState) {
    setLines((prev) =>
      prev.map((ls) => (ls.line_uuid === line_uuid ? mut(ls) : ls)),
    );
  }

  function addPack(line_uuid: string) {
    updateLine(line_uuid, (ls) => ({
      ...ls,
      packs: [...ls.packs, makeDefaultPack("0")],
    }));
  }

  function removePack(line_uuid: string, tempId: string) {
    updateLine(line_uuid, (ls) => ({
      ...ls,
      packs: ls.packs.filter((p) => p.tempId !== tempId),
    }));
  }

  function patchPack(
    line_uuid: string,
    tempId: string,
    patch: Partial<PackDraft>,
  ) {
    updateLine(line_uuid, (ls) => ({
      ...ls,
      packs: ls.packs.map((p) => (p.tempId === tempId ? { ...p, ...patch } : p)),
    }));
    patchPackLive(tempId, patch);
  }

  function togglePack(line_uuid: string, tempId: string) {
    patchPack(line_uuid, tempId, {
      expanded: !lines
        .find((l) => l.line_uuid === line_uuid)
        ?.packs.find((p) => p.tempId === tempId)?.expanded,
    });
  }

  // ── Cursor anchor ─────────────────────────────────────────────────
  const cursorAnchorRef = useRef<HTMLDivElement | null>(null);
  const [anchorSize, setAnchorSize] = useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });
  useEffect(() => {
    const el = cursorAnchorRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setAnchorSize({ w: rect.width, h: rect.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => () => hideCursor(), [hideCursor]);

  const onCursorMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = cursorAnchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      setCursor(x, y);
    },
    [setCursor],
  );

  // ── Validation ─────────────────────────────────────────────────────
  const validity = useMemo(() => {
    return lines.map((ls) => {
      const poLine = po.lines.find((l) => l.uuid === ls.line_uuid)!;
      const remaining = remainingOf(poLine);
      const sum = ls.packs.reduce(
        (acc, p) => acc + (parseFloat(p.qty) || 0),
        0,
      );
      const issues: string[] = [];
      if (sum > Number(remaining) + 1e-9) issues.push("over_receipt");
      ls.packs.forEach((p, idx) => {
        if (p.qty !== "" && parseFloat(p.qty) <= 0) issues.push(`qty_${idx}`);
        if (
          (p.qty !== "" && parseFloat(p.qty) > 0) &&
          (!isPositive(p.package_length_mm) ||
            !isPositive(p.package_width_mm) ||
            !isPositive(p.package_height_mm) ||
            !isPositive(p.package_weight_kg) ||
            !isPositive(p.units_per_package) ||
            !isPositive(p.stack_factor))
        ) {
          issues.push(`dim_${idx}`);
        }
      });
      return { line_uuid: ls.line_uuid, sum, remaining, issues };
    });
  }, [lines, po.lines]);

  const totalReceiving = validity.reduce((acc, v) => acc + v.sum, 0);
  const anyIssues = validity.some((v) => v.issues.length > 0);

  const canSubmit =
    canEdit &&
    isCreator &&
    warehouseId !== "" &&
    totalReceiving > 0 &&
    !anyIssues &&
    !pending;

  // ── Submit ─────────────────────────────────────────────────────────
  function onSubmit() {
    if (!canSubmit) return;
    setError(null);

    // Strip zero-qty packs (skipped lines / unused new rows) before
    // sending. Lines that end up with zero packs are dropped so the
    // backend doesn't see them at all (matches the "0 packs = skip
    // this line" rule).
    const payload = {
      warehouse_id: Number(warehouseId),
      supplier_batch_no_default: batchDefault.trim() || null,
      lines: lines
        .map((ls) => ({
          line_uuid: ls.line_uuid,
          packs: ls.packs
            .filter((p) => parseFloat(p.qty || "0") > 0)
            .map(
              ({ tempId: _t, expanded: _e, ...rest }): ReceivePOPack => ({
                ...rest,
                supplier_batch_no: rest.supplier_batch_no?.trim() || null,
                manufactured_at: rest.manufactured_at || null,
                expiry_at: rest.expiry_at || null,
                country_of_origin: rest.country_of_origin || null,
                revision: rest.revision?.trim() || null,
              }),
            ),
        }))
        .filter((l) => l.packs.length > 0),
    };

    startTransition(async () => {
      const res = await receivePOAction(po.uuid, payload);
      if (res.ok) {
        toast.success("Receipt recorded", {
          description: `${countTotalPacks(payload.lines)} lot${
            countTotalPacks(payload.lines) === 1 ? "" : "s"
          } created.`,
        });
        // Tell peers in the same room that we just persisted — they
        // close their dialog and refresh too. Without this both
        // operators would still see the open dialog after one of
        // them submitted.
        broadcastCommit({ kind: "received" });
        onOpenChange(false);
        router.refresh();
      } else {
        setError({ detail: res.detail, code: res.code, debug: res.debug });
      }
    });
  }

  if (canEdit && joinError) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="size-4 text-muted-foreground" />
              Receive against PO {po.code ?? `#${po.id}`}
            </DialogTitle>
          </DialogHeader>
          <JoinErrorCard error={joinError} />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <div
          ref={cursorAnchorRef}
          onMouseMove={onCursorMove}
          onMouseLeave={hideCursor}
          className="relative"
        >
          {/* Remote cursors layer */}
          <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden rounded-xl">
            {Object.entries(cursors).map(([id, cursor]) => (
              <RemoteCursor
                key={id}
                cursor={cursor}
                anchorWidth={anchorSize.w}
                anchorHeight={anchorSize.h}
              />
            ))}
          </div>

          <DialogHeader>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="space-y-1.5">
                <DialogTitle className="flex items-center gap-2">
                  <Truck className="size-4 text-muted-foreground" />
                  Receive against PO {po.code ?? `#${po.id}`}
                </DialogTitle>
                <DialogDescription>
                  Each pack row becomes its own lot. Split a line when the
                  supplier ships in mixed packaging — e.g. 4 drums + 1 sack.
                  The system creates one lot per row, each with its own
                  packaging and (optionally) its own supplier batch.
                </DialogDescription>
              </div>
              <CollabAvatars peers={presence} />
            </div>
          </DialogHeader>

          <fieldset
            disabled={!canEdit || !isCreator || pending}
            className="contents"
          >
            <div className="space-y-4">
              {error && (
                <ErrorBanner
                  detail={error.detail}
                  code={error.code}
                  debug={error.debug}
                />
              )}

              {canEdit && !isCreator && creator && (
                <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
                  <Lock className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    Only{" "}
                    <span className="font-medium text-foreground">
                      {creator.name}
                    </span>{" "}
                    can record this receipt. Your edits sync to them live.
                  </span>
                </div>
              )}

              {/* Compliance banner — quarantine is the default per
                  psp/CLAUDE.md. Operators trigger the Goods-In Inspection
                  to clear lots out of quarantine; there is no skip. */}
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                <p>
                  <strong>All packs land in quarantine.</strong> A goods-in
                  inspection on the lot detail page (QC approver signs)
                  clears the lot to available. For trusted low-risk vendors
                  a stock.qc holder can expedite release with an audited
                  reason — never the receiver.
                </p>
              </div>

              {/* Top-level fields — warehouse + default batch */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="warehouseId"
                    className="text-[11px] uppercase tracking-wider text-muted-foreground"
                  >
                    Warehouse *
                  </Label>
                  <div className="relative">
                    <Select value={warehouseId} onValueChange={setWarehouseId}>
                      <SelectTrigger
                        id="warehouseId"
                        className="h-9"
                        onFocus={() => focusField("warehouse_id")}
                        onBlur={() => blurField("warehouse_id")}
                      >
                        <SelectValue placeholder="Pick a warehouse…" />
                      </SelectTrigger>
                      <SelectContent>
                        {warehouses.map((w) => (
                          <SelectItem key={w.id} value={String(w.id)}>
                            {w.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldEditingIndicator
                      peer={fieldEditors.warehouse_id}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="batchDefault"
                    className="text-[11px] uppercase tracking-wider text-muted-foreground"
                  >
                    Supplier batch (default)
                  </Label>
                  <div className="relative">
                    <Input
                      id="batchDefault"
                      value={batchDefault}
                      onChange={(e) => setBatchDefault(e.target.value)}
                      onFocus={() => focusField("supplier_batch_no_default")}
                      onBlur={() => blurField("supplier_batch_no_default")}
                      placeholder="BA25123521 — applies to packs that don't override"
                      className="h-9 font-mono"
                    />
                    <FieldEditingIndicator
                      peer={fieldEditors.supplier_batch_no_default}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Packs inherit this unless they set their own batch in
                    &quot;More fields&quot;. Keeps mixed-batch receipts traceable.
                  </p>
                </div>
              </div>

              {/* Per-line sections with packs */}
              {eligibleLines.length === 0 ? (
                <p className="rounded-md border border-dashed border-border/60 px-4 py-6 text-center text-xs text-muted-foreground">
                  Nothing left to receive on this PO.
                </p>
              ) : (
                <div className="space-y-3">
                  {eligibleLines.map((l) => {
                    const ls = lines.find((x) => x.line_uuid === l.uuid)!;
                    const v = validity.find((x) => x.line_uuid === l.uuid)!;
                    return (
                      <LineSection
                        key={l.uuid}
                        poLine={l}
                        state={ls}
                        validity={v}
                        focusField={focusField}
                        blurField={blurField}
                        fieldEditors={fieldEditors}
                        onAddPack={() => addPack(l.uuid)}
                        onRemovePack={(tempId) => removePack(l.uuid, tempId)}
                        onPatchPack={(tempId, patch) =>
                          patchPack(l.uuid, tempId, patch)
                        }
                        onTogglePack={(tempId) => togglePack(l.uuid, tempId)}
                      />
                    );
                  })}
                </div>
              )}
            </div>

            <DialogFooter className="flex-col gap-2 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs text-muted-foreground">
                {totalReceiving > 0 && (
                  <>
                    Recording {totalReceiving} unit
                    {totalReceiving === 1 ? "" : "s"} across{" "}
                    {validity.reduce(
                      (acc, v) =>
                        acc +
                        (lines
                          .find((l) => l.line_uuid === v.line_uuid)
                          ?.packs.filter((p) => parseFloat(p.qty || "0") > 0)
                          .length ?? 0),
                      0,
                    )}{" "}
                    lot
                    {validity.reduce(
                      (acc, v) =>
                        acc +
                        (lines
                          .find((l) => l.line_uuid === v.line_uuid)
                          ?.packs.filter((p) => parseFloat(p.qty || "0") > 0)
                          .length ?? 0),
                      0,
                    ) === 1
                      ? ""
                      : "s"}
                    .
                  </>
                )}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={pending}
                  // Cancel is always available — leaving the dialog isn't
                  // a destructive action, it just closes our own view.
                  type="button"
                >
                  Cancel
                </Button>
                <Button
                  onClick={onSubmit}
                  disabled={!canSubmit}
                  type="button"
                  title={
                    isCreator
                      ? undefined
                      : creator
                        ? `Only ${creator.name} can record this receipt.`
                        : undefined
                  }
                >
                  {pending && (
                    <Loader2 className="mr-1.5 size-4 animate-spin" />
                  )}
                  Record receipt
                </Button>
              </div>
            </DialogFooter>
          </fieldset>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Per-line section — header, sum indicator, packs table, +Add pack
// ────────────────────────────────────────────────────────────────────────

function LineSection({
  poLine,
  state,
  validity,
  focusField,
  blurField,
  fieldEditors,
  onAddPack,
  onRemovePack,
  onPatchPack,
  onTogglePack,
}: {
  poLine: PurchaseOrder["lines"][number];
  state: LineState;
  validity: { sum: number; remaining: string; issues: string[] };
  focusField: (field: string) => void;
  blurField: (field: string) => void;
  fieldEditors: Record<
    string,
    import("@/lib/realtime/use-live-form").CollabPeer | null
  >;
  onAddPack: () => void;
  onRemovePack: (tempId: string) => void;
  onPatchPack: (tempId: string, patch: Partial<PackDraft>) => void;
  onTogglePack: (tempId: string) => void;
}) {
  const remaining = remainingOf(poLine);
  const overReceipt = validity.sum > Number(remaining) + 1e-9;
  const itemName = poLine.item?.name ?? `Item #${poLine.item_id}`;
  const itemCode = poLine.item?.code ?? null;

  return (
    <section className="rounded-lg border border-border/60 bg-card p-3 shadow-sm">
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{itemName}</p>
          {itemCode && (
            <p className="font-mono text-[10px] text-muted-foreground">
              {itemCode}
            </p>
          )}
        </div>
        <div className="flex items-baseline gap-3 text-xs">
          <span className="text-muted-foreground">Remaining</span>
          <span className="font-mono">{Number(remaining)}</span>
          <span className="text-muted-foreground">Sum</span>
          <span
            className={cn(
              "font-mono font-semibold",
              overReceipt && "text-destructive",
            )}
          >
            {validity.sum.toFixed(2).replace(/\.?0+$/, "")}
          </span>
        </div>
      </header>

      {overReceipt && (
        <p className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-destructive/[0.08] px-2 py-1 text-[11px] text-destructive">
          <AlertTriangle className="size-3" />
          Sum exceeds remaining — adjust pack quantities or remove a pack.
        </p>
      )}

      {state.packs.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/60 px-3 py-4 text-center text-[11px] text-muted-foreground">
          No packs — line will be skipped.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border/60">
          <table className="min-w-[820px] text-xs">
            <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="w-8 px-2 py-1.5 text-left">#</th>
                <th className="w-20 px-2 py-1.5 text-right">Qty</th>
                <th className="w-16 px-2 py-1.5 text-right">L (mm)</th>
                <th className="w-16 px-2 py-1.5 text-right">W (mm)</th>
                <th className="w-16 px-2 py-1.5 text-right">H (mm)</th>
                <th className="w-20 px-2 py-1.5 text-right">Wt/pack (kg)</th>
                <th className="w-14 px-2 py-1.5 text-right">U/pkg</th>
                <th className="w-12 px-2 py-1.5 text-right">Stk</th>
                <th className="w-12 px-2 py-1.5" />
                <th className="w-8 px-2 py-1.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {state.packs.map((p, i) => (
                <PackRows
                  key={p.tempId}
                  index={i}
                  pack={p}
                  focusField={focusField}
                  blurField={blurField}
                  fieldEditors={fieldEditors}
                  onPatch={(patch) => onPatchPack(p.tempId, patch)}
                  onRemove={() => onRemovePack(p.tempId)}
                  onToggle={() => onTogglePack(p.tempId)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-2 flex items-center justify-between">
        <Button type="button" size="sm" variant="outline" onClick={onAddPack}>
          <Plus className="mr-1.5 size-3.5" />
          Add pack
        </Button>
        <p className="text-[10px] text-muted-foreground">
          {state.packs.length === 0
            ? "Add a pack to receive against this line."
            : "Split into multiple packs when the supplier ships mixed."}
        </p>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────
// One pack row + collapsible "more fields" row
// ────────────────────────────────────────────────────────────────────────

function PackRows({
  index,
  pack,
  focusField,
  blurField,
  fieldEditors,
  onPatch,
  onRemove,
  onToggle,
}: {
  index: number;
  pack: PackDraft;
  focusField: (field: string) => void;
  blurField: (field: string) => void;
  fieldEditors: Record<
    string,
    import("@/lib/realtime/use-live-form").CollabPeer | null
  >;
  onPatch: (patch: Partial<PackDraft>) => void;
  onRemove: () => void;
  onToggle: () => void;
}) {
  const keyFor = (field: string) => `pack:${pack.tempId}:${field}`;
  return (
    <>
      <tr>
        <td className="px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
          {index + 1}
        </td>
        <td className="px-2 py-1.5">
          <div className="relative">
            <Input
              type="text"
              inputMode="decimal"
              value={pack.qty}
              onChange={(e) => onPatch({ qty: e.target.value })}
              onFocus={() => focusField(keyFor("qty"))}
              onBlur={() => blurField(keyFor("qty"))}
              aria-label={`Pack ${index + 1} quantity`}
              className="h-8 text-right font-mono text-xs"
            />
            <FieldEditingIndicator peer={fieldEditors[keyFor("qty")]} />
          </div>
        </td>
        <td className="px-2 py-1.5">
          <NumberInput
            value={pack.package_length_mm}
            onChange={(v) => onPatch({ package_length_mm: v })}
            onFocus={() => focusField(keyFor("package_length_mm"))}
            onBlur={() => blurField(keyFor("package_length_mm"))}
            editor={fieldEditors[keyFor("package_length_mm")]}
            label={`Pack ${index + 1} length mm`}
          />
        </td>
        <td className="px-2 py-1.5">
          <NumberInput
            value={pack.package_width_mm}
            onChange={(v) => onPatch({ package_width_mm: v })}
            onFocus={() => focusField(keyFor("package_width_mm"))}
            onBlur={() => blurField(keyFor("package_width_mm"))}
            editor={fieldEditors[keyFor("package_width_mm")]}
            label={`Pack ${index + 1} width mm`}
          />
        </td>
        <td className="px-2 py-1.5">
          <NumberInput
            value={pack.package_height_mm}
            onChange={(v) => onPatch({ package_height_mm: v })}
            onFocus={() => focusField(keyFor("package_height_mm"))}
            onBlur={() => blurField(keyFor("package_height_mm"))}
            editor={fieldEditors[keyFor("package_height_mm")]}
            label={`Pack ${index + 1} height mm`}
          />
        </td>
        <td className="px-2 py-1.5">
          <div className="relative">
            <Input
              type="text"
              inputMode="decimal"
              value={pack.package_weight_kg}
              onChange={(e) => onPatch({ package_weight_kg: e.target.value })}
              onFocus={() => focusField(keyFor("package_weight_kg"))}
              onBlur={() => blurField(keyFor("package_weight_kg"))}
              aria-label={`Pack ${index + 1} weight kg`}
              className="h-8 text-right font-mono text-xs"
            />
            <FieldEditingIndicator
              peer={fieldEditors[keyFor("package_weight_kg")]}
            />
          </div>
        </td>
        <td className="px-2 py-1.5">
          <NumberInput
            value={pack.units_per_package}
            onChange={(v) => onPatch({ units_per_package: v })}
            onFocus={() => focusField(keyFor("units_per_package"))}
            onBlur={() => blurField(keyFor("units_per_package"))}
            editor={fieldEditors[keyFor("units_per_package")]}
            label={`Pack ${index + 1} units per package`}
          />
        </td>
        <td className="px-2 py-1.5">
          <NumberInput
            value={pack.stack_factor}
            onChange={(v) => onPatch({ stack_factor: v })}
            onFocus={() => focusField(keyFor("stack_factor"))}
            onBlur={() => blurField(keyFor("stack_factor"))}
            editor={fieldEditors[keyFor("stack_factor")]}
            label={`Pack ${index + 1} stack factor`}
          />
        </td>
        <td className="px-1 py-1.5 text-center">
          <button
            type="button"
            onClick={onToggle}
            className={cn(
              "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground",
              pack.expanded && "text-foreground",
            )}
            aria-label={pack.expanded ? "Collapse details" : "Expand details"}
          >
            {pack.expanded ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            More
          </button>
        </td>
        <td className="px-2 py-1.5 text-right">
          <button
            type="button"
            onClick={onRemove}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
            aria-label={`Remove pack ${index + 1}`}
          >
            <Trash2 className="size-3.5" />
          </button>
        </td>
      </tr>
      {pack.expanded && (
        <tr>
          <td />
          <td colSpan={9} className="border-t border-dashed border-border/60 bg-muted/20 px-3 py-2">
            <div className="grid gap-2.5 sm:grid-cols-3">
              <FieldLabel label="Supplier batch (override)">
                <div className="relative">
                  <Input
                    value={pack.supplier_batch_no ?? ""}
                    onChange={(e) =>
                      onPatch({ supplier_batch_no: e.target.value })
                    }
                    onFocus={() => focusField(keyFor("supplier_batch_no"))}
                    onBlur={() => blurField(keyFor("supplier_batch_no"))}
                    placeholder="Inherit default"
                    className="h-8 font-mono text-xs"
                  />
                  <FieldEditingIndicator
                    peer={fieldEditors[keyFor("supplier_batch_no")]}
                  />
                </div>
              </FieldLabel>
              <FieldLabel label="Country of origin">
                <div
                  className="relative"
                  onFocus={() => focusField(keyFor("country_of_origin"))}
                  onBlur={() => blurField(keyFor("country_of_origin"))}
                >
                  <CountryPicker
                    value={pack.country_of_origin ?? ""}
                    onChange={(v) =>
                      onPatch({ country_of_origin: v ?? "" })
                    }
                    compact
                  />
                  <FieldEditingIndicator
                    peer={fieldEditors[keyFor("country_of_origin")]}
                  />
                </div>
              </FieldLabel>
              <FieldLabel label="Revision">
                <div className="relative">
                  <Input
                    value={pack.revision ?? ""}
                    onChange={(e) => onPatch({ revision: e.target.value })}
                    onFocus={() => focusField(keyFor("revision"))}
                    onBlur={() => blurField(keyFor("revision"))}
                    placeholder="V01"
                    className="h-8 font-mono text-xs"
                  />
                  <FieldEditingIndicator
                    peer={fieldEditors[keyFor("revision")]}
                  />
                </div>
              </FieldLabel>
              <FieldLabel label="Manufactured">
                <div className="relative">
                  <Input
                    type="date"
                    value={pack.manufactured_at ?? ""}
                    onChange={(e) =>
                      onPatch({ manufactured_at: e.target.value })
                    }
                    onFocus={() => focusField(keyFor("manufactured_at"))}
                    onBlur={() => blurField(keyFor("manufactured_at"))}
                    className="h-8 text-xs"
                  />
                  <FieldEditingIndicator
                    peer={fieldEditors[keyFor("manufactured_at")]}
                  />
                </div>
              </FieldLabel>
              <FieldLabel label="Expiry">
                <div className="relative">
                  <Input
                    type="date"
                    value={pack.expiry_at ?? ""}
                    onChange={(e) => onPatch({ expiry_at: e.target.value })}
                    onFocus={() => focusField(keyFor("expiry_at"))}
                    onBlur={() => blurField(keyFor("expiry_at"))}
                    className="h-8 text-xs"
                  />
                  <FieldEditingIndicator
                    peer={fieldEditors[keyFor("expiry_at")]}
                  />
                </div>
              </FieldLabel>
              {/* Quarantine routing is server-side mandatory per
                  psp/CLAUDE.md — receivers don't get a skip switch.
                  Slot intentionally left blank to keep the 3-col grid. */}
              <div className="hidden sm:block" />
            </div>

            {/* Live 3D pack preview — mirrors the goods-in wizard so
                the receiver can sanity-check the dimensions they
                typed before the lot moves on to QC. */}
            <div className="mt-3">
              <PackBoxPreview
                lengthMm={Number(pack.package_length_mm) || 0}
                widthMm={Number(pack.package_width_mm) || 0}
                heightMm={Number(pack.package_height_mm) || 0}
                stack={Number(pack.stack_factor) || 1}
              />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function NumberInput({
  value,
  onChange,
  onFocus,
  onBlur,
  editor,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  editor?: import("@/lib/realtime/use-live-form").CollabPeer | null;
  label: string;
}) {
  return (
    <div className="relative">
      <Input
        type="text"
        inputMode="numeric"
        value={String(value || "")}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) ? n : 0);
        }}
        onFocus={onFocus}
        onBlur={onBlur}
        aria-label={label}
        className="h-8 text-right font-mono text-xs"
      />
      {editor !== undefined && (
        <FieldEditingIndicator peer={editor ?? null} />
      )}
    </div>
  );
}

function FieldLabel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

function makeDefaultPack(qty: string): PackDraft {
  return {
    tempId: crypto.randomUUID(),
    qty,
    package_length_mm: 400,
    package_width_mm: 300,
    package_height_mm: 250,
    package_weight_kg: "25.000",
    units_per_package: 1,
    stack_factor: 1,
    supplier_batch_no: null,
    manufactured_at: null,
    expiry_at: null,
    country_of_origin: null,
    revision: null,
    route_to_quarantine: false,
    expanded: false,
  };
}

function remainingOf(line: PurchaseOrder["lines"][number]): string {
  const r = Number(line.qty_ordered) - Number(line.qty_received || 0);
  return String(r > 0 ? r : 0);
}

function isPositive(v: string | number | null | undefined): boolean {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function countTotalPacks(
  lines: Array<{ packs: ReceivePOPack[] }>,
): number {
  return lines.reduce((acc, l) => acc + l.packs.length, 0);
}

function JoinErrorCard({
  error,
}: {
  error: import("@/lib/realtime/use-live-form").JoinError;
}) {
  const config = {
    form_full: {
      icon: AlertCircle,
      tone: "amber" as const,
      title: `Receive room at capacity`,
      detail: error.limit
        ? `Up to ${error.limit} people can record this receipt at once. Wait for someone to leave, then refresh.`
        : "Wait for someone to leave, then refresh.",
    },
    forbidden: {
      icon: LockKeyhole,
      tone: "muted" as const,
      title: "You can't record receipts here",
      detail:
        "Ask an admin for the `procurement.po_receive` permission to join this receive flow.",
    },
    bad_topic: {
      icon: AlertCircle,
      tone: "destructive" as const,
      title: "Unknown receive",
      detail:
        "We couldn't find this receive room. The link may have been malformed.",
    },
    unknown: {
      icon: AlertCircle,
      tone: "destructive" as const,
      title: "Couldn't open the receive flow",
      detail: "Something went wrong on our end. Please try again.",
    },
  }[error.reason];

  const Icon = config.icon;
  const toneClass =
    config.tone === "amber"
      ? "border-amber-500/30 bg-amber-50/40 dark:bg-amber-950/20"
      : config.tone === "destructive"
        ? "border-destructive/30 bg-destructive/[0.03]"
        : "border-border/60 bg-muted/30";
  const iconClass =
    config.tone === "amber"
      ? "text-amber-600 dark:text-amber-400"
      : config.tone === "destructive"
        ? "text-destructive"
        : "text-muted-foreground";

  return (
    <Card className={cn("border", toneClass)}>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-background">
          <Icon className={cn("size-6", iconClass)} />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold">{config.title}</p>
          <p className="text-xs text-muted-foreground">{config.detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}
