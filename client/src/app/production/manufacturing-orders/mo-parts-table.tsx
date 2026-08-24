"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  Factory,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  formatCompanyMoney,
  formatCompanyNumber,
  formatCompanyDate,
  formatQtyHumanized,
} from "@/lib/format/company";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { releaseAllPartsAction } from "@/lib/production/actions";
import { invalidateAudit } from "@/lib/audit/invalidator";
import type { CompanyDefaults } from "@/lib/types";
import type {
  ManufacturingOrder,
  ManufacturingOrderBooking,
  ManufacturingOrderPart,
  ManufacturingOrderRelation,
} from "@/lib/production/types";
import { AddBookingDialog } from "./add-booking-dialog";
import { ReleaseBookingDialog } from "./release-booking-dialog";
import { BookAllDialog } from "./book-all-dialog";
import { AddSubMoDialog } from "./add-sub-mo-dialog";
import { ReleaseSubMoDialog } from "./release-sub-mo-dialog";
import {
  AddBomLineDialog,
  QtyOverrideDialog,
  RemoveLineDialog,
  useRevertOverride,
} from "./mo-bom-override-dialogs";

interface Props {
  mo: ManufacturingOrder;
  company: CompanyDefaults;
  canEdit: boolean;
}

/**
 * MRPEasy-style parts breakdown. Each BOM line is a master row
 * with the aggregated booked / consumed / cost; individual bookings
 * are sub-rows underneath. `+` on the master opens the
 * AddBookingDialog; the circular-arrow on a sub-row opens the
 * ReleaseBookingDialog.
 */
