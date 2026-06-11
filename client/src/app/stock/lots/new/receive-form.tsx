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
  Box,
  Info,
  Loader2,
  Lock,
  LockKeyhole,
  MapPin,
  Save,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { CollabAvatars } from "@/components/realtime/collab-avatars";
import { FieldEditingIndicator } from "@/components/realtime/field-editing-indicator";
import { RemoteCursor } from "@/components/realtime/remote-cursor";
import { useLiveForm } from "@/lib/realtime/use-live-form";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import {
  createManualLotAction,
  type ManualLotInput,
} from "@/lib/stock/actions";
import type { ComplianceState, Item, Warehouse } from "@/lib/types";
import type { ErrorResult } from "@/lib/errors/server";
import { cn } from "@/lib/utils";

interface ReceiveFormProps {
  items: Item[];
  warehouses: Warehouse[];
  canEdit: boolean;
}

interface PackagingValues {
  length_mm?: number | null;
  width_mm?: number | null;
  height_mm?: number | null;
  weight_kg?: string | number | null;
  units_per_package?: number | null;
  stack_factor?: number | null;
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

const UNSET = "__unset__";

type FieldErrors = Record<string, string[]>;

type DraftSnapshot = {
  item_id: string;
  warehouse_id: string;
  qty_received: string;
  package_length_mm: string;
  package_width_mm: string;
  package_height_mm: string;
  package_weight_kg: string;
  units_per_package: string;
  stack_factor: string;
  unit_cost: string;
  currency: string;
  supplier_batch_no: string;
  country_of_origin: string;
  revision: string;
  manufactured_at: string;
  expiry_at: string;
  available_from: string;
  overall_risk: string;
  allergen_status: string;
  coa_status: string;
  quality_status: string;
  notes: string;
};

/**
 * Manual lot create — simplified to "what landed, how much, in which
 * warehouse". The lot drops into that warehouse's auto-managed
 * Unregistered cell; operators scan-move it to a real shelf later.
 *
 * Realtime collab per psp/CLAUDE.md: presence avatars, per-field
 * editing indicators, remote cursors, creator gate on the Save button.
 */
export function ReceiveForm({ items, warehouses, canEdit }: ReceiveFormProps) {
  const router = useRouter();
  const resource = "stock-lot:new";
  useFormPresenceBeacon(resource);

  const initial = useMemo<DraftSnapshot>(
    () => ({
      item_id: "",
      warehouse_id: warehouses.length === 1 ? String(warehouses[0].id) : "",
      qty_received: "",
      package_length_mm: "",
      package_width_mm: "",
      package_height_mm: "",
      package_weight_kg: "",
      units_per_package: "1",
      stack_factor: "1",
      unit_cost: "",
      currency: "GBP",
      supplier_batch_no: "",
      country_of_origin: "",
      revision: "",
      manufactured_at: "",
      expiry_at: "",
      available_from: "",
      overall_risk: "",
      allergen_status: "",
      coa_status: "",
      quality_status: "",
      notes: "",
    }),
    [warehouses],
  );

  type CommitPayload = { kind: "created" };

  const {
    state: draft,
    setField,
    resetState,
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
  } = useLiveForm<DraftSnapshot>({
    resource,
    disabled: !canEdit,
    initialState: initial,
    onCommit: (raw) => {
      const msg = raw as CommitPayload | null;
      if (!msg) return;
      if (msg.kind === "created") {
        toast.success("Lot created", {
          description: `${creator?.name ?? "The host"} just received the lot.`,
        });
        router.push("/stock/lots");
      }
    },
  });

  const [pending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // Track which suggestion (if any) was applied so we can show it as
  // a chip and explain the source. Local-only — peers don't need to
  // know which pill we tapped.
  const [packagingSource, setPackagingSource] = useState<
    null | "item_default" | "last_lot" | "average"
  >(null);
  const [suggestions, setSuggestions] = useState<{
    item_default: PackagingValues | null;
    last_lot: PackagingValues | null;
    average: PackagingValues | null;
  } | null>(null);

  const itemById = useMemo(
    () => new Map(items.map((i) => [String(i.id), i])),
    [items],
  );
  const warehouseById = useMemo(
    () => new Map(warehouses.map((w) => [String(w.id), w])),
    [warehouses],
  );

  const selectedItem = draft.item_id
    ? itemById.get(draft.item_id)
    : undefined;
  const selectedWarehouse = draft.warehouse_id
    ? warehouseById.get(draft.warehouse_id)
    : undefined;
  const uomSymbol = selectedItem?.stock_uom?.symbol ?? "—";
  const uomId = selectedItem?.stock_uom?.id ?? null;
  const itemTags = selectedItem?.storage_tags ?? [];

  const qtyValid = Number(draft.qty_received) > 0;
  const packagingValid =
    Number(draft.package_length_mm) > 0 &&
    Number(draft.package_width_mm) > 0 &&
    Number(draft.package_height_mm) > 0 &&
    Number(draft.package_weight_kg) > 0 &&
    Number(draft.units_per_package) > 0 &&
    Number(draft.stack_factor) > 0;

  const canSubmit =
    !!draft.item_id &&
    !!uomId &&
    !!draft.warehouse_id &&
    qtyValid &&
    packagingValid &&
    !pending &&
    isCreator;

  function update<K extends keyof DraftSnapshot>(
    key: K,
    value: DraftSnapshot[K],
  ) {
    setField(key, value);
    setFieldErrors((e) => {
      if (!e[String(key)]) return e;
      const next = { ...e };
      delete next[String(key)];
      return next;
    });
  }

  function applyPackaging(p: PackagingValues) {
    setField("package_length_mm", p.length_mm != null ? String(p.length_mm) : "");
    setField("package_width_mm", p.width_mm != null ? String(p.width_mm) : "");
    setField("package_height_mm", p.height_mm != null ? String(p.height_mm) : "");
    setField("package_weight_kg", p.weight_kg != null ? String(p.weight_kg) : "");
    setField(
      "units_per_package",
      p.units_per_package != null ? String(p.units_per_package) : "1",
    );
    setField(
      "stack_factor",
      p.stack_factor != null ? String(p.stack_factor) : "1",
    );
  }

  // When the operator picks an item, fetch the three suggestion
  // sources and pre-fill from whichever is available, in priority
  // order: item default → last lot → average. Operator can re-tap
  // any pill to switch source, or override individual fields.
  useEffect(() => {
    if (!draft.item_id) {
      setSuggestions(null);
      setPackagingSource(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/items/${encodeURIComponent(draft.item_id)}/packaging-suggestions`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          suggestions: {
            item_default: PackagingValues | null;
            last_lot: PackagingValues | null;
            average: PackagingValues | null;
          } | null;
        };
        if (cancelled) return;
        const s = data.suggestions ?? {
          item_default: null,
          last_lot: null,
          average: null,
        };
        setSuggestions(s);
        if (s.item_default) {
          applyPackaging(s.item_default);
          setPackagingSource("item_default");
        } else if (s.last_lot) {
          applyPackaging(s.last_lot);
          setPackagingSource("last_lot");
        } else if (s.average) {
          applyPackaging(s.average);
          setPackagingSource("average");
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.item_id]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !isCreator) return;
    setActionError(null);
    setFieldErrors({});

    const input: ManualLotInput = {
      item_id: Number(draft.item_id),
      unit_of_measurement_id: uomId!,
      warehouse_id: Number(draft.warehouse_id),
      qty_received: draft.qty_received,
      package_length_mm: Number(draft.package_length_mm),
      package_width_mm: Number(draft.package_width_mm),
      package_height_mm: Number(draft.package_height_mm),
      package_weight_kg: draft.package_weight_kg,
      units_per_package: Number(draft.units_per_package),
      stack_factor: Number(draft.stack_factor),
      unit_cost: draft.unit_cost || null,
      currency: draft.unit_cost ? draft.currency : null,
      supplier_batch_no: draft.supplier_batch_no || null,
      country_of_origin: draft.country_of_origin || null,
      revision: draft.revision || null,
      manufactured_at: draft.manufactured_at || null,
      expiry_at: draft.expiry_at || null,
      available_from: draft.available_from
        ? new Date(draft.available_from).toISOString()
        : null,
      overall_risk: (draft.overall_risk as "low" | "medium" | "high") || null,
      allergen_status: (draft.allergen_status as ComplianceState) || null,
      coa_status: (draft.coa_status as ComplianceState) || null,
      quality_status: (draft.quality_status as ComplianceState) || null,
      notes: draft.notes || null,
    };

    startTransition(async () => {
      const res = await createManualLotAction(input);
      if (!res.ok) {
        setActionError(res);
        const debug = (res.debug as { fields?: FieldErrors } | undefined)
          ?.fields;
        if (debug) setFieldErrors(debug);
        return;
      }
      toast.success("Lot created");
      broadcastCommit({ kind: "created" });
      router.push("/stock/lots");
      router.refresh();
    });
  }

  // Cursor anchor + size observer (mirrors the vendor pattern).
  const cursorAnchorRef = useRef<HTMLDivElement | null>(null);
  const [anchorSize, setAnchorSize] = useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });
  useEffect(() => {
    const el = cursorAnchorRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      setAnchorSize({ w: rect.width, h: rect.height });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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

  if (joinError) {
    return <JoinErrorCard error={joinError} />;
  }

  const inputsDisabled = !canEdit || pending;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div
        ref={cursorAnchorRef}
        onMouseMove={onCursorMove}
        onMouseLeave={hideCursor}
        className="relative space-y-4"
      >
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

        <header className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] text-muted-foreground">
            {!canEdit && (
              <span>
                Read-only — needs <code>stock.receive</code>
              </span>
            )}
          </div>
          <CollabAvatars peers={presence} />
        </header>

        {actionError && (
          <ErrorBanner
            detail={actionError.detail}
            code={actionError.code}
            debug={actionError.debug}
          />
        )}

        <fieldset disabled={inputsDisabled} className="space-y-6 border-0 p-0">
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
              <Field
                id="item_id"
                label="Item"
                required
                error={fieldErrors.item_id?.[0]}
                editor={fieldEditors.item_id}
              >
                <Select
                  value={draft.item_id}
                  onValueChange={(v) => update("item_id", v)}
                >
                  <SelectTrigger
                    id="item_id"
                    className="h-9"
                    onFocus={() => focusField("item_id")}
                    onBlur={() => blurField("item_id")}
                  >
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

              <Field
                id="available_from"
                label="Available from"
                error={fieldErrors.available_from?.[0]}
                editor={fieldEditors.available_from}
              >
                <Input
                  id="available_from"
                  type="datetime-local"
                  value={draft.available_from}
                  onChange={(e) => update("available_from", e.target.value)}
                  onFocus={() => focusField("available_from")}
                  onBlur={() => blurField("available_from")}
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

          {/* Destination */}
          <section className="space-y-4 rounded-lg border border-border/60 bg-card p-4">
            <header className="space-y-1.5">
              <h2 className="text-sm font-semibold tracking-tight">
                Destination
              </h2>
              <div className="flex items-start gap-2 rounded-md border border-primary/20 bg-primary/[0.04] px-3 py-2 text-[11px] text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0 text-primary" />
                <span>
                  Lot lands in the warehouse&apos;s{" "}
                  <strong>Unregistered</strong> location. Scan it onto a
                  real shelf later from the mobile app and the system
                  records the move automatically.
                </span>
              </div>
            </header>

            <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
              <Field
                id="warehouse_id"
                label="Site"
                required
                error={fieldErrors.warehouse_id?.[0]}
                editor={fieldEditors.warehouse_id}
              >
                <Select
                  value={draft.warehouse_id}
                  onValueChange={(v) => update("warehouse_id", v)}
                >
                  <SelectTrigger
                    id="warehouse_id"
                    className="h-9"
                    onFocus={() => focusField("warehouse_id")}
                    onBlur={() => blurField("warehouse_id")}
                  >
                    <SelectValue placeholder="Pick a warehouse…" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses.map((w) => (
                      <SelectItem key={w.id} value={String(w.id)}>
                        <span className="flex items-center gap-2">
                          <MapPin className="size-3.5 text-muted-foreground" />
                          <span>{w.name}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedWarehouse && (
                  <p className="text-[11px] text-muted-foreground">
                    →{" "}
                    <span className="font-medium">
                      {selectedWarehouse.name}
                    </span>{" "}
                    · Unregistered
                  </p>
                )}
              </Field>

              <Field
                id="qty_received"
                label="Quantity"
                required
                error={fieldErrors.qty_received?.[0]}
                editor={fieldEditors.qty_received}
              >
                <div className="flex items-stretch gap-1">
                  <Input
                    id="qty_received"
                    type="text"
                    inputMode="decimal"
                    value={draft.qty_received}
                    onChange={(e) => update("qty_received", e.target.value)}
                    onFocus={() => focusField("qty_received")}
                    onBlur={() => blurField("qty_received")}
                    placeholder="0.00"
                    className="h-9 font-mono"
                  />
                  <span className="inline-flex items-center rounded-md border border-border/60 bg-muted px-2 text-[10px] font-medium text-muted-foreground">
                    {uomSymbol}
                  </span>
                </div>
              </Field>
            </div>
          </section>

          {/* Packaging — mandatory. Drives the put-away fit checks
              (volumetric + weight). Pills above auto-fill from the
              item's default template, the previous lot, or the 10-lot
              average; operator can override per field. */}
          <section className="space-y-4 rounded-lg border border-border/60 bg-card p-4">
            <header className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Box className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold tracking-tight">
                  Packaging
                </h2>
                <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                  Required
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                How this batch is packaged. The put-away module uses
                this to check what fits on which shelf — same SKU from
                a different supplier can ship in a totally different
                footprint, so we ask per lot.
              </p>
            </header>

            {selectedItem && suggestions && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Suggestions:
                </span>
                <SuggestionPill
                  label="Item default"
                  active={packagingSource === "item_default"}
                  disabled={!suggestions.item_default}
                  onClick={() => {
                    if (suggestions.item_default) {
                      applyPackaging(suggestions.item_default);
                      setPackagingSource("item_default");
                    }
                  }}
                />
                <SuggestionPill
                  label="Use last batch"
                  active={packagingSource === "last_lot"}
                  disabled={!suggestions.last_lot}
                  onClick={() => {
                    if (suggestions.last_lot) {
                      applyPackaging(suggestions.last_lot);
                      setPackagingSource("last_lot");
                    }
                  }}
                />
                <SuggestionPill
                  label="Average (last 10)"
                  active={packagingSource === "average"}
                  disabled={!suggestions.average}
                  onClick={() => {
                    if (suggestions.average) {
                      applyPackaging(suggestions.average);
                      setPackagingSource("average");
                    }
                  }}
                />
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              <Field
                id="package_length_mm"
                label="Length (mm)"
                required
                error={fieldErrors.package_length_mm?.[0]}
                editor={fieldEditors.package_length_mm}
              >
                <Input
                  id="package_length_mm"
                  type="text"
                  inputMode="numeric"
                  value={draft.package_length_mm}
                  onChange={(e) => {
                    update("package_length_mm", e.target.value.replace(/\D/g, ""));
                    setPackagingSource(null);
                  }}
                  onFocus={() => focusField("package_length_mm")}
                  onBlur={() => blurField("package_length_mm")}
                  placeholder="e.g. 400"
                  className="h-9 font-mono"
                />
              </Field>
              <Field
                id="package_width_mm"
                label="Width (mm)"
                required
                error={fieldErrors.package_width_mm?.[0]}
                editor={fieldEditors.package_width_mm}
              >
                <Input
                  id="package_width_mm"
                  type="text"
                  inputMode="numeric"
                  value={draft.package_width_mm}
                  onChange={(e) => {
                    update("package_width_mm", e.target.value.replace(/\D/g, ""));
                    setPackagingSource(null);
                  }}
                  onFocus={() => focusField("package_width_mm")}
                  onBlur={() => blurField("package_width_mm")}
                  placeholder="e.g. 400"
                  className="h-9 font-mono"
                />
              </Field>
              <Field
                id="package_height_mm"
                label="Height (mm)"
                required
                error={fieldErrors.package_height_mm?.[0]}
                editor={fieldEditors.package_height_mm}
              >
                <Input
                  id="package_height_mm"
                  type="text"
                  inputMode="numeric"
                  value={draft.package_height_mm}
                  onChange={(e) => {
                    update("package_height_mm", e.target.value.replace(/\D/g, ""));
                    setPackagingSource(null);
                  }}
                  onFocus={() => focusField("package_height_mm")}
                  onBlur={() => blurField("package_height_mm")}
                  placeholder="e.g. 600"
                  className="h-9 font-mono"
                />
              </Field>
              <Field
                id="package_weight_kg"
                label="Net weight (kg)"
                required
                error={fieldErrors.package_weight_kg?.[0]}
                editor={fieldEditors.package_weight_kg}
              >
                <Input
                  id="package_weight_kg"
                  type="text"
                  inputMode="decimal"
                  value={draft.package_weight_kg}
                  onChange={(e) => {
                    update("package_weight_kg", e.target.value);
                    setPackagingSource(null);
                  }}
                  onFocus={() => focusField("package_weight_kg")}
                  onBlur={() => blurField("package_weight_kg")}
                  placeholder="e.g. 25.000"
                  className="h-9 font-mono"
                />
              </Field>
              <Field
                id="units_per_package"
                label="Units / package"
                required
                error={fieldErrors.units_per_package?.[0]}
                editor={fieldEditors.units_per_package}
              >
                <Input
                  id="units_per_package"
                  type="text"
                  inputMode="numeric"
                  value={draft.units_per_package}
                  onChange={(e) => {
                    update("units_per_package", e.target.value.replace(/\D/g, ""));
                    setPackagingSource(null);
                  }}
                  onFocus={() => focusField("units_per_package")}
                  onBlur={() => blurField("units_per_package")}
                  placeholder="1"
                  className="h-9 font-mono"
                />
                <p className="text-[11px] text-muted-foreground">
                  How many {uomSymbol} ride in one package.
                </p>
              </Field>
              <Field
                id="stack_factor"
                label="Stack factor"
                required
                error={fieldErrors.stack_factor?.[0]}
                editor={fieldEditors.stack_factor}
              >
                <Input
                  id="stack_factor"
                  type="text"
                  inputMode="numeric"
                  value={draft.stack_factor}
                  onChange={(e) => {
                    update("stack_factor", e.target.value.replace(/\D/g, ""));
                    setPackagingSource(null);
                  }}
                  onFocus={() => focusField("stack_factor")}
                  onBlur={() => blurField("stack_factor")}
                  placeholder="1"
                  className="h-9 font-mono"
                />
                <p className="text-[11px] text-muted-foreground">
                  How many packages stack safely vertically.
                </p>
              </Field>
            </div>
          </section>

          {/* Provenance — supplier batch + origin + revision. Source
              here is always "manual" (operator-authored); real PO
              receives land later from the procurement module. */}
          <section className="space-y-4 rounded-lg border border-border/60 bg-card p-4">
            <header className="space-y-1.5">
              <h2 className="text-sm font-semibold tracking-tight">
                Provenance
              </h2>
              <div className="flex items-start gap-2 rounded-md border border-primary/20 bg-primary/[0.04] px-3 py-2 text-[11px] text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0 text-primary" />
                <span>
                  Source is recorded as <strong>Manually created</strong>{" "}
                  by you, right now. Real receives against a Purchase
                  Order will come from the Procurement module once it
                  ships.
                </span>
              </div>
            </header>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                id="supplier_batch_no"
                label="Supplier batch no."
                error={fieldErrors.supplier_batch_no?.[0]}
                editor={fieldEditors.supplier_batch_no}
              >
                <Input
                  id="supplier_batch_no"
                  value={draft.supplier_batch_no}
                  onChange={(e) => update("supplier_batch_no", e.target.value)}
                  onFocus={() => focusField("supplier_batch_no")}
                  onBlur={() => blurField("supplier_batch_no")}
                  placeholder="What the supplier called it"
                  className="h-9 font-mono"
                />
              </Field>
              <Field
                id="country_of_origin"
                label="Country of origin"
                error={fieldErrors.country_of_origin?.[0]}
                editor={fieldEditors.country_of_origin}
              >
                <Input
                  id="country_of_origin"
                  value={draft.country_of_origin}
                  onChange={(e) => update("country_of_origin", e.target.value)}
                  onFocus={() => focusField("country_of_origin")}
                  onBlur={() => blurField("country_of_origin")}
                  placeholder="e.g. IT"
                  className="h-9"
                />
              </Field>
              <Field
                id="revision"
                label="Revision"
                error={fieldErrors.revision?.[0]}
                editor={fieldEditors.revision}
              >
                <Input
                  id="revision"
                  value={draft.revision}
                  onChange={(e) => update("revision", e.target.value)}
                  onFocus={() => focusField("revision")}
                  onBlur={() => blurField("revision")}
                  placeholder="e.g. V00"
                  className="h-9 font-mono"
                />
              </Field>
              <Field
                id="manufactured_at"
                label="Manufactured at"
                error={fieldErrors.manufactured_at?.[0]}
                editor={fieldEditors.manufactured_at}
              >
                <Input
                  id="manufactured_at"
                  type="date"
                  value={draft.manufactured_at}
                  onChange={(e) => update("manufactured_at", e.target.value)}
                  onFocus={() => focusField("manufactured_at")}
                  onBlur={() => blurField("manufactured_at")}
                  className="h-9"
                />
              </Field>
              <Field
                id="expiry_at"
                label="Expires at"
                error={fieldErrors.expiry_at?.[0]}
                editor={fieldEditors.expiry_at}
              >
                <Input
                  id="expiry_at"
                  type="date"
                  value={draft.expiry_at}
                  onChange={(e) => update("expiry_at", e.target.value)}
                  onFocus={() => focusField("expiry_at")}
                  onBlur={() => blurField("expiry_at")}
                  className="h-9"
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
              <Field
                id="unit_cost"
                label="Unit cost"
                error={fieldErrors.unit_cost?.[0]}
                editor={fieldEditors.unit_cost}
              >
                <Input
                  id="unit_cost"
                  type="text"
                  inputMode="decimal"
                  value={draft.unit_cost}
                  onChange={(e) => update("unit_cost", e.target.value)}
                  onFocus={() => focusField("unit_cost")}
                  onBlur={() => blurField("unit_cost")}
                  placeholder="e.g. 5.15"
                  className="h-9 font-mono"
                />
              </Field>
              <Field
                id="currency"
                label="Currency"
                error={fieldErrors.currency?.[0]}
                editor={fieldEditors.currency}
              >
                <Input
                  id="currency"
                  value={draft.currency}
                  onChange={(e) =>
                    update("currency", e.target.value.toUpperCase())
                  }
                  onFocus={() => focusField("currency")}
                  onBlur={() => blurField("currency")}
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
              <h2 className="text-sm font-semibold tracking-tight">
                Compliance
              </h2>
              <p className="text-xs text-muted-foreground">
                Initial QC state. Each is independent — you can have CoA
                accepted but quality still pending.
              </p>
            </header>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field
                id="overall_risk"
                label="Overall risk"
                error={fieldErrors.overall_risk?.[0]}
                editor={fieldEditors.overall_risk}
              >
                <Select
                  value={draft.overall_risk || UNSET}
                  onValueChange={(v) =>
                    update("overall_risk", v === UNSET ? "" : v)
                  }
                >
                  <SelectTrigger
                    id="overall_risk"
                    className="h-9"
                    onFocus={() => focusField("overall_risk")}
                    onBlur={() => blurField("overall_risk")}
                  >
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNSET}>—</SelectItem>
                    {RISK_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field
                id="allergen_status"
                label="Allergen status"
                error={fieldErrors.allergen_status?.[0]}
                editor={fieldEditors.allergen_status}
              >
                <Select
                  value={draft.allergen_status || UNSET}
                  onValueChange={(v) =>
                    update("allergen_status", v === UNSET ? "" : v)
                  }
                >
                  <SelectTrigger
                    id="allergen_status"
                    className="h-9"
                    onFocus={() => focusField("allergen_status")}
                    onBlur={() => blurField("allergen_status")}
                  >
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNSET}>—</SelectItem>
                    {COMPLIANCE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field
                id="coa_status"
                label="CoA status"
                error={fieldErrors.coa_status?.[0]}
                editor={fieldEditors.coa_status}
              >
                <Select
                  value={draft.coa_status || UNSET}
                  onValueChange={(v) =>
                    update("coa_status", v === UNSET ? "" : v)
                  }
                >
                  <SelectTrigger
                    id="coa_status"
                    className="h-9"
                    onFocus={() => focusField("coa_status")}
                    onBlur={() => blurField("coa_status")}
                  >
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNSET}>—</SelectItem>
                    {COMPLIANCE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field
                id="quality_status"
                label="Quality status"
                error={fieldErrors.quality_status?.[0]}
                editor={fieldEditors.quality_status}
              >
                <Select
                  value={draft.quality_status || UNSET}
                  onValueChange={(v) =>
                    update("quality_status", v === UNSET ? "" : v)
                  }
                >
                  <SelectTrigger
                    id="quality_status"
                    className="h-9"
                    onFocus={() => focusField("quality_status")}
                    onBlur={() => blurField("quality_status")}
                  >
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNSET}>—</SelectItem>
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

          {/* Notes */}
          <section className="space-y-3 rounded-lg border border-border/60 bg-card p-4">
            <header>
              <h2 className="text-sm font-semibold tracking-tight">Notes</h2>
            </header>
            <Field
              id="notes"
              label="Internal notes"
              error={fieldErrors.notes?.[0]}
              editor={fieldEditors.notes}
            >
              <Textarea
                id="notes"
                value={draft.notes}
                onChange={(e) => update("notes", e.target.value)}
                onFocus={() => focusField("notes")}
                onBlur={() => blurField("notes")}
                placeholder="Anything that needs surfacing on the lot detail page"
                className="min-h-20"
              />
            </Field>
          </section>

          {canEdit && (
            <>
              {!isCreator && creator && (
                <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
                  <Lock className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    Only{" "}
                    <span className="font-medium text-foreground">
                      {creator.name}
                    </span>{" "}
                    can create from this room. Your edits sync to them
                    live.
                  </span>
                </div>
              )}
              <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/95 px-4 py-3 shadow-md backdrop-blur">
                <div className="text-xs text-muted-foreground">
                  Filling in a new lot.
                </div>
                <div className="flex items-center gap-2">
                  {isCreator && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        resetState(initial);
                        router.push("/stock/lots");
                      }}
                      disabled={pending}
                    >
                      Cancel
                    </Button>
                  )}
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!canSubmit}
                    title={
                      isCreator
                        ? undefined
                        : creator
                          ? `Only ${creator.name} can create from this room.`
                          : undefined
                    }
                  >
                    {pending ? (
                      <Loader2 className="mr-1.5 size-4 animate-spin" />
                    ) : (
                      <Save className="mr-1.5 size-4" />
                    )}
                    Create lot
                  </Button>
                </div>
              </div>
            </>
          )}
        </fieldset>
      </div>
    </form>
  );
}

function JoinErrorCard({
  error,
}: {
  error: import("@/lib/realtime/use-live-form").JoinError;
}) {
  const config = {
    form_full: {
      icon: AlertCircle,
      tone: "amber",
      title: `Form is at capacity`,
      detail: error.limit
        ? `Up to ${error.limit} people can receive this lot at once. Wait for someone to leave, then refresh.`
        : "Wait for someone to leave, then refresh.",
    },
    forbidden: {
      icon: LockKeyhole,
      tone: "muted",
      title: "You can't edit here",
      detail:
        "Ask an admin for the `stock.edit` permission to join this form.",
    },
    bad_topic: {
      icon: AlertCircle,
      tone: "destructive",
      title: "Unknown form",
      detail: "We couldn't find this form. The link may have been malformed.",
    },
    unknown: {
      icon: AlertCircle,
      tone: "destructive",
      title: "Couldn't open the form",
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

function SuggestionPill({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        active
          ? "inline-flex items-center gap-1 rounded-full bg-brand/15 px-2.5 py-1 text-[11px] font-medium text-brand"
          : disabled
            ? "inline-flex items-center gap-1 rounded-full bg-muted/40 px-2.5 py-1 text-[11px] font-medium text-muted-foreground/50 cursor-not-allowed"
            : "inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted/70"
      }
    >
      <Sparkles className="size-3" />
      {label}
    </button>
  );
}

function Field({
  id,
  label,
  required,
  error,
  editor,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  editor: import("@/lib/realtime/use-live-form").CollabPeer | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label
        htmlFor={id}
        className="text-[11px] uppercase tracking-wider text-muted-foreground"
      >
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      <div className="relative">
        {children}
        <FieldEditingIndicator peer={editor} />
      </div>
      {error && (
        <p className="text-[11px] text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
