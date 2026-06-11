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
  Trash2,
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
import { CountryPicker } from "@/components/forms/country-picker";
import {
  SearchPicker,
  type SearchPickerOption,
} from "@/components/forms/search-picker";
import { CollabAvatars } from "@/components/realtime/collab-avatars";
import { FieldEditingIndicator } from "@/components/realtime/field-editing-indicator";
import { RemoteCursor } from "@/components/realtime/remote-cursor";
import { useLiveForm } from "@/lib/realtime/use-live-form";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import {
  createManualLotBulkAction,
  type BulkManualLotInput,
  type ManualLotPack,
} from "@/lib/stock/actions";
import type { ComplianceState } from "@/lib/types";
import type { ErrorResult } from "@/lib/errors/server";
import { cn } from "@/lib/utils";

interface ReceiveFormProps {
  canEdit: boolean;
}

/** Item the picker resolved. Carries the metadata the form derives
 *  off — stock UoM, storage tags, uuid for the edit-page link — so we
 *  don't need a second round-trip after a pick. */
interface ItemOption extends SearchPickerOption {
  uuid: string;
  uomId: number | null;
  uomSymbol: string | null;
  storageTags: string[];
  externalSku: string | null;
}

interface WarehouseOption extends SearchPickerOption {
  uuid: string;
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
  /** Carried alongside item_id so a collab peer joining mid-edit can
   *  resync the picker's selected option via `/api/items/<uuid>`
   *  without us having to add a `?id=` lookup on the list endpoint. */
  item_uuid: string;
  warehouse_id: string;
  warehouse_uuid: string;
  unit_cost: string;
  currency: string;
  /** Default batch number — each pack row can override it. */
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

/** One pack within the bulk receive — the same row the PO receive
 *  dialog renders. Strings on the input fields so empty / partial
 *  values don't fight react; converted to numbers at submit time. */
interface PackDraft {
  tempId: string;
  qty_received: string;
  package_length_mm: string;
  package_width_mm: string;
  package_height_mm: string;
  package_weight_kg: string;
  units_per_package: string;
  stack_factor: string;
  /** Optional per-pack override of the shared supplier batch no. */
  supplier_batch_no: string;
}

function makeDefaultPack(): PackDraft {
  return {
    tempId:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : String(Math.random()),
    qty_received: "",
    package_length_mm: "",
    package_width_mm: "",
    package_height_mm: "",
    package_weight_kg: "",
    units_per_package: "1",
    stack_factor: "1",
    supplier_batch_no: "",
  };
}

/**
 * Manual lot create — simplified to "what landed, how much, in which
 * warehouse". The lot drops into that warehouse's auto-managed
 * Unregistered cell; operators scan-move it to a real shelf later.
 *
 * Realtime collab per psp/CLAUDE.md: presence avatars, per-field
 * editing indicators, remote cursors, creator gate on the Save button.
 */
export function ReceiveForm({ canEdit }: ReceiveFormProps) {
  const router = useRouter();
  const resource = "stock-lot:new";
  useFormPresenceBeacon(resource);

  const initial = useMemo<DraftSnapshot>(
    () => ({
      item_id: "",
      item_uuid: "",
      warehouse_id: "",
      warehouse_uuid: "",
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
    [],
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

  // Picker-resolved options. These ARE the source of truth for the
  // selected-item / selected-warehouse metadata the form derives off;
  // the draft snapshot mirrors their id + uuid for collab broadcast
  // + submit-payload purposes only.
  const [pickedItem, setPickedItem] = useState<ItemOption | null>(null);
  const [pickedWarehouse, setPickedWarehouse] =
    useState<WarehouseOption | null>(null);

  // Pack rows — one stock_lot per pack on submit. Local React state
  // (not collab-broadcast) because the array would need a JSON
  // adapter on top of the field-level live form. Header-level fields
  // still broadcast; the operator multi-editing pack rows is the rare
  // case anyway. Starts with one empty pack so the operator has a row
  // to fill in immediately.
  const [packs, setPacks] = useState<PackDraft[]>(() => [makeDefaultPack()]);

  function patchPack(tempId: string, patch: Partial<PackDraft>) {
    setPacks((prev) =>
      prev.map((p) => (p.tempId === tempId ? { ...p, ...patch } : p)),
    );
    setPackagingSource(null);
  }

  function addPack() {
    setPacks((prev) => [...prev, makeDefaultPack()]);
  }

  function removePack(tempId: string) {
    setPacks((prev) =>
      prev.length === 1 ? prev : prev.filter((p) => p.tempId !== tempId),
    );
  }

  // Server-side search hits the existing items/warehouses list
  // endpoints with `search` + `limit=50`. AbortController, debounce,
  // and result merging are all handled inside SearchPicker.
  const fetchItemOptions = useCallback(
    async (query: string, signal?: AbortSignal): Promise<ItemOption[]> => {
      const params = new URLSearchParams({ limit: "50" });
      if (query) params.set("search", query);
      const res = await fetch(`/api/items?${params.toString()}`, { signal });
      if (!res.ok) throw new Error(`Items search failed (${res.status})`);
      const body = (await res.json()) as {
        items?: Array<{
          id: number;
          uuid: string;
          name: string;
          code?: string | null;
          external_sku?: string | null;
          stock_uom?: { id: number; symbol: string } | null;
          stock_uom_id?: number | null;
          storage_tags?: string[];
        }>;
      };
      return (body.items ?? []).map(itemRowToOption);
    },
    [],
  );

  const fetchWarehouseOptions = useCallback(
    async (
      query: string,
      signal?: AbortSignal,
    ): Promise<WarehouseOption[]> => {
      const params = new URLSearchParams({ limit: "50" });
      if (query) params.set("search", query);
      const res = await fetch(`/api/warehouses?${params.toString()}`, {
        signal,
      });
      if (!res.ok)
        throw new Error(`Warehouses search failed (${res.status})`);
      const body = (await res.json()) as {
        items?: Array<{
          id: number;
          uuid: string;
          name: string;
          code?: string | null;
        }>;
      };
      return (body.items ?? []).map((w) => ({
        id: w.id,
        uuid: w.uuid,
        label: w.name,
        code: w.code ?? null,
      }));
    },
    [],
  );

  // Collab resync — a peer just picked something, so our `draft.*_uuid`
  // updated via the form channel but our local pickedItem is stale.
  // Refetch by uuid so the picker label + the derived metadata match.
  useEffect(() => {
    if (!draft.item_uuid) {
      if (pickedItem !== null) setPickedItem(null);
      return;
    }
    if (pickedItem?.uuid === draft.item_uuid) return;
    const controller = new AbortController();
    fetch(`/api/items/${encodeURIComponent(draft.item_uuid)}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (body?.item) setPickedItem(itemRowToOption(body.item));
      })
      .catch(() => {
        /* aborted or transient — picker stays at last-known state */
      });
    return () => controller.abort();
  }, [draft.item_uuid, pickedItem?.uuid]);

  useEffect(() => {
    if (!draft.warehouse_uuid) {
      if (pickedWarehouse !== null) setPickedWarehouse(null);
      return;
    }
    if (pickedWarehouse?.uuid === draft.warehouse_uuid) return;
    const controller = new AbortController();
    fetch(`/api/warehouses/${encodeURIComponent(draft.warehouse_uuid)}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        const w = body?.warehouse;
        if (w) {
          setPickedWarehouse({
            id: w.id,
            uuid: w.uuid,
            label: w.name,
            code: w.code ?? null,
          });
        }
      })
      .catch(() => {
        /* aborted or transient */
      });
    return () => controller.abort();
  }, [draft.warehouse_uuid, pickedWarehouse?.uuid]);

  const selectedItem = pickedItem;
  const selectedWarehouse = pickedWarehouse;
  const uomSymbol = selectedItem?.uomSymbol ?? "—";
  const uomId = selectedItem?.uomId ?? null;
  const itemTags = selectedItem?.storageTags ?? [];

  // A pack counts as "valid" once every required field is positive.
  // Empty rows are dropped at submit time, so the operator can add a
  // pack and walk away without it blocking the save.
  function isPackComplete(p: PackDraft): boolean {
    return (
      Number(p.qty_received) > 0 &&
      Number(p.package_length_mm) > 0 &&
      Number(p.package_width_mm) > 0 &&
      Number(p.package_height_mm) > 0 &&
      Number(p.package_weight_kg) > 0 &&
      Number(p.units_per_package) > 0 &&
      Number(p.stack_factor) > 0
    );
  }
  const completePacks = packs.filter(isPackComplete);
  const qtyValid = completePacks.length > 0;
  const packagingValid = qtyValid;

  // Derived calculator — sums across every complete pack. Each pack
  // contributes its own packages count (qty ÷ units_per_package),
  // total weight, total volume, and stack count; the readout under
  // the pack table shows the consolidated values so the operator can
  // sanity-check against a destination cell's footprint.
  const packCalc = useMemo(() => {
    let totalQty = 0;
    let packagesTotal = 0;
    let totalWeightKg = 0;
    let totalLitres = 0;
    let stacksTotal = 0;
    let anyExactMismatch = false;
    let anyWeight = false;
    let anyVolume = false;
    let anyStack = false;
    let anyComplete = false;

    for (const p of packs) {
      const qty = Number(p.qty_received);
      const upp = Number(p.units_per_package);
      if (!(qty > 0 && upp > 0)) continue;

      anyComplete = true;
      totalQty += qty;

      const packagesRaw = qty / upp;
      const packages = Math.ceil(packagesRaw - 1e-9);
      if (Math.abs(packagesRaw - packages) > 1e-9) anyExactMismatch = true;
      packagesTotal += packages;

      const weight = Number(p.package_weight_kg);
      if (weight > 0) {
        anyWeight = true;
        totalWeightKg += packages * weight;
      }

      const lenMm = Number(p.package_length_mm);
      const widMm = Number(p.package_width_mm);
      const hgtMm = Number(p.package_height_mm);
      if (lenMm > 0 && widMm > 0 && hgtMm > 0) {
        anyVolume = true;
        totalLitres += packages * ((lenMm * widMm * hgtMm) / 1_000_000);
      }

      const stack = Number(p.stack_factor);
      if (stack > 0) {
        anyStack = true;
        stacksTotal += Math.ceil(packages / stack);
      }
    }

    if (!anyComplete) return null;
    return {
      totalQty,
      packagesTotal,
      totalWeightKg: anyWeight ? totalWeightKg : null,
      totalLitres: anyVolume ? totalLitres : null,
      stacksTotal: anyStack ? stacksTotal : null,
      anyExactMismatch,
      packCount: completePacks.length,
    };
  }, [packs, completePacks.length]);

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

  // Apply a packaging suggestion to every empty pack row. A row whose
  // dims are already filled is left alone — operators tweak rows
  // individually after the first pre-fill. The "Suggestions" pills
  // re-fire this on each click so the operator can switch sources.
  function applyPackaging(p: PackagingValues) {
    setPacks((prev) =>
      prev.map((pack) => {
        const empty =
          !pack.package_length_mm &&
          !pack.package_width_mm &&
          !pack.package_height_mm &&
          !pack.package_weight_kg;
        if (!empty) return pack;
        return {
          ...pack,
          package_length_mm: p.length_mm != null ? String(p.length_mm) : "",
          package_width_mm: p.width_mm != null ? String(p.width_mm) : "",
          package_height_mm: p.height_mm != null ? String(p.height_mm) : "",
          package_weight_kg: p.weight_kg != null ? String(p.weight_kg) : "",
          units_per_package:
            p.units_per_package != null ? String(p.units_per_package) : "1",
          stack_factor:
            p.stack_factor != null ? String(p.stack_factor) : "1",
        };
      }),
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

    // Strip pack rows the operator added but never filled — the bulk
    // endpoint validates per-pack so a half-row would 422 the whole
    // transaction. `completePacks` is the same predicate used for the
    // qtyValid gate above, so what we send is exactly what we counted.
    const submitPacks: ManualLotPack[] = completePacks.map((p) => ({
      qty_received: p.qty_received,
      package_length_mm: Number(p.package_length_mm),
      package_width_mm: Number(p.package_width_mm),
      package_height_mm: Number(p.package_height_mm),
      package_weight_kg: p.package_weight_kg,
      units_per_package: Number(p.units_per_package),
      stack_factor: Number(p.stack_factor),
      supplier_batch_no: p.supplier_batch_no.trim() || null,
    }));

    const input: BulkManualLotInput = {
      item_id: Number(draft.item_id),
      unit_of_measurement_id: uomId!,
      warehouse_id: Number(draft.warehouse_id),
      packs: submitPacks,
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
      // QC verdicts default server-side to "pending"; overall_risk is
      // derived from the item + vendor risk profile. Workers don't pick
      // these — never send them in the create payload.
      notes: draft.notes || null,
    };

    startTransition(async () => {
      const res = await createManualLotBulkAction(input);
      if (!res.ok) {
        setActionError(res);
        const debug = (res.debug as { fields?: FieldErrors } | undefined)
          ?.fields;
        if (debug) setFieldErrors(debug);
        return;
      }
      toast.success(
        res.lots.length === 1
          ? "Lot created"
          : `${res.lots.length} lots created`,
      );
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
                <SearchPicker<ItemOption>
                  id="item_id"
                  fetcher={fetchItemOptions}
                  value={pickedItem}
                  onChange={(opt) => {
                    setPickedItem(opt);
                    update("item_id", opt ? String(opt.id) : "");
                    update("item_uuid", opt ? opt.uuid : "");
                  }}
                  onFocus={() => focusField("item_id")}
                  onBlur={() => blurField("item_id")}
                  placeholder="Search items by name, SKU, or barcode…"
                  emptyHint="No items match. Add one at Settings → Items."
                />
                {selectedItem && selectedItem.uomId === null && (
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

            <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
              <Field
                id="warehouse_id"
                label="Site"
                required
                error={fieldErrors.warehouse_id?.[0]}
                editor={fieldEditors.warehouse_id}
              >
                <SearchPicker<WarehouseOption>
                  id="warehouse_id"
                  fetcher={fetchWarehouseOptions}
                  value={pickedWarehouse}
                  onChange={(opt) => {
                    setPickedWarehouse(opt);
                    update("warehouse_id", opt ? String(opt.id) : "");
                    update("warehouse_uuid", opt ? opt.uuid : "");
                  }}
                  onFocus={() => focusField("warehouse_id")}
                  onBlur={() => blurField("warehouse_id")}
                  placeholder="Search warehouses…"
                  emptyHint="No warehouses match."
                />
                {selectedWarehouse && (
                  <p className="text-[11px] text-muted-foreground">
                    <MapPin className="mr-1 inline size-3 text-muted-foreground" />
                    <span className="font-medium">
                      {selectedWarehouse.label}
                    </span>{" "}
                    · Unregistered
                  </p>
                )}
              </Field>

              {/* Total qty derives from the sum of pack rows below — a
                  single read-only readout instead of an input so there's
                  exactly one source of truth (mirrors the PO receive
                  dialog where qty is per-pack). */}
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Total qty
                </Label>
                <div className="flex h-9 items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-3 font-mono text-sm">
                  <span className={packCalc ? "font-semibold" : "text-muted-foreground"}>
                    {packCalc ? formatTrimmed(packCalc.totalQty) : "0"}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {uomSymbol}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Sum of pack rows below.
                </p>
              </div>
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

            {/* Pack table — one row per pack, mirrors the PO receive
                dialog so a single delivery can be split into mixed
                packaging (4×25 kg drums + 1×50 kg sack, etc.). Each
                row becomes its own stock_lot on submit; the bulk
                endpoint wraps them in one transaction. */}
            <div className="overflow-x-auto rounded-md border border-border/60">
              <table className="min-w-[820px] text-xs">
                <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="w-8 px-2 py-1.5 text-left">#</th>
                    <th className="w-24 px-2 py-1.5 text-right">
                      Qty ({uomSymbol})
                    </th>
                    <th className="w-16 px-2 py-1.5 text-right">L (mm)</th>
                    <th className="w-16 px-2 py-1.5 text-right">W (mm)</th>
                    <th className="w-16 px-2 py-1.5 text-right">H (mm)</th>
                    <th className="w-24 px-2 py-1.5 text-right">
                      Wt / pack (kg)
                    </th>
                    <th className="w-20 px-2 py-1.5 text-right">
                      Units / pack
                    </th>
                    <th className="w-16 px-2 py-1.5 text-right">Stack</th>
                    <th className="w-32 px-2 py-1.5 text-left">Batch (opt)</th>
                    <th className="w-8 px-2 py-1.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {packs.map((p, i) => (
                    <PackRow
                      key={p.tempId}
                      index={i}
                      pack={p}
                      onPatch={(patch) => patchPack(p.tempId, patch)}
                      onRemove={
                        packs.length === 1
                          ? undefined
                          : () => removePack(p.tempId)
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addPack}
              >
                + Add pack
              </Button>
              <p className="text-[11px] text-muted-foreground">
                {completePacks.length} of {packs.length} pack
                {packs.length === 1 ? "" : "s"} complete · each pack becomes
                its own stock lot.
              </p>
            </div>

            {packCalc && (
              <PackagingCalculator
                calc={packCalc}
                uomSymbol={uomSymbol}
              />
            )}
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
                <CountryPicker
                  id="country_of_origin"
                  value={draft.country_of_origin}
                  onChange={(v) => update("country_of_origin", v ?? "")}
                  onFocus={() => focusField("country_of_origin")}
                  onBlur={() => blurField("country_of_origin")}
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

          {/* QC verdicts (allergen / CoA / quality) are NOT set at create.
              Lot lands with all three = "pending"; a separate QC review
              event flips them to accepted/rejected with actor + evidence.
              `overall_risk` is also derived from the item + vendor risk
              profile at receipt — workers don't pick it. */}
          <section className="space-y-3 rounded-lg border border-border/60 bg-muted/30 p-4">
            <header className="space-y-0.5">
              <h2 className="text-sm font-semibold tracking-tight">
                Compliance state
              </h2>
              <p className="text-xs text-muted-foreground">
                New lots land with QC pending. Run an allergen / CoA /
                quality review from the lot detail page to record a
                verdict.
              </p>
            </header>
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

/** One pack row in the bulk receive table. Mirrors the PO receive
 *  dialog's per-pack row — same column order, same compact mono
 *  inputs, optional supplier batch override at the end. The trash
 *  button is hidden when only one row remains so the form can't end
 *  up empty (the bulk endpoint requires ≥1 pack). */
function PackRow({
  index,
  pack,
  onPatch,
  onRemove,
}: {
  index: number;
  pack: PackDraft;
  onPatch: (patch: Partial<PackDraft>) => void;
  onRemove?: () => void;
}) {
  return (
    <tr>
      <td className="px-2 py-1.5 text-left font-mono text-[10px] text-muted-foreground">
        {index + 1}
      </td>
      <PackCell
        value={pack.qty_received}
        onChange={(v) => onPatch({ qty_received: v })}
        label={`Pack ${index + 1} qty`}
        placeholder="0.00"
      />
      <PackCell
        value={pack.package_length_mm}
        onChange={(v) =>
          onPatch({ package_length_mm: v.replace(/\D/g, "") })
        }
        label={`Pack ${index + 1} length mm`}
        placeholder="400"
        integer
      />
      <PackCell
        value={pack.package_width_mm}
        onChange={(v) => onPatch({ package_width_mm: v.replace(/\D/g, "") })}
        label={`Pack ${index + 1} width mm`}
        placeholder="300"
        integer
      />
      <PackCell
        value={pack.package_height_mm}
        onChange={(v) =>
          onPatch({ package_height_mm: v.replace(/\D/g, "") })
        }
        label={`Pack ${index + 1} height mm`}
        placeholder="250"
        integer
      />
      <PackCell
        value={pack.package_weight_kg}
        onChange={(v) => onPatch({ package_weight_kg: v })}
        label={`Pack ${index + 1} weight kg`}
        placeholder="25.000"
      />
      <PackCell
        value={pack.units_per_package}
        onChange={(v) => onPatch({ units_per_package: v.replace(/\D/g, "") })}
        label={`Pack ${index + 1} units per pack`}
        placeholder="1"
        integer
      />
      <PackCell
        value={pack.stack_factor}
        onChange={(v) => onPatch({ stack_factor: v.replace(/\D/g, "") })}
        label={`Pack ${index + 1} stack factor`}
        placeholder="1"
        integer
      />
      <td className="px-2 py-1.5">
        <Input
          type="text"
          value={pack.supplier_batch_no}
          onChange={(e) => onPatch({ supplier_batch_no: e.target.value })}
          placeholder="BA-..."
          aria-label={`Pack ${index + 1} batch number`}
          className="h-8 font-mono text-xs"
        />
      </td>
      <td className="px-1 py-1.5 text-center">
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove pack ${index + 1}`}
            className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </td>
    </tr>
  );
}

/** Single mono input cell inside a {@link PackRow}. */
function PackCell({
  value,
  onChange,
  label,
  placeholder,
  integer,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  placeholder?: string;
  integer?: boolean;
}) {
  return (
    <td className="px-2 py-1.5">
      <Input
        type="text"
        inputMode={integer ? "numeric" : "decimal"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        placeholder={placeholder}
        className="h-8 text-right font-mono text-xs"
      />
    </td>
  );
}

/** Shape one item row off `/api/items?...` into the picker option the
 *  rest of the form reads off. Stock UoM gets unpacked from the compact
 *  sub-object the list endpoint embeds. */
function itemRowToOption(i: {
  id: number;
  uuid: string;
  name: string;
  code?: string | null;
  external_sku?: string | null;
  stock_uom?: { id: number; symbol: string } | null;
  stock_uom_id?: number | null;
  storage_tags?: string[];
}): ItemOption {
  return {
    id: i.id,
    uuid: i.uuid,
    label: i.name,
    code: i.code ?? i.external_sku ?? null,
    uomId: i.stock_uom?.id ?? i.stock_uom_id ?? null,
    uomSymbol: i.stock_uom?.symbol ?? null,
    storageTags: i.storage_tags ?? [],
    externalSku: i.external_sku ?? null,
  };
}

/**
 * Derived readout under the packaging row. Same units the warehouse
 * cells store (metres + m³ + kg) so an operator can compare the lot
 * directly against a cell's `width_m × depth_m × height_m` and
 * `max_weight_kg` without doing the mm→m conversion in their head.
 *
 * Shows: packages implied by qty ÷ units-per-pack; per-pack and total
 * volume; per-pack and total weight; and the number of stacks the
 * stack factor implies. A red "Doesn't divide evenly" badge surfaces
 * when qty / units_per_package isn't whole — usually a typo, or a
 * partial pack the operator should consciously round up for.
 */
function PackagingCalculator({
  calc,
  uomSymbol,
}: {
  calc: {
    totalQty: number;
    packagesTotal: number;
    totalWeightKg: number | null;
    totalLitres: number | null;
    stacksTotal: number | null;
    anyExactMismatch: boolean;
    packCount: number;
  };
  uomSymbol: string;
}) {
  // m³ is the only volume unit cells store, so we emit it. Per-pack
  // numbers are dropped now that the form supports mixed packaging —
  // a single "0.030 m³ / pack" wouldn't be meaningful when packs vary.
  const totalM3 = calc.totalLitres !== null ? calc.totalLitres / 1000 : null;

  return (
    <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-[11px]">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5 font-mono">
        <span className="text-muted-foreground">Calc</span>
        <span>
          <strong>{formatTrimmed(calc.totalQty)} {uomSymbol}</strong>
          <span className="text-muted-foreground"> total qty</span>
        </span>
        <span>
          <strong>{calc.packagesTotal}</strong> package
          {calc.packagesTotal === 1 ? "" : "s"}
          <span className="text-muted-foreground">
            {" "}
            across {calc.packCount} pack row{calc.packCount === 1 ? "" : "s"}
          </span>
        </span>
        {totalM3 !== null && (
          <span>
            <strong>{formatM3(totalM3)} m³</strong>
            <span className="text-muted-foreground"> total volume</span>
          </span>
        )}
        {calc.totalWeightKg !== null && (
          <span>
            <strong>{calc.totalWeightKg.toFixed(3).replace(/\.?0+$/, "")} kg</strong>
            <span className="text-muted-foreground"> total weight</span>
          </span>
        )}
        {calc.stacksTotal !== null && (
          <span>
            <strong>{calc.stacksTotal}</strong> stack
            {calc.stacksTotal === 1 ? "" : "s"}
            <span className="text-muted-foreground">
              {" "}
              (sum ÷ stack factor)
            </span>
          </span>
        )}
        {calc.anyExactMismatch && (
          <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-destructive">
            One pack doesn't divide evenly
          </span>
        )}
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        Compare against a destination cell's width × depth × height (m)
        and max weight (kg) before put-away.
      </p>
    </div>
  );
}

function formatM3(v: number): string {
  // Cell volumes are usually in single-digit or tens of m³, so 3 dp
  // is plenty. Strip trailing zeros so 0.025 doesn't read as 0.025000.
  return v.toFixed(3).replace(/\.?0+$/, "");
}

function formatTrimmed(v: number): string {
  // Decimal readout for the totals — drops trailing zeros so 100 reads
  // as "100" not "100.000". Falls back to 3 dp for fractional totals.
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(3).replace(/\.?0+$/, "");
}