export function MOPartsTable({ mo, company, canEdit }: Props) {
  const router = useRouter();
  const [addingFor, setAddingFor] =
    useState<ManufacturingOrderPart | null>(null);
  const [releasing, setReleasing] = useState<{
    part: ManufacturingOrderPart;
    booking: ManufacturingOrderBooking;
  } | null>(null);
  const [addingSubMoFor, setAddingSubMoFor] =
    useState<ManufacturingOrderPart | null>(null);
  const [releasingSubMo, setReleasingSubMo] = useState<{
    part: ManufacturingOrderPart;
    child: ManufacturingOrderRelation;
  } | null>(null);
  const [bookAllOpen, setBookAllOpen] = useState(false);
  const [pendingAll, startTransitionAll] = useTransition();
  // Per-MO BOM override state — only wired when the MO is still in a
  // status the server accepts edits on (`draft` / `prepared`). Past
  // approval `mo.can_override_bom` flips to false and we hide every
  // affordance below.
  const [editingQtyFor, setEditingQtyFor] =
    useState<ManufacturingOrderPart | null>(null);
  const [removingLineFor, setRemovingLineFor] =
    useState<ManufacturingOrderPart | null>(null);
  const [addingBomLineOpen, setAddingBomLineOpen] = useState(false);
  const { revert: revertOverride, pending: revertPending } =
    useRevertOverride(mo);
  const overrideEditable = canEdit && mo.can_override_bom;

  if (mo.parts.length === 0) {
    return (
      <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
        <header className="mb-3">
          <h2 className="text-sm font-semibold tracking-tight">Parts</h2>
        </header>
        <p className="text-xs text-muted-foreground">
          The connected BOM doesn&apos;t have any parts yet.
        </p>
      </section>
    );
  }

  const hasAnyBookings = mo.parts.some((p) => p.bookings.length > 0);

  // Data-integrity guard: NPD's BOM push scales mg → the child
  // item's native unit via ``_UOM_MG_FACTOR`` keyed off the local
  // ``Item.unit`` field. Items pushed without a ``unit`` set fall
  // back to factor 1 (identity), so the qty rides through in mg
  // even when the operator meant kg / L. That's the failure mode
  // that turned a water line into "160,165" for a 10 L drink.
  // Surface it aggressively — a single missing UoM on the row is
  // enough to make every other number on the sheet suspicious.
  const missingUomCount = mo.parts.filter(
    (p) =>
      !(p.unit_of_measurement?.symbol ?? p.part?.stock_uom?.symbol ?? "").trim(),
  ).length;

  function onReleaseAll() {
    if (!canEdit) return;
    if (
      !window.confirm(
        "Release every active booking on this MO AND cancel sub-MOs still in draft / approved? In-progress and completed sub-MOs stay put.",
      )
    ) {
      return;
    }
    startTransitionAll(async () => {
      const res = await releaseAllPartsAction(mo.uuid);
      if (res.ok) {
        const parts: string[] = [];
        if (res.released > 0) {
          parts.push(
            `${res.released} booking${res.released === 1 ? "" : "s"} released`,
          );
        }
        if (res.cancelled_sub_mos > 0) {
          parts.push(
            `${res.cancelled_sub_mos} sub-MO${res.cancelled_sub_mos === 1 ? "" : "s"} cancelled`,
          );
        }
        toast.success(parts.length === 0 ? "Nothing to release." : parts.join(" · "));
        invalidateAudit("manufacturing_order", mo.id);
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight">Parts</h2>
        <p className="text-[11px] text-muted-foreground">
          {mo.bom?.code ?? "BOM"} — required for{" "}
          {formatCompanyNumber(mo.quantity, company)}{" "}
          {mo.item?.stock_uom?.symbol ?? "Each"}
        </p>
      </header>

      {missingUomCount > 0 ? (
        <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-800 dark:text-red-300">
          <p className="font-medium">
            {missingUomCount} row{missingUomCount === 1 ? "" : "s"} on this BOM
            {missingUomCount === 1 ? " has" : " have"} no unit of measurement.
          </p>
          <p className="mt-0.5 text-[11px] leading-snug">
            Quantities render with <span className="font-mono">?</span> where
            the UoM is missing. NPD&apos;s push cascade also falls back to
            treating them as raw mg — the numbers below may be off (mg
            interpreted when the recipe meant g or kg). Open each part on
            <span className="font-mono"> /production/items </span>and set
            its Stock UoM to fix.
          </p>
        </div>
      ) : null}

      {canEdit && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pendingAll}
            onClick={() => setBookAllOpen(true)}
          >
            <Plus className="size-3.5" />
            Book all parts
          </Button>
          {hasAnyBookings && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pendingAll}
              onClick={onReleaseAll}
              className="text-muted-foreground"
            >
              {pendingAll ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RotateCcw className="size-3.5" />
              )}
              Release all booked parts
            </Button>
          )}
          {overrideEditable && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setAddingBomLineOpen(true)}
              className="ml-auto"
              title="Inject a one-off component into this MO only"
            >
              <Plus className="size-3.5" />
              Add BOM line (this MO)
            </Button>
          )}
        </div>
      )}

      {mo.bom_overrides.length > 0 && (
        <BomOverridesBanner
          mo={mo}
          overrideEditable={overrideEditable}
          onRevert={(uuid) => revertOverride(uuid, "Override reverted.")}
          reverting={revertPending}
        />
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[64rem] text-xs">
          <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-left">Stock item</th>
              <th className="px-2 py-1.5 text-right">Required</th>
              <th className="px-2 py-1.5 text-right">Consumed</th>
              <th className="px-2 py-1.5 text-right">Booked</th>
              <th className="px-2 py-1.5 text-right">Unit cost</th>
              <th className="px-2 py-1.5 text-right">Total cost</th>
              <th className="px-2 py-1.5 text-left">Lot</th>
              <th className="px-2 py-1.5 text-left">Status</th>
              <th className="px-2 py-1.5 text-left">Sign-offs</th>
              <th className="px-2 py-1.5 text-left">Storage</th>
              <th className="px-2 py-1.5 text-left">Available from</th>
              <th className="w-10 px-2 py-1.5" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {mo.parts.map((p) => (
              <PartRows
                key={p.id}
                p={p}
                company={company}
                canEdit={canEdit}
                overrideEditable={overrideEditable}
                purchasingRequested={mo.purchasing_requested_at != null}
                onAdd={() => setAddingFor(p)}
                onRelease={(b) => setReleasing({ part: p, booking: b })}
                onAddSubMo={() => setAddingSubMoFor(p)}
                onReleaseSubMo={(child) =>
                  setReleasingSubMo({ part: p, child })
                }
                onEditQty={() => setEditingQtyFor(p)}
                onRemoveLine={() => setRemovingLineFor(p)}
                onRestore={(uuid) => revertOverride(uuid, "Line restored.")}
                revertPending={revertPending}
              />
            ))}
          </tbody>
        </table>
      </div>

      {addingFor && (
        <AddBookingDialog
          mo={mo}
          part={addingFor}
          company={company}
          open={Boolean(addingFor)}
          onOpenChange={(o) => !o && setAddingFor(null)}
        />
      )}

      {releasing && (
        <ReleaseBookingDialog
          mo={mo}
          part={releasing.part}
          booking={releasing.booking}
          company={company}
          open={Boolean(releasing)}
          onOpenChange={(o) => !o && setReleasing(null)}
        />
      )}

      {bookAllOpen && (
        <BookAllDialog
          mo={mo}
          open={bookAllOpen}
          onOpenChange={setBookAllOpen}
        />
      )}

      {addingSubMoFor && (
        <AddSubMoDialog
          mo={mo}
          part={addingSubMoFor}
          company={company}
          open={Boolean(addingSubMoFor)}
          onOpenChange={(o) => !o && setAddingSubMoFor(null)}
        />
      )}

      {releasingSubMo && (
        <ReleaseSubMoDialog
          mo={mo}
          part={releasingSubMo.part}
          child={releasingSubMo.child}
          company={company}
          open={Boolean(releasingSubMo)}
          onOpenChange={(o) => !o && setReleasingSubMo(null)}
        />
      )}

      {editingQtyFor && (
        <QtyOverrideDialog
          mo={mo}
          part={editingQtyFor}
          open={Boolean(editingQtyFor)}
          onOpenChange={(o) => !o && setEditingQtyFor(null)}
        />
      )}

      {removingLineFor && (
        <RemoveLineDialog
          mo={mo}
          part={removingLineFor}
          open={Boolean(removingLineFor)}
          onOpenChange={(o) => !o && setRemovingLineFor(null)}
        />
      )}

      {addingBomLineOpen && (
        <AddBomLineDialog
          mo={mo}
          open={addingBomLineOpen}
          onOpenChange={setAddingBomLineOpen}
        />
      )}
    </section>
  );
}

