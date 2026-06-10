"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Info, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorBanner } from "@/components/forms/error-banner";
import { CellPicker } from "@/components/forms/cell-picker";
import {
  createManualLotAction,
  type ManualLotInput,
} from "@/lib/stock/actions";
import type {
  ComplianceState,
  Item,
  StockCellPickerRow,
  Warehouse,
} from "@/lib/types";
import type { ErrorResult } from "@/lib/errors/server";
import { clientId } from "@/lib/utils";

interface ReceiveFormProps {
  items: Item[];
  warehouses: Warehouse[];
}

const COMPLIANCE_OPTIONS: { value: ComplianceState; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "requested", label: "Requested" },
  { value: "received", label: "Received" },
  { value: "accepted", label: "Accepted" },
  { value: "rejected", label: "Rejected" },
  { value: "na", label: "N/A" },
];

const RISK_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
] as const;

type FieldErrors = Record<string, string[]>;

/**
 * Receive a new lot. Lays out fields in collapsible groups so the
 * required basics (item + qty + cell) are above the fold and the
 * compliance/provenance metadata sits below. On success: redirect
 * back to /stock/lots with a fresh list.
 */
export function ReceiveForm({ items, warehouses }: ReceiveFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // Required
  const [itemId, setItemId] = useState<string>("");
  // Multi-row placements — each row a destination cell + qty. The
  // lot's total qty_received is the sum. `cellRow` is the resolved
  // breadcrumb the CellPicker returned, kept around so the trigger
  // button still shows the selection even after the picker closes.
  const [rows, setRows] = useState<
    Array<{
      id: string;
      cellId: string;
      cellRow: StockCellPickerRow | null;
      qty: string;
    }>
  >([{ id: clientId(), cellId: "", cellRow: null, qty: "" }]);

  // Cell filters — passed through to the CellPicker so the server
  // narrows results before they ever hit the wire.
  const [siteId, setSiteId] = useState<string>(""); // warehouse filter
  // Tag filter: when the item declares storage_tags, the server
  // hides cells whose effective_tags don't satisfy them. The
  // operator can flip it off for exceptional placements (returns
  // into the wrong-but-only-available cell, etc.).
  const [matchTags, setMatchTags] = useState(true);

  // Optional
  const [unitCost, setUnitCost] = useState("");
  const [currency, setCurrency] = useState("GBP");
  const [supplierBatch, setSupplierBatch] = useState("");
  const [country, setCountry] = useState("");
  const [revision, setRevision] = useState("");
  const [manufactured, setManufactured] = useState("");
  const [expiry, setExpiry] = useState("");
  const [availableFrom, setAvailableFrom] = useState("");
  const [risk, setRisk] = useState<string>("");
  const [allergenStatus, setAllergenStatus] = useState<string>("");
  const [coaStatus, setCoaStatus] = useState<string>("");
  const [qualityStatus, setQualityStatus] = useState<string>("");
  const [notes, setNotes] = useState("");

  const itemById = useMemo(
    () => new Map(items.map((i) => [String(i.id), i])),
    [items],
  );

  const selectedItem = itemId ? itemById.get(itemId) : undefined;
  const uomSymbol = selectedItem?.stock_uom?.symbol ?? "—";
  const uomId = selectedItem?.stock_uom?.id ?? null;
  const itemTags = selectedItem?.storage_tags ?? [];

  // Live total — formatted with the item's UoM symbol.
  const totalQty = useMemo(() => {
    return rows.reduce((acc, r) => {
      const n = Number(r.qty);
      return Number.isFinite(n) && n > 0 ? acc + n : acc;
    }, 0);
  }, [rows]);

  const validRows = rows.filter(
    (r) => r.cellId && Number(r.qty) > 0,
  );

  const canSubmit =
    !!itemId && !!uomId && validRows.length > 0 && !pending;

  function updateRow(
    id: string,
    patch: Partial<{ cellId: string; cellRow: StockCellPickerRow | null; qty: string }>,
  ) {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
  }
  function addRow() {
    setRows((prev) => [
      ...prev,
      { id: clientId(), cellId: "", cellRow: null, qty: "" },
    ]);
  }
  function removeRow(id: string) {
    setRows((prev) =>
      prev.length === 1 ? prev : prev.filter((r) => r.id !== id),
    );
  }

  function clearFieldError(field: string) {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setActionError(null);
    setFieldErrors({});

    const input: ManualLotInput = {
      item_id: Number(itemId),
      unit_of_measurement_id: uomId!,
      placements: validRows.map((r) => ({
        cell_id: Number(r.cellId),
        qty: r.qty,
      })),
      unit_cost: unitCost || null,
      currency: unitCost ? currency : null,
      supplier_batch_no: supplierBatch || null,
      country_of_origin: country || null,
      revision: revision || null,
      manufactured_at: manufactured || null,
      expiry_at: expiry || null,
      available_from: availableFrom ? new Date(availableFrom).toISOString() : null,
      overall_risk: (risk as "low" | "medium" | "high") || null,
      allergen_status: (allergenStatus as ComplianceState) || null,
      coa_status: (coaStatus as ComplianceState) || null,
      quality_status: (qualityStatus as ComplianceState) || null,
      notes: notes || null,
    };

    startTransition(async () => {
      const res = await createManualLotAction(input);
      if (!res.ok) {
        setActionError(res);
        // Pull field-level errors out of the structured `debug` blob
        // (Errors.changeset_fields shape) for inline highlighting.
        const debug = (res.debug as { fields?: FieldErrors } | undefined)?.fields;
        if (debug) setFieldErrors(debug);
        return;
      }
      router.push("/stock/lots");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {actionError && (
        <ErrorBanner
          detail={actionError.detail}
          code={actionError.code}
          debug={actionError.debug}
        />
      )}

      <fieldset disabled={pending} className="space-y-6">
        {/* Item & timing */}
        <section className="space-y-4 rounded-lg border border-border/60 bg-card p-4">
          <header className="space-y-0.5">
            <h2 className="text-sm font-semibold tracking-tight">
              Item & timing
            </h2>
            <p className="text-xs text-muted-foreground">
              What landed and when it becomes usable.
            </p>
          </header>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Item" required error={fieldErrors.item_id}>
              <Select
                value={itemId}
                onValueChange={(v) => {
                  setItemId(v);
                  clearFieldError("item_id");
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Pick an item…" />
                </SelectTrigger>
                <SelectContent>
                  {items.map((i) => (
                    <SelectItem key={i.id} value={String(i.id)}>
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {i.code ?? i.external_sku ?? `#${i.id}`}
                        </span>
                        <span className="font-medium">{i.name}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedItem && !selectedItem.stock_uom && (
                <p className="text-[11px] text-destructive">
                  This item has no stock UoM set — go to{" "}
                  <a
                    className="underline"
                    href={`/settings/items/${selectedItem.uuid}`}
                  >
                    its edit page
                  </a>{" "}
                  and pick one first.
                </p>
              )}
              {selectedItem && itemTags.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Storage tags:{" "}
                  {itemTags.map((t) => (
                    <span
                      key={t}
                      className="ml-1 inline-flex items-center rounded-full bg-foreground/10 px-1.5 py-0.5 font-mono text-[10px]"
                    >
                      {t}
                    </span>
                  ))}
                </p>
              )}
            </Field>

            <Field label="Available from">
              <Input
                type="datetime-local"
                value={availableFrom}
                onChange={(e) => setAvailableFrom(e.target.value)}
                className="h-9"
              />
              <p className="text-[11px] text-muted-foreground">
                Defaults to now. Future-date for a lot that hasn&apos;t
                physically landed yet — status will read as Requested
                until this passes.
              </p>
            </Field>
          </div>
        </section>

        {/* Storage placements */}
        <section className="space-y-4 rounded-lg border border-border/60 bg-card p-4">
          <header className="space-y-1">
            <h2 className="text-sm font-semibold tracking-tight">
              Storage placements
            </h2>
            <p className="text-xs text-muted-foreground">
              Where the lot lives. Split across multiple cells if the
              batch landed in more than one place — each row gets its
              own receive movement.
            </p>
          </header>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Field label="Site">
              <Select
                value={siteId}
                onValueChange={(v) => setSiteId(v === "__all__" ? "" : v)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="All sites" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All sites</SelectItem>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={String(w.id)}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {itemTags.length > 0 && (
              <label className="flex cursor-pointer items-end gap-2 self-end pb-2 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={matchTags}
                  onChange={(e) => setMatchTags(e.target.checked)}
                  className="size-3.5 accent-primary"
                />
                <span>
                  Only cells matching{" "}
                  <span className="font-mono text-foreground">
                    {itemTags.join(", ")}
                  </span>
                </span>
              </label>
            )}
          </div>

          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_140px_36px] gap-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <span>Cell</span>
              <span>Quantity</span>
              <span></span>
            </div>
            {rows.map((row, idx) => (
              <div
                key={row.id}
                className="grid grid-cols-[1fr_140px_36px] gap-2"
              >
                <CellPicker
                  value={row.cellId}
                  selected={row.cellRow}
                  warehouseId={siteId ? Number(siteId) : null}
                  itemId={itemId ? Number(itemId) : null}
                  matchTags={matchTags}
                  placeholder={`Pick cell #${idx + 1}…`}
                  onChange={(cellId, cellRow) =>
                    updateRow(row.id, { cellId, cellRow })
                  }
                />

                <div className="flex items-stretch gap-1">
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={row.qty}
                    onChange={(e) =>
                      updateRow(row.id, { qty: e.target.value })
                    }
                    placeholder="qty"
                    className="h-9 font-mono"
                  />
                  <span className="inline-flex items-center rounded-md border border-border/60 bg-muted px-2 text-[10px] font-medium text-muted-foreground">
                    {uomSymbol}
                  </span>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={rows.length === 1}
                  onClick={() => removeRow(row.id)}
                  className="size-9 text-muted-foreground hover:text-destructive"
                  aria-label={`Remove placement ${idx + 1}`}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}

            <div className="flex items-center justify-between gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addRow}
                className="h-8"
              >
                <Plus className="mr-1.5 size-3.5" />
                Add another cell
              </Button>
              <p className="text-xs text-muted-foreground">
                Total:{" "}
                <span className="font-mono font-semibold text-foreground">
                  {totalQty || 0}
                </span>{" "}
                {uomSymbol}
              </p>
            </div>
          </div>
        </section>

        {/* Provenance — supplier batch + origin + revision. Source
            here is always "manual" (operator-authored); real PO
            receives land later from the procurement module. */}
        <section className="space-y-4 rounded-lg border border-border/60 bg-card p-4">
          <header className="space-y-1.5">
            <h2 className="text-sm font-semibold tracking-tight">Provenance</h2>
            <div className="flex items-start gap-2 rounded-md border border-primary/20 bg-primary/[0.04] px-3 py-2 text-[11px] text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <span>
                Source is recorded as <strong>Manually created</strong>{" "}
                by you, right now. Real receives against a Purchase Order
                will come from the Procurement module once it ships.
              </span>
            </div>
          </header>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Supplier batch no.">
              <Input
                value={supplierBatch}
                onChange={(e) => setSupplierBatch(e.target.value)}
                placeholder="What the supplier called it"
                className="h-9 font-mono"
              />
            </Field>
            <Field label="Country of origin">
              <Input
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="e.g. IT"
                className="h-9"
              />
            </Field>
            <Field label="Revision">
              <Input
                value={revision}
                onChange={(e) => setRevision(e.target.value)}
                placeholder="e.g. V00"
                className="h-9 font-mono"
              />
            </Field>
          </div>
        </section>

        {/* Cost */}
        <section className="space-y-4 rounded-lg border border-border/60 bg-card p-4">
          <header className="space-y-0.5">
            <h2 className="text-sm font-semibold tracking-tight">Cost</h2>
            <p className="text-xs text-muted-foreground">
              Per-lot cost stays accurate even if supplier prices
              change later — every rollup uses this lot&apos;s number.
            </p>
          </header>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Unit cost">
              <Input
                type="text"
                inputMode="decimal"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                placeholder="e.g. 5.15"
                className="h-9 font-mono"
              />
            </Field>
            <Field label="Currency">
              <Input
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                maxLength={3}
                placeholder="GBP"
                className="h-9 w-24 font-mono uppercase"
              />
            </Field>
          </div>
        </section>

        {/* Compliance */}
        <section className="space-y-4 rounded-lg border border-border/60 bg-card p-4">
          <header className="space-y-0.5">
            <h2 className="text-sm font-semibold tracking-tight">Compliance</h2>
            <p className="text-xs text-muted-foreground">
              Initial QC state. Each is independent — you can have CoA
              accepted but quality still pending.
            </p>
          </header>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Overall risk">
              <Select value={risk} onValueChange={setRisk}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {RISK_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Allergen status">
              <Select value={allergenStatus} onValueChange={setAllergenStatus}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {COMPLIANCE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="CoA status">
              <Select value={coaStatus} onValueChange={setCoaStatus}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {COMPLIANCE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Quality status">
              <Select value={qualityStatus} onValueChange={setQualityStatus}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {COMPLIANCE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </section>

        {/* Dates */}
        <section className="space-y-4 rounded-lg border border-border/60 bg-card p-4">
          <header className="space-y-0.5">
            <h2 className="text-sm font-semibold tracking-tight">Dates</h2>
            <p className="text-xs text-muted-foreground">
              Expiry drives the FEFO allocation order and the expiring-
              soon queue. Manufactured / Available-from are optional.
            </p>
          </header>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Manufactured at">
              <Input
                type="date"
                value={manufactured}
                onChange={(e) => setManufactured(e.target.value)}
                className="h-9"
              />
            </Field>
            <Field label="Expiry date">
              <Input
                type="date"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                className="h-9"
              />
            </Field>
          </div>
        </section>

        {/* Notes */}
        <section className="space-y-2 rounded-lg border border-border/60 bg-card p-4">
          <Field label="Notes">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Anything worth recording about this batch — supplier hiccups, deviations, …"
            />
          </Field>
        </section>
      </fieldset>

      <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-4">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push("/stock/lots")}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {pending ? (
            <Loader2 className="mr-1.5 size-4 animate-spin" />
          ) : (
            <Save className="mr-1.5 size-4" />
          )}
          Create lot
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {error && error.length > 0 && (
        <p className="text-[11px] text-destructive">{error.join(" · ")}</p>
      )}
    </div>
  );
}