function BomOverridesBanner({
  mo,
  overrideEditable,
  onRevert,
  reverting,
}: {
  mo: ManufacturingOrder;
  overrideEditable: boolean;
  onRevert: (overrideUuid: string) => void;
  reverting: boolean;
}) {
  const count = mo.bom_overrides.length;
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-900 dark:text-amber-200">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">
          {count} BOM override{count === 1 ? "" : "s"} applied to this MO
        </p>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[11px] underline underline-offset-2 hover:text-amber-950 dark:hover:text-amber-100"
        >
          {expanded ? "Hide" : "See changes"}
        </button>
      </div>
      {expanded && (
        <ul className="mt-2 space-y-1">
          {mo.bom_overrides.map((ov) => (
            <li
              key={ov.uuid}
              className="flex items-center justify-between gap-3 border-t border-amber-500/30 pt-1 first:border-t-0 first:pt-0"
            >
              <div className="min-w-0 leading-snug">
                <p className="truncate">
                  <span className="font-medium">
                    {ov.part?.name ?? `Item #${ov.item_id ?? "?"}`}
                  </span>{" "}
                  <span className="text-[10px] uppercase tracking-wide">
                    {ov.action === "added"
                      ? "· added"
                      : ov.action === "removed"
                        ? "· removed"
                        : `· qty ${ov.from_qty ?? "?"} → ${ov.to_qty ?? "?"}`}
                  </span>
                </p>
                {ov.reason && (
                  <p className="mt-0.5 text-[11px] italic text-amber-900/80 dark:text-amber-200/80">
                    "{ov.reason}"
                  </p>
                )}
                {ov.created_by?.name && (
                  <p className="mt-0.5 text-[10px] text-amber-900/70 dark:text-amber-200/70">
                    {ov.created_by.name} ·{" "}
                    {new Date(ov.created_at).toLocaleString()}
                  </p>
                )}
              </div>
              {overrideEditable && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={reverting}
                  onClick={() => onRevert(ov.uuid)}
                  className="h-7 px-2 text-[11px] text-amber-900 hover:bg-amber-500/20 dark:text-amber-200"
                  title="Revert this override"
                >
                  <Undo2 className="size-3" />
                  Revert
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface PartRowsProps {
  p: ManufacturingOrderPart;
  company: CompanyDefaults;
  canEdit: boolean;
  /** True when the MO is in a status that accepts BOM-override edits
   *  AND the operator has permission. Drives visibility of the pencil
   *  / trash / restore controls on each row. */
  overrideEditable: boolean;
  /** True when the MO's purchasing_requested_at flag is set —
   *  drives "Sent to procurement" tone on the synthetic gap row
   *  even when coverage_status is "partial" (some bookings done,
   *  rest sent to procurement). */
  purchasingRequested: boolean;
  onAdd: () => void;
  onRelease: (b: ManufacturingOrderBooking) => void;
  onAddSubMo: () => void;
  onReleaseSubMo: (child: ManufacturingOrderRelation) => void;
  onEditQty: () => void;
  onRemoveLine: () => void;
  onRestore: (overrideUuid: string) => void;
  revertPending: boolean;
}

function PartRows({
  p,
  company,
  canEdit,
  overrideEditable,
  purchasingRequested,
  onAdd,
  onRelease,
  onAddSubMo,
  onReleaseSubMo,
  onEditQty,
  onRemoveLine,
  onRestore,
  revertPending,
}: PartRowsProps) {
  const isRemovedGhost = p.coverage_status === "removed";
  const isAddedLine = p.override?.action === "added";
  const isQtyChanged = p.override?.action === "qty_changed";
  const hasUnbooked = Number(p.unbooked_qty ?? "0") > 0;
  const hasBookings =
    p.bookings.length > 0 || p.pending_from_sub_mos.length > 0 || hasUnbooked;
  const [open, setOpen] = useState(hasBookings);
  // ``uomSymbol`` is the raw label (mg / g / kg / L / …). Falls back
  // to ``?`` when neither the BOM line nor the part carries a
  // ``stock_uom`` — that ambiguity is the reason NPD's push
  // conversion goes wrong (see #TBD): the local Item without a
  // ``unit`` field hits ``_UOM_MG_FACTOR`` default of 1 and the mg
  // rides through unchanged. Rendering ``?`` instead of a silent
  // blank surfaces the missing metadata to the operator so nobody
  // mistakes a bare number for a unit-implied one.
  const uomSymbol =
    p.unit_of_measurement?.symbol ?? p.part?.stock_uom?.symbol ?? "";
  const uom = uomSymbol || "?";
  const uomMissing = !uomSymbol;

  return (
    <>
      <tr
        className={cn(
          "border-y border-border/60 font-medium",
          isRemovedGhost
            ? "bg-muted/10 opacity-60"
            : isAddedLine
              ? "bg-emerald-500/5"
              : isQtyChanged
                ? "bg-amber-500/5"
                : "bg-muted/20",
        )}
      >
        <td className="px-2 py-2">
          <div className="flex items-center gap-1.5">
            {hasBookings ? (
              <button
                type="button"
                onClick={() => setOpen(!open)}
                className="rounded p-0.5 text-muted-foreground hover:bg-accent"
                aria-label={open ? "Collapse bookings" : "Expand bookings"}
              >
                {open ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronRight className="size-3.5" />
                )}
              </button>
            ) : (
              <span className="inline-block size-3.5" />
            )}
            <div className="min-w-0">
              <p
                className={cn(
                  "text-sm",
                  isRemovedGhost && "line-through decoration-muted-foreground/60",
                )}
              >
                {p.part?.name ?? `Item #${p.part?.id ?? "?"}`}
              </p>
              {p.part?.code && (
                <p className="font-mono text-[10px] text-muted-foreground">
                  {p.part.code}
                </p>
              )}
              {p.override && (
                <p className="mt-0.5 text-[10px] font-normal uppercase tracking-wide text-amber-800 dark:text-amber-300">
                  {p.override.action === "added"
                    ? "Added for this MO"
                    : p.override.action === "removed"
                      ? "Removed for this MO"
                      : `Qty modified · was ${p.override.from_qty ?? "?"}`}
                </p>
              )}
            </div>
          </div>
        </td>
        <td className="px-2 py-2 text-right font-mono">
          {(() => {
            if (!p.required_qty || isRemovedGhost) return "—";
            const h = formatQtyHumanized(p.required_qty, uom, company);
            return `${h.value} ${h.unit}`.trim();
          })()}
          {p.is_fixed && !isRemovedGhost && (
            <p className="text-[9px] text-muted-foreground">fixed</p>
          )}
        </td>
        <td className="px-2 py-2 text-right font-mono">
          {(() => {
            const src = p.consumed_qty || "0";
            const h = formatQtyHumanized(src, uom, company);
            return `${h.value} ${h.unit}`.trim();
          })()}
        </td>
        <td className="px-2 py-2 text-right font-mono">
          {(() => {
            const src = p.booked_qty || "0";
            const h = formatQtyHumanized(src, uom, company);
            return `${h.value} ${h.unit}`.trim();
          })()}
        </td>
        <td className="px-2 py-2 text-right font-mono">
          {p.unit_cost ? formatCompanyMoney(p.unit_cost, company) : "—"}
        </td>
        <td className="px-2 py-2 text-right font-mono">
          {p.total_cost ? formatCompanyMoney(p.total_cost, company) : "—"}
        </td>
        <td className="px-2 py-2 text-muted-foreground/60">—</td>
        <td className="px-2 py-2">
          <UnderBookedBadge p={p} />
        </td>
        <td className="px-2 py-2 text-muted-foreground/60">—</td>
        <td className="px-2 py-2 text-muted-foreground/60">—</td>
        <td className="px-2 py-2 text-muted-foreground/60">—</td>
        <td className="px-1 py-1 text-right">
          {isRemovedGhost && overrideEditable && p.override && (
            <div className="flex items-center justify-end gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={revertPending}
                onClick={() => onRestore(p.override!.uuid)}
                aria-label="Restore removed line"
                title="Restore removed line"
                className="text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/30"
              >
                <Undo2 />
              </Button>
            </div>
          )}
          {!isRemovedGhost && canEdit && (
            <div className="flex items-center justify-end gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={onAdd}
                aria-label="Book from stock"
                title="Book from stock"
              >
                <Plus />
              </Button>
              {p.part?.item_type === "semi_finished" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={onAddSubMo}
                  aria-label="Add a sub-MO"
                  title="Add a sub-MO"
                  className="text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700 dark:text-indigo-300 dark:hover:bg-indigo-950/30"
                >
                  <Factory />
                </Button>
              )}
              {overrideEditable && !isAddedLine && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={onEditQty}
                  aria-label="Override qty for this MO"
                  title="Override qty for this MO"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Pencil />
                </Button>
              )}
              {overrideEditable && !isAddedLine && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={onRemoveLine}
                  aria-label="Remove line from this MO"
                  title="Remove line from this MO"
                  className="text-destructive/70 hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 />
                </Button>
              )}
              {overrideEditable && p.override && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={revertPending}
                  onClick={() => onRestore(p.override!.uuid)}
                  aria-label="Revert this override"
                  title="Revert this override"
                  className="text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/30"
                >
                  <Undo2 />
                </Button>
              )}
            </div>
          )}
        </td>
      </tr>
      {open &&
        p.bookings.map((b) => (
          <BookingRow
            key={b.id}
            booking={b}
            uom={uom}
            unitCost={p.unit_cost}
            company={company}
            canEdit={canEdit}
            onRelease={() => onRelease(b)}
          />
        ))}
      {open && hasUnbooked && (
        <NotBookedRow
          part={p}
          uom={uom}
          unitCost={p.unit_cost}
          unbookedQty={p.unbooked_qty ?? "0"}
          company={company}
          canEdit={canEdit}
          purchasingRequested={purchasingRequested}
          onAddBooking={onAdd}
          onAddSubMo={onAddSubMo}
        />
      )}
      {open &&
        p.pending_from_sub_mos.map((child) => (
          <PendingSubMoRow
            key={`sub-${child.id}`}
            child={child}
            uom={uom}
            unitCost={p.unit_cost}
            company={company}
            canEdit={canEdit}
            onRelease={() => onReleaseSubMo(child)}
          />
        ))}
    </>
  );
}

const COVERAGE_STYLE: Record<
  ManufacturingOrderPart["coverage_status"],
  { text: string; label: string; dot: string }
> = {
  booked: {
    text: "text-emerald-700 dark:text-emerald-300",
    label: "Booked",
    dot: "bg-emerald-500",
  },
  sub_mo_in_progress: {
    text: "text-amber-800 dark:text-amber-300",
    label: "Sub-MO running",
    dot: "bg-amber-500 animate-pulse",
  },
  partial: {
    text: "text-amber-800 dark:text-amber-300",
    label: "Partial",
    dot: "bg-amber-500",
  },
  expecting: {
    text: "text-sky-700 dark:text-sky-300",
    label: "Expecting (PO out)",
    dot: "bg-sky-500",
  },
  awaiting_po: {
    text: "text-sky-700 dark:text-sky-300",
    label: "Sent to procurement",
    dot: "bg-sky-500",
  },
  not_booked: {
    text: "text-destructive",
    label: "Not booked",
    dot: "bg-destructive",
  },
  consumed: {
    text: "text-emerald-700 dark:text-emerald-300",
    label: "Consumed",
    dot: "bg-emerald-500",
  },
  consumed_short: {
    text: "text-muted-foreground",
    label: "Consumed (less than planned)",
    dot: "bg-muted-foreground",
  },
  consumed_none: {
    text: "text-muted-foreground/60",
    label: "Not consumed",
    dot: "bg-muted-foreground/40",
  },
  removed: {
    text: "text-muted-foreground/70",
    label: "Removed for this MO",
    dot: "bg-muted-foreground/40",
  },
  unknown: {
    text: "text-muted-foreground/60",
    label: "—",
    dot: "bg-muted-foreground/40",
  },
};

function UnderBookedBadge({ p }: { p: ManufacturingOrderPart }) {
  const style = COVERAGE_STYLE[p.coverage_status];
  return (
    <span className={cn("inline-flex items-center gap-1.5", style.text)}>
      <span className={cn("size-1.5 rounded-full", style.dot)} aria-hidden />
      {style.label}
    </span>
  );
}

interface BookingRowProps {
  booking: ManufacturingOrderBooking;
  uom: string;
  unitCost: string | null;
  company: CompanyDefaults;
  canEdit: boolean;
  onRelease: () => void;
}

function BookingRow({
  booking,
  uom,
  unitCost,
  company,
  canEdit,
  onRelease,
}: BookingRowProps) {
  const lineTotal =
    unitCost && booking.quantity
      ? String(Number(unitCost) * Number(booking.quantity))
      : null;

  return (
    <tr className="border-b border-border/40">
      <td className="px-2 py-1.5 pl-8 text-muted-foreground" />
      <td className="px-2 py-1.5 text-right" />
      <td className="px-2 py-1.5 text-right font-mono">
        {(() => {
          const h = formatQtyHumanized(
            booking.consumed_quantity || "0",
            uom,
            company,
          );
          return `${h.value} ${h.unit}`.trim();
        })()}
      </td>
      <td className="px-2 py-1.5 text-right font-mono">
        {(() => {
          const h = formatQtyHumanized(booking.quantity, uom, company);
          return `${h.value} ${h.unit}`.trim();
        })()}
      </td>
      <td className="px-2 py-1.5 text-right font-mono">
        {unitCost ? formatCompanyMoney(unitCost, company) : "—"}
      </td>
      <td className="px-2 py-1.5 text-right font-mono">
        {lineTotal ? formatCompanyMoney(lineTotal, company) : "—"}
      </td>
      <td className="px-2 py-1.5 font-mono">
        <div className="flex items-center gap-2">
          {/* Pickup photo — the picker snaps the sealed container at
              the shelf during confirm-transfer. Surfacing it here so
              the production team recognises the box on the trolley
              before starting the run. */}
          {booking.stock_lot?.last_photo_url && (
            <a
              href={booking.stock_lot.last_photo_url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0"
              title="Pickup photo — click to enlarge"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={booking.stock_lot.last_photo_url}
                alt={`Pickup photo of ${booking.stock_lot.code ?? "lot"}`}
                className="size-8 rounded object-cover ring-1 ring-border/60 transition hover:ring-brand/70"
              />
            </a>
          )}
          {booking.stock_lot?.uuid && booking.stock_lot?.code ? (
            <Link
              href={`/stock/lots/${booking.stock_lot.uuid}`}
              className="text-brand underline-offset-2 hover:underline"
            >
              {booking.stock_lot.code}
            </Link>
          ) : booking.purchase_order_line?.purchase_order?.uuid &&
            booking.purchase_order_line?.purchase_order?.code ? (
            <Link
              href={`/procurement/purchase-orders/${booking.purchase_order_line.purchase_order.uuid}`}
              className="text-brand underline-offset-2 hover:underline"
              title="Reserved against an in-flight purchase order"
            >
              ↺ {booking.purchase_order_line.purchase_order.code}
            </Link>
          ) : (
            "—"
          )}
        </div>
      </td>
      <td className="px-2 py-1.5">
        {booking.purchase_order_line_id != null ? (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300"
            title={
              booking.purchase_order_line?.expected_delivery_date
                ? `Arriving ${booking.purchase_order_line.expected_delivery_date}`
                : "Reserved against an in-flight PO"
            }
          >
            Expecting
          </span>
        ) : (
          <BookingStatusBadge status={booking.status} />
        )}
      </td>
      <td className="px-2 py-1.5">
        <BookingSignOffs booking={booking} company={company} />
      </td>
      <td className="px-2 py-1.5">
        {(() => {
          const cell = booking.storage_location;
          if (!cell) return "—";
          // Lead with the rack code (or location name) so the operator
          // can find the physical rack at a glance — "Level 0" alone
          // doesn't say WHERE. Suffix the cell label underneath.
          const rack =
            cell.storage_location?.code ??
            cell.storage_location?.name ??
            null;
          const shelf =
            cell.name ??
            (cell.ordinal !== null && cell.ordinal !== undefined
              ? `Level ${cell.ordinal + 1}`
              : null);
          if (rack && shelf) {
            return (
              <div className="leading-tight">
                <div className="font-mono text-[11px]">{rack}</div>
                <div className="text-[10px] text-muted-foreground">
                  {shelf}
                </div>
              </div>
            );
          }
          return rack ?? shelf ?? "—";
        })()}
      </td>
      <td className="px-2 py-1.5">
        {booking.stock_lot?.available_from
          ? formatCompanyDate(booking.stock_lot.available_from, company)
          : booking.stock_lot?.expiry_at
            ? formatCompanyDate(booking.stock_lot.expiry_at, company)
            : "—"}
      </td>
      <td className="px-1 py-1 text-right">
        {canEdit && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onRelease}
            aria-label="Release this booking"
            title="Release this booking"
          >
            <RotateCcw />
          </Button>
        )}
      </td>
    </tr>
  );
}

const BOOKING_STATUS: Record<
  ManufacturingOrderBooking["status"],
  { text: string; bg: string; dot: string; label: string }
> = {
  requested: {
    text: "text-emerald-700 dark:text-emerald-300",
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    dot: "bg-emerald-500",
    label: "Booked",
  },
  consumed: {
    text: "text-indigo-700 dark:text-indigo-300",
    bg: "bg-indigo-50 dark:bg-indigo-950/30",
    dot: "bg-indigo-500",
    label: "Consumed",
  },
  cancelled: {
    text: "text-muted-foreground",
    bg: "bg-muted/60",
    dot: "bg-muted-foreground/40",
    label: "Released",
  },
};

function BookingStatusBadge({
  status,
}: {
  status: ManufacturingOrderBooking["status"];
}) {
  const s = BOOKING_STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ring-border/40",
        s.bg,
        s.text,
      )}
    >
      <span className={cn("size-1.5 rounded-full", s.dot)} aria-hidden />
      {s.label}
    </span>
  );
}

/** Three-step traceability for the booking lifecycle: warehouse
 *  picker (picked_at), production operator pre-production check
 *  (received_at), production operator closeout (consumed_at). Each
 *  stamp shows actor + date so the room sees who confirmed what
 *  without leaving the page. Empty when no stamp set. */
function BookingSignOffs({
  booking,
  company,
}: {
  booking: ManufacturingOrderBooking;
  company: CompanyDefaults;
}) {
  const stamps: Array<{
    label: string;
    at: string | null;
    by: { name: string } | null;
  }> = [
    {
      label: "Picked",
      at: booking.picked_at,
      by: booking.picked_by ?? null,
    },
    {
      label: "Confirmed",
      at: booking.received_at,
      by: booking.received_by ?? null,
    },
    {
      label: "Consumed",
      at: booking.consumed_at ?? null,
      by: booking.consumed_by ?? null,
    },
  ];

  const filled = stamps.filter((s) => s.at);
  if (filled.length === 0) {
    return <span className="text-muted-foreground/60">—</span>;
  }

  return (
    <div className="space-y-0.5 text-[10px] leading-tight">
      {filled.map((s) => (
        <div key={s.label}>
          <span className="font-medium text-foreground">{s.label}</span>{" "}
          <span className="text-muted-foreground">
            by {s.by?.name ?? "—"} ·{" "}
            {s.at ? formatCompanyDate(s.at, company) : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

interface NotBookedRowProps {
  part: ManufacturingOrderPart;
  uom: string;
  unitCost: string | null;
  unbookedQty: string;
  company: CompanyDefaults;
  canEdit: boolean;
  /** Tones the gap row sky-blue ("Sent to procurement") instead of
   *  red ("Not booked") when the MO has hit Request purchases.
   *  Independent of coverage_status because a partial line + open
   *  request still wants the friendly tone on the shortfall. */
  purchasingRequested: boolean;
  onAddBooking: () => void;
  onAddSubMo: () => void;
}

/**
 * MRPEasy-style "still missing" sub-row. Surfaces the gap (and its
 * £ value) as its own line so the operator sees exactly how much
 * coverage is short. Quick-action buttons let them resolve the gap
 * inline by either booking more stock or spawning another sub-MO.
 */
function NotBookedRow({
  part,
  uom,
  unitCost,
  unbookedQty,
  company,
  canEdit,
  purchasingRequested,
  onAddBooking,
  onAddSubMo,
}: NotBookedRowProps) {
  const lineTotal =
    unitCost && unbookedQty
      ? String(Number(unitCost) * Number(unbookedQty))
      : null;

  // Tone the gap row sky-blue ("Sent to procurement") instead of
  // red ("Not booked") whenever the MO has had Request purchases
  // fired — covers both no-bookings-at-all (coverage_status =
  // "awaiting_po") and partial-coverage rows where the shortfall
  // has been handed to procurement.
  const awaiting = purchasingRequested;
  const rowTint = awaiting ? "bg-sky-50/40" : "bg-destructive/[0.04]";
  const qtyTone = awaiting ? "text-sky-700 dark:text-sky-300" : "text-destructive";

  return (
    <tr className={cn("border-b border-border/40", rowTint)}>
      <td className="px-2 py-1.5 pl-8 text-xs text-muted-foreground" />
      <td className="px-2 py-1.5 text-right" />
      <td className="px-2 py-1.5 text-right font-mono text-muted-foreground/60">
        —
      </td>
      <td className={cn("px-2 py-1.5 text-right font-mono", qtyTone)}>
        {(() => {
          const h = formatQtyHumanized(unbookedQty, uom, company);
          return `${h.value} ${h.unit}`.trim();
        })()}
      </td>
      <td className="px-2 py-1.5 text-right font-mono">
        {unitCost ? formatCompanyMoney(unitCost, company) : "—"}
      </td>
      <td className={cn("px-2 py-1.5 text-right font-mono", qtyTone)}>
        {lineTotal ? formatCompanyMoney(lineTotal, company) : "—"}
      </td>
      <td className="px-2 py-1.5 text-muted-foreground/60">—</td>
      <td className="px-2 py-1.5">
        {awaiting ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-700 ring-1 ring-inset ring-sky-300 dark:text-sky-300 dark:ring-sky-700">
            <span className="size-1.5 rounded-full bg-sky-500" aria-hidden />
            Sent to procurement
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive ring-1 ring-inset ring-destructive/30">
            <span className="size-1.5 rounded-full bg-destructive" aria-hidden />
            Not booked
          </span>
        )}
      </td>
      <td className="px-2 py-1.5 text-muted-foreground/60">—</td>
      <td className="px-2 py-1.5 text-muted-foreground/60">—</td>
      <td className="px-2 py-1.5 text-muted-foreground/60">—</td>
      <td className="px-1 py-1 text-right">
        {canEdit && (
          <div className="flex items-center justify-end gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={onAddBooking}
              aria-label="Book from stock"
              title="Book from stock"
            >
              <Plus />
            </Button>
            {part.part?.item_type === "semi_finished" && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={onAddSubMo}
                aria-label="Add a sub-MO"
                title="Add a sub-MO"
                className="text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700 dark:text-indigo-300 dark:hover:bg-indigo-950/30"
              >
                <Factory />
              </Button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

interface PendingSubMoRowProps {
  child: ManufacturingOrderRelation;
  uom: string;
  unitCost: string | null;
  company: CompanyDefaults;
  canEdit: boolean;
  onRelease: () => void;
}

function PendingSubMoRow({
  child,
  uom,
  unitCost,
  company,
  canEdit,
  onRelease,
}: PendingSubMoRowProps) {
  const lineTotal =
    unitCost && child.quantity
      ? String(Number(unitCost) * Number(child.quantity))
      : null;

  return (
    <tr className="border-b border-border/40 bg-amber-50/30 dark:bg-amber-950/10">
      <td className="px-2 py-1.5 pl-8">
        <Link
          href={`/production/manufacturing-orders/${child.uuid}`}
          className="inline-flex items-center gap-1.5 text-xs text-amber-800 hover:underline dark:text-amber-300"
        >
          <Factory className="size-3" />
          From {child.code ?? `MO #${child.id}`}
        </Link>
      </td>
      <td className="px-2 py-1.5 text-right" />
      <td className="px-2 py-1.5 text-right font-mono">
        {(() => {
          const h = formatQtyHumanized("0", uom, company);
          return `${h.value} ${h.unit}`.trim();
        })()}
      </td>
      <td className="px-2 py-1.5 text-right font-mono text-amber-800 dark:text-amber-300">
        {(() => {
          const h = formatQtyHumanized(child.quantity, uom, company);
          return `${h.value} ${h.unit}`.trim();
        })()}
      </td>
      <td className="px-2 py-1.5 text-right font-mono">
        {unitCost ? formatCompanyMoney(unitCost, company) : "—"}
      </td>
      <td className="px-2 py-1.5 text-right font-mono">
        {lineTotal ? formatCompanyMoney(lineTotal, company) : "—"}
      </td>
      <td className="px-2 py-1.5 font-mono text-muted-foreground/70">
        (sub-MO)
      </td>
      <td className="px-2 py-1.5">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/50",
          )}
        >
          <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" aria-hidden />
          Awaiting production
        </span>
      </td>
      <td className="px-2 py-1.5 text-muted-foreground/60">—</td>
      <td className="px-2 py-1.5 text-muted-foreground/60">—</td>
      <td className="px-2 py-1.5 text-muted-foreground/60">—</td>
      <td className="px-1 py-1 text-right">
        {canEdit && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onRelease}
            aria-label="Release / adjust sub-MO"
            title="Release or adjust this sub-MO"
          >
            <RotateCcw />
          </Button>
        )}
      </td>
    </tr>
  );
}
