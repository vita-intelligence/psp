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
  Building2,
  FileText,
  Loader2,
  Lock,
  LockKeyhole,
  Package,
  Paperclip,
  Plus,
  Save,
  Send,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorBanner } from "@/components/forms/error-banner";
import { CurrencyPicker } from "@/components/forms/currency-picker";
import {
  SearchPicker,
  type SearchPickerOption,
} from "@/components/forms/search-picker";
import {
  DerivedDateField,
  addDaysFromToday,
} from "@/components/forms/derived-date-field";
import { CollabAvatars } from "@/components/realtime/collab-avatars";
import { FieldEditingIndicator } from "@/components/realtime/field-editing-indicator";
import { RemoteCursor } from "@/components/realtime/remote-cursor";
import { useLiveForm } from "@/lib/realtime/use-live-form";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import { cn } from "@/lib/utils";
import type { ErrorDebug } from "@/lib/errors/types";
import type { ErrorResult } from "@/lib/errors/server";
import {
  createPOWithLinesAction,
  submitPOAction,
  uploadPOFileAction,
  type POHeaderInput,
  type POLineInput,
} from "@/lib/purchase-orders/actions";
import type {
  ShortageDependentMo,
  ShortageRow,
} from "@/lib/procurement-shortages/server";

/** Vendor option — carries the picker label + the metadata the form
 *  derives off (currency_code, lead time) so we don't need a second
 *  round-trip after a pick. */
interface VendorOption extends SearchPickerOption {
  uuid: string;
  currencyCode: string;
  defaultLeadTimeDays: number;
  isApproved: boolean;
  isActive: boolean;
}

/** Item option — carries item.code so the line row can render the
 *  hint underneath the picker without a parallel lookup. */
interface ItemOption extends SearchPickerOption {
  uuid: string;
  externalSku: string | null;
}

interface WarehouseOption extends SearchPickerOption {
  uuid: string;
}

interface POLineDraftReservation {
  mo_uuid: string;
  /** String decimal — empty string means "skip this MO". */
  qty: string;
}

interface POLineDraft {
  /** Stable client-side id for React keys + collab broadcasts. */
  tempId: string;
  item_id: string;
  qty_ordered: string;
  unit_price: string;
  vendor_part_no: string;
  warehouse_id: string;
  expected_delivery_date: string;
  notes: string;
  /** Explicit per-MO reservations. Empty = auto-FIFO (BE default). */
  reservations: POLineDraftReservation[];
  /** Sticky suggest-price metadata (not broadcast — local fetch). */
  last_paid_price?: string | null;
  last_paid_at?: string | null;
}

interface FormState {
  vendorId: string;
  currency: string;
  default_warehouse_id: string;
  expected_delivery_date: string;
  delivery_address: string;
  discount_pct: string;
  tax_rate: string;
  shipping_fees: string;
  additional_fees: string;
  lines: POLineDraft[];
}

const INITIAL: FormState = {
  vendorId: "",
  currency: "GBP",
  default_warehouse_id: "",
  expected_delivery_date: "",
  delivery_address: "",
  discount_pct: "",
  tax_rate: "",
  shipping_fees: "",
  additional_fees: "",
  lines: [],
};

const FILE_KINDS = ["quote", "spec", "other"] as const;
type PendingFileKind = (typeof FILE_KINDS)[number];

interface PendingFile {
  tempId: string;
  file: File;
  kind: PendingFileKind;
}

/**
 * Single-page PO create form. Header (vendor + commercial terms +
 * default site + delivery date) + supplier paperwork uploads + inline
 * lines editor + computed totals footer + action buttons.
 *
 * Compliance per psp/CLAUDE.md:
 *   - No Status dropdown / Approved checkbox — workers trigger ACTIONS.
 *   - Computed fields (subtotal, discount_amount, tax_amount, grand_total)
 *     are server-projected; the FE renders them but never sends them.
 *   - Currency = ISO 4217 picker, not free text. Country / part no
 *     pickers follow.
 *   - Files = real uploads to Backend.Storage (PO files endpoint).
 *   - Expected delivery date = computed from vendor lead time, override
 *     toggle.
 *   - Tax rate defaults from vendor.tax_rate; user override allowed but
 *     starts read-only.
 */
interface NewPOFormProps {
  /** Deep-link prefill from the shortages page + reorder-task links.
   *  The page reads the search params server-side and passes them
   *  through so the form can hydrate the prefill on first render
   *  without a Suspense dance around `useSearchParams`. */
  prefillItemUuid?: string | null;
  prefillQty?: string | null;
  /** Numeric vendor id — sets `state.vendorId` on mount. The collab-
   *  resync effect then fetches the vendor row + populates the
   *  currency / tax_rate defaults. Null skips the prefill and the
   *  buyer picks a vendor themselves. */
  prefillVendorId?: string | null;
}

export function NewPOForm({
  prefillItemUuid = null,
  prefillQty = null,
  prefillVendorId = null,
}: NewPOFormProps = {}) {
  const router = useRouter();
  const prefillAppliedRef = useRef(false);
  const resource = "purchase-order:new";
  useFormPresenceBeacon(resource);

  type CommitPayload = { kind: "created"; uuid: string };

  const {
    state,
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
  } = useLiveForm<FormState>({
    resource,
    initialState: INITIAL,
    onCommit: (raw) => {
      const msg = raw as CommitPayload | null;
      if (!msg) return;
      router.push(`/procurement/purchase-orders/${msg.uuid}`);
    },
  });

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{
    detail: string;
    code?: string;
    debug?: ErrorDebug;
  } | null>(null);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  // ── Picker state ────────────────────────────────────────────────────
  // The pickers ARE the source of truth for header + per-row metadata
  // (vendor's currency + lead time, item's code, warehouse name). The
  // FormState mirrors only the integer id + uuid for the submit
  // payload + collab broadcast — peers reload by uuid when they join.
  const [selectedVendor, setSelectedVendor] = useState<VendorOption | null>(
    null,
  );
  const [selectedDefaultWarehouse, setSelectedDefaultWarehouse] =
    useState<WarehouseOption | null>(null);

  // Per-line picker caches keyed by line.tempId. Local React state so
  // they survive line edits without round-tripping the (potentially
  // heavy) option objects through the collab channel.
  const [pickedItems, setPickedItems] = useState<Record<string, ItemOption | null>>(
    {},
  );
  const [pickedLineWarehouses, setPickedLineWarehouses] = useState<
    Record<string, WarehouseOption | null>
  >({});

  const fetchVendorOptions = useCallback(
    async (query: string, signal?: AbortSignal): Promise<VendorOption[]> => {
      // Server-side filter: only approved + active vendors are eligible
      // for a new PO line. Pagination via limit=50.
      const params = new URLSearchParams({
        limit: "50",
        approval_status: "approved",
        is_active: "true",
      });
      if (query) params.set("search", query);
      const res = await fetch(`/api/vendors?${params.toString()}`, { signal });
      if (!res.ok) throw new Error(`Vendor search failed (${res.status})`);
      const body = (await res.json()) as {
        items?: Array<{
          id: number;
          uuid: string;
          name: string;
          code?: string | null;
          currency_code?: string;
          default_lead_time_days?: number;
          approval_status?: string;
          is_active?: boolean;
        }>;
      };
      return (body.items ?? []).map(vendorRowToOption);
    },
    [],
  );

  const fetchItemOptions = useCallback(
    async (query: string, signal?: AbortSignal): Promise<ItemOption[]> => {
      const params = new URLSearchParams({ limit: "50", is_active: "true" });
      if (query) params.set("search", query);
      const res = await fetch(`/api/items?${params.toString()}`, { signal });
      if (!res.ok) throw new Error(`Item search failed (${res.status})`);
      const body = (await res.json()) as {
        items?: Array<{
          id: number;
          uuid: string;
          name: string;
          code?: string | null;
          external_sku?: string | null;
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
        throw new Error(`Warehouse search failed (${res.status})`);
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

  // Collab resync — a peer just picked a vendor, so `state.vendorId`
  // updated via the form channel but our local `selectedVendor` is
  // stale. Refetch by id so the derived UI (currency / lead time /
  // expected-delivery hint) matches.
  useEffect(() => {
    if (!state.vendorId) {
      if (selectedVendor !== null) setSelectedVendor(null);
      return;
    }
    if (selectedVendor?.id === Number(state.vendorId)) return;
    const controller = new AbortController();
    fetch(`/api/vendors/${encodeURIComponent(state.vendorId)}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { vendor?: Parameters<typeof vendorRowToOption>[0] } | null) => {
        if (body?.vendor) setSelectedVendor(vendorRowToOption(body.vendor));
      })
      .catch(() => {
        /* aborted or transient */
      });
    return () => controller.abort();
    // Refetch on id change OR when picker option is stale relative to
    // the broadcasted vendorId.
  }, [state.vendorId, selectedVendor?.id]);

  useEffect(() => {
    if (!state.default_warehouse_id) {
      if (selectedDefaultWarehouse !== null) setSelectedDefaultWarehouse(null);
      return;
    }
    if (
      selectedDefaultWarehouse?.id === Number(state.default_warehouse_id)
    )
      return;
    const controller = new AbortController();
    fetch(`/api/warehouses/${encodeURIComponent(state.default_warehouse_id)}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (body: { warehouse?: { id: number; uuid: string; name: string; code?: string | null } } | null) => {
          if (body?.warehouse) {
            setSelectedDefaultWarehouse({
              id: body.warehouse.id,
              uuid: body.warehouse.uuid,
              label: body.warehouse.name,
              code: body.warehouse.code ?? null,
            });
          }
        },
      )
      .catch(() => {
        /* aborted or transient */
      });
    return () => controller.abort();
  }, [state.default_warehouse_id, selectedDefaultWarehouse?.id]);

  function onPickVendor(opt: VendorOption | null) {
    setSelectedVendor(opt);
    setField("vendorId", opt ? String(opt.id) : "");
    if (opt) setField("currency", opt.currencyCode);
    // tax_rate default is filled server-side from vendor.tax_rate on
    // create. Buyer can override here.
  }

  // ── Computed totals (server is authoritative; we mirror for preview) ─
  const totals = useMemo(() => {
    const subtotal = state.lines.reduce((acc, line) => {
      const qty = parseFloat(line.qty_ordered) || 0;
      const price = parseFloat(line.unit_price) || 0;
      return acc + qty * price;
    }, 0);
    const discount_pct = parseFloat(state.discount_pct) || 0;
    const tax_rate = parseFloat(state.tax_rate) || 0;
    const shipping_fees = parseFloat(state.shipping_fees) || 0;
    const additional_fees = parseFloat(state.additional_fees) || 0;
    const discount_amount = (subtotal * discount_pct) / 100;
    const taxable = subtotal - discount_amount;
    const tax_amount = (taxable * tax_rate) / 100;
    const grand_total =
      subtotal - discount_amount + tax_amount + shipping_fees + additional_fees;
    return {
      subtotal,
      discount_amount,
      tax_amount,
      grand_total,
    };
  }, [
    state.lines,
    state.discount_pct,
    state.tax_rate,
    state.shipping_fees,
    state.additional_fees,
  ]);

  // ── Lines mutation helpers ──────────────────────────────────────────
  function addLine() {
    const next: POLineDraft = {
      tempId: crypto.randomUUID(),
      item_id: "",
      qty_ordered: "",
      unit_price: "",
      vendor_part_no: "",
      warehouse_id: state.default_warehouse_id,
      expected_delivery_date: "",
      notes: "",
      reservations: [],
    };
    setField("lines", [...state.lines, next]);
  }

  /** Add a line pre-filled with an item + qty. Used by:
   *   * Deep-link prefill (`?item_uuid=…&qty=…` from the shortages page)
   *   * "Add" quick-action on the shortage suggestions panel */
  function addLineWithItem(item: ItemOption, qtyOrdered: string) {
    const tempId = crypto.randomUUID();
    const next: POLineDraft = {
      tempId,
      item_id: String(item.id),
      qty_ordered: qtyOrdered,
      unit_price: "",
      vendor_part_no: "",
      warehouse_id: state.default_warehouse_id,
      expected_delivery_date: "",
      notes: "",
      reservations: [],
    };
    setField("lines", [...state.lines, next]);
    setPickedItems((prev) => ({ ...prev, [tempId]: item }));
  }

  // ── Vendor prefill (from reorder-task links) ────────────────────
  // Numeric vendor id lands in `state.vendorId` on mount; the collab-
  // resync effect above then fetches the vendor row and populates
  // currency / tax_rate / lead-time defaults. Idempotent — a peer's
  // vendor pick after mount won't get overwritten because we only
  // set once and gate on `state.vendorId` being empty.
  const vendorPrefillRef = useRef(false);
  useEffect(() => {
    if (vendorPrefillRef.current) return;
    if (!prefillVendorId) return;
    if (state.vendorId) return;
    vendorPrefillRef.current = true;
    setField("vendorId", prefillVendorId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillVendorId]);

  // ── Deep-link prefill (from the shortages page + reorder tasks) ─
  // Reads `?item_uuid=…&qty=…` once on mount. Fetches the item by
  // uuid to populate the picker label, then drops a pre-filled line
  // into state.
  //
  // The ref flips only AFTER the line is committed so React
  // StrictMode's double-mount in dev can't lose the prefill (cleanup
  // would abort the first fetch, second mount re-enters and the ref
  // is still false → fetch retries; once a line lands the ref locks).
  useEffect(() => {
    if (!prefillItemUuid) return;
    if (prefillAppliedRef.current) return;

    let cancelled = false;
    const controller = new AbortController();

    fetch(`/api/items/${encodeURIComponent(prefillItemUuid)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (body: {
          item?: {
            id: number;
            uuid: string;
            name: string;
            code?: string | null;
            external_sku?: string | null;
          };
        } | null) => {
          if (cancelled) return;
          if (!body?.item) return;
          if (prefillAppliedRef.current) return;
          prefillAppliedRef.current = true;
          addLineWithItem(itemRowToOption(body.item), prefillQty ?? "");
        },
      )
      .catch(() => {
        /* aborted or transient — second mount will retry */
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillItemUuid]);

  // ── Shortage suggestions panel ──────────────────────────────────
  // One fetch on mount of the procurement-side shortages list.
  // Cached locally; refresh button on the panel re-runs the fetch.
  const [shortages, setShortages] = useState<ShortageRow[] | null>(null);
  const [shortagesLoading, setShortagesLoading] = useState(true);

  const loadShortages = useCallback(async () => {
    setShortagesLoading(true);
    try {
      const res = await fetch(
        "/api/procurement/shortages?limit=200&sort=shortage_qty:desc",
        { cache: "no-store" },
      );
      if (!res.ok) {
        setShortages([]);
        return;
      }
      const body = (await res.json()) as { items?: ShortageRow[] };
      setShortages(body.items ?? []);
    } catch {
      setShortages([]);
    } finally {
      setShortagesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadShortages();
  }, [loadShortages]);

  // Item ids already on the form's lines — used to gray out the
  // "Add" button in the suggestions panel for items already added.
  const itemIdsOnLines = useMemo(() => {
    const set = new Set<number>();
    for (const l of state.lines) {
      if (l.item_id) set.add(Number(l.item_id));
    }
    return set;
  }, [state.lines]);

  function patchLine(tempId: string, patch: Partial<POLineDraft>) {
    setField(
      "lines",
      state.lines.map((l) => (l.tempId === tempId ? { ...l, ...patch } : l)),
    );
  }

  function removeLine(tempId: string) {
    setField(
      "lines",
      state.lines.filter((l) => l.tempId !== tempId),
    );
    // Drop the per-line picker option caches too so we don't hold a
    // reference to a deleted line.
    setPickedItems((prev) => {
      if (!(tempId in prev)) return prev;
      const next = { ...prev };
      delete next[tempId];
      return next;
    });
    setPickedLineWarehouses((prev) => {
      if (!(tempId in prev)) return prev;
      const next = { ...prev };
      delete next[tempId];
      return next;
    });
  }

  function onItemPick(line: POLineDraft, opt: ItemOption | null) {
    // suggest-price lookup is keyed on (vendor, item, currency) and
    // lives behind `GET /api/purchase-orders/:po/lines/suggest-price` —
    // but on the new form the PO doesn't exist yet. Pre-fill happens
    // on the per-PO add-line dialog AFTER save; here the buyer types
    // the price. (Follow-up: vendor-keyed suggest endpoint.)
    setPickedItems((prev) => ({ ...prev, [line.tempId]: opt }));
    patchLine(line.tempId, { item_id: opt ? String(opt.id) : "" });
  }

  function onLineWarehousePick(
    line: POLineDraft,
    opt: WarehouseOption | null,
  ) {
    setPickedLineWarehouses((prev) => ({ ...prev, [line.tempId]: opt }));
    patchLine(line.tempId, { warehouse_id: opt ? String(opt.id) : "" });
  }

  // ── Files ───────────────────────────────────────────────────────────
  function onPickFiles(input: HTMLInputElement) {
    const list = input.files;
    if (!list) return;
    const next: PendingFile[] = [...pendingFiles];
    for (const f of Array.from(list)) {
      next.push({ tempId: crypto.randomUUID(), file: f, kind: "quote" });
    }
    setPendingFiles(next);
    input.value = "";
  }

  function setPendingFileKind(tempId: string, kind: PendingFileKind) {
    setPendingFiles((prev) =>
      prev.map((p) => (p.tempId === tempId ? { ...p, kind } : p)),
    );
  }

  function removePendingFile(tempId: string) {
    setPendingFiles((prev) => prev.filter((p) => p.tempId !== tempId));
  }

  // ── Validation ──────────────────────────────────────────────────────
  // A line needs an item, a positive qty, a positive price, AND a
  // destination warehouse — the warehouse is what the Goods-In
  // Inspection lands the lot on at sign-off, so missing it means the
  // PO can't actually be received. Mirrors the BE
  // `PurchaseOrderLine.changeset` validate_required.
  const lineValidity = useMemo(() => {
    return state.lines.map((line) => {
      const issues: string[] = [];
      if (!line.item_id) issues.push("item");
      if (!line.qty_ordered || parseFloat(line.qty_ordered) <= 0)
        issues.push("qty");
      if (!line.unit_price || parseFloat(line.unit_price) <= 0)
        issues.push("price");
      // Effective warehouse — the per-line override OR the PO's
      // default. The BE applies the same fallback in
      // `Purchasing.insert_lines_for`, so the FE validates against
      // the resolved value to keep the gate honest.
      const effectiveWarehouse =
        line.warehouse_id || state.default_warehouse_id;
      if (!effectiveWarehouse) issues.push("warehouse");
      return { tempId: line.tempId, issues };
    });
  }, [state.lines, state.default_warehouse_id]);

  const canSaveDraft = Boolean(state.vendorId);
  const canSubmit =
    canSaveDraft &&
    Boolean(state.default_warehouse_id) &&
    state.lines.length > 0 &&
    lineValidity.every((v) => v.issues.length === 0);

  // ── Save flow ───────────────────────────────────────────────────────
  async function performSave(submitAfter: boolean) {
    if (!isCreator) return;
    if (!canSaveDraft) return;
    setError(null);

    startTransition(async () => {
      const header: POHeaderInput = {
        vendor_id: Number(state.vendorId),
        currency_code: state.currency,
        expected_delivery_date: state.expected_delivery_date || null,
        delivery_address: state.delivery_address.trim() || null,
        notes: null,
        // Financial fields are NOT NULL at the DB level (default 0) —
        // send "0" rather than null when blank.
        discount_pct: state.discount_pct || "0",
        tax_rate: state.tax_rate || "0",
        shipping_fees: state.shipping_fees || "0",
        additional_fees: state.additional_fees || "0",
        default_warehouse_id: state.default_warehouse_id
          ? Number(state.default_warehouse_id)
          : null,
      };
      const lines: POLineInput[] = state.lines.map((l) => {
        // Strip empty / zero reservations — keeps the BE FIFO
        // fallback alive when the planner left the picker untouched.
        const effectiveReservations = (l.reservations ?? [])
          .map((r) => ({ mo_uuid: r.mo_uuid, qty: r.qty.trim() }))
          .filter((r) => r.mo_uuid && r.qty && parseFloat(r.qty) > 0);

        return {
          item_id: Number(l.item_id),
          qty_ordered: l.qty_ordered,
          unit_price: l.unit_price,
          warehouse_id: l.warehouse_id ? Number(l.warehouse_id) : null,
          expected_delivery_date: l.expected_delivery_date || null,
          vendor_part_no: l.vendor_part_no.trim() || null,
          notes: l.notes.trim() || null,
          reservations:
            effectiveReservations.length > 0 ? effectiveReservations : undefined,
        };
      });

      const createRes = await createPOWithLinesAction(header, lines);
      if (!createRes.ok) {
        setError({
          detail: createRes.detail,
          code: createRes.code,
          debug: createRes.debug,
        });
        return;
      }

      const po = createRes.po;

      // Upload pending files one at a time so progress is visible.
      if (pendingFiles.length > 0) {
        for (let i = 0; i < pendingFiles.length; i++) {
          const pf = pendingFiles[i]!;
          setUploadProgress(
            `Uploading ${i + 1} of ${pendingFiles.length} (${pf.file.name})…`,
          );
          const fd = new FormData();
          fd.append("file", pf.file);
          fd.append("kind", pf.kind);
          const upRes = await uploadPOFileAction(po.uuid, fd);
          if (!upRes.ok) {
            setUploadProgress(null);
            // Partial success — the PO exists, the rest of the files
            // can be uploaded from the detail page. Surface the issue.
            toast.error(`File "${pf.file.name}" failed: ${upRes.detail}`);
          }
        }
        setUploadProgress(null);
      }

      if (submitAfter) {
        const subRes = await submitPOAction(po.uuid);
        if (!subRes.ok) {
          toast.error(`Saved as draft, but submit failed: ${subRes.detail}`);
          broadcastCommit({ kind: "created", uuid: po.uuid });
          router.push(`/procurement/purchase-orders/${po.uuid}`);
          return;
        }
        toast.success("PO submitted for approval", {
          description: `Code ${po.code ?? `#${po.id}`}`,
        });
      } else {
        toast.success("PO saved as draft", {
          description: `Code ${po.code ?? `#${po.id}`}`,
        });
      }

      broadcastCommit({ kind: "created", uuid: po.uuid });
      router.push(`/procurement/purchase-orders/${po.uuid}`);
    });
  }

  // ── Cursor anchor ───────────────────────────────────────────────────
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

  return (
    <div
      ref={cursorAnchorRef}
      onMouseMove={onCursorMove}
      onMouseLeave={hideCursor}
      className="relative space-y-5"
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

      <ActionBar
        position="top"
        canSaveDraft={canSaveDraft}
        canSubmit={canSubmit}
        isCreator={isCreator}
        creator={creator?.name}
        pending={pending}
        uploadStatus={uploadProgress}
        peers={presence}
        onCancel={() => router.push("/procurement/purchase-orders")}
        onSaveDraft={() => performSave(false)}
        onSubmit={() => performSave(true)}
      />

      {error && (
        <ErrorBanner
          detail={error.detail}
          code={error.code}
          debug={error.debug}
        />
      )}

      {/* SECTION 1: vendor + commercial terms */}
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="size-4 text-muted-foreground" />
            Vendor + commercial terms
          </CardTitle>
          <CardDescription className="text-xs">
            Currency, tax rate, and lead time are pulled from the vendor
            record. Override the auto-derived expected delivery date
            only if the supplier confirmed a different date.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label
              htmlFor="vendorId"
              className="text-[11px] uppercase tracking-wider text-muted-foreground"
            >
              Vendor *
            </Label>
            <div className="relative">
              <SearchPicker<VendorOption>
                id="vendorId"
                fetcher={fetchVendorOptions}
                value={selectedVendor}
                onChange={onPickVendor}
                onFocus={() => focusField("vendorId")}
                onBlur={() => blurField("vendorId")}
                placeholder="Search approved vendors by name or code…"
                emptyHint="No approved vendors match. Approve one first."
              />
              <FieldEditingIndicator peer={fieldEditors.vendorId} />
            </div>
            {selectedVendor && (
              <p className="text-[11px] text-muted-foreground">
                Lead time {selectedVendor.defaultLeadTimeDays}d · Currency{" "}
                {selectedVendor.currencyCode}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="currency"
              className="text-[11px] uppercase tracking-wider text-muted-foreground"
            >
              Currency
            </Label>
            <div className="relative">
              <CurrencyPicker
                id="currency"
                value={state.currency}
                onChange={(v) => setField("currency", v ?? "GBP")}
                onFocus={() => focusField("currency")}
                onBlur={() => blurField("currency")}
              />
              <FieldEditingIndicator peer={fieldEditors.currency} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="tax_rate"
              className="text-[11px] uppercase tracking-wider text-muted-foreground"
            >
              Tax rate (%)
            </Label>
            <div className="relative">
              <Input
                id="tax_rate"
                type="text"
                inputMode="decimal"
                placeholder="20"
                value={state.tax_rate}
                onChange={(e) => setField("tax_rate", e.target.value)}
                onFocus={() => focusField("tax_rate")}
                onBlur={() => blurField("tax_rate")}
                className="font-mono"
              />
              <FieldEditingIndicator peer={fieldEditors.tax_rate} />
            </div>
            <p className="text-[10px] text-muted-foreground">
              Defaults from the vendor.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="expected_delivery_date"
              className="text-[11px] uppercase tracking-wider text-muted-foreground"
            >
              Expected delivery
            </Label>
            <div className="relative">
              <DerivedDateField
                id="expected_delivery_date"
                computed={
                  selectedVendor
                    ? addDaysFromToday(selectedVendor.defaultLeadTimeDays)
                    : ""
                }
                value={state.expected_delivery_date}
                onChange={(v) => setField("expected_delivery_date", v)}
                onFocus={() => focusField("expected_delivery_date")}
                onBlur={() => blurField("expected_delivery_date")}
                derivationHint={
                  selectedVendor
                    ? `Today + ${selectedVendor.defaultLeadTimeDays}d lead time`
                    : "Pick a vendor"
                }
                reasonComputedMissing="Pick a vendor above to compute."
              />
              <FieldEditingIndicator peer={fieldEditors.expected_delivery_date} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="default_warehouse_id"
              className="text-[11px] uppercase tracking-wider text-muted-foreground"
            >
              Default delivery site
            </Label>
            <div className="relative">
              <SearchPicker<WarehouseOption>
                id="default_warehouse_id"
                fetcher={fetchWarehouseOptions}
                value={selectedDefaultWarehouse}
                onChange={(opt) => {
                  setSelectedDefaultWarehouse(opt);
                  setField("default_warehouse_id", opt ? String(opt.id) : "");
                }}
                onFocus={() => focusField("default_warehouse_id")}
                onBlur={() => blurField("default_warehouse_id")}
                placeholder="Search warehouses…"
                emptyHint="No warehouses match."
              />
              <FieldEditingIndicator peer={fieldEditors.default_warehouse_id} />
            </div>
            <p className="text-[10px] text-muted-foreground">
              Lines without an override deliver here.
            </p>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label
              htmlFor="delivery_address"
              className="text-[11px] uppercase tracking-wider text-muted-foreground"
            >
              Delivery address (optional, overrides site address)
            </Label>
            <div className="relative">
              <Textarea
                id="delivery_address"
                rows={2}
                value={state.delivery_address}
                onChange={(e) => setField("delivery_address", e.target.value)}
                onFocus={() => focusField("delivery_address")}
                onBlur={() => blurField("delivery_address")}
              />
              <FieldEditingIndicator peer={fieldEditors.delivery_address} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SECTION 2: supplier paperwork (file uploads) */}
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4 text-muted-foreground" />
            Supplier paperwork
          </CardTitle>
          <CardDescription className="text-xs">
            Upload the vendor's quote PDF, spec sheet, or any other PO
            evidence the auditor will ask for. Files land on our server,
            not as external links.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {pendingFiles.length === 0 ? (
            <p className="rounded-md border border-dashed border-border/60 px-4 py-6 text-center text-xs text-muted-foreground">
              No files yet. Files upload after you save the PO so the
              backend has a record to attach them to.
            </p>
          ) : (
            <ul className="divide-y divide-border/60 rounded-md border border-border/60">
              {pendingFiles.map((pf) => (
                <li
                  key={pf.tempId}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <Paperclip className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {pf.file.name}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {(pf.file.size / 1024).toFixed(1)} KB · {pf.file.type || "unknown"}
                    </p>
                  </div>
                  <Select
                    value={pf.kind}
                    onValueChange={(v) =>
                      setPendingFileKind(pf.tempId, v as PendingFileKind)
                    }
                  >
                    <SelectTrigger className="h-8 w-32 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FILE_KINDS.map((k) => (
                        <SelectItem key={k} value={k} className="capitalize">
                          {k}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <button
                    type="button"
                    onClick={() => removePendingFile(pf.tempId)}
                    className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                    aria-label="Remove"
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border/60 bg-card px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/50">
            <Upload className="size-3.5" />
            Add files
            <input
              type="file"
              multiple
              className="sr-only"
              onChange={(e) => onPickFiles(e.target as HTMLInputElement)}
            />
          </label>
        </CardContent>
      </Card>

      {/* SECTION 2b: suggested shortages — quick-add items still
          short across open MOs so procurement can build a multi-line
          PO without bouncing back to the shortages page. */}
      <ShortageSuggestions
        rows={shortages ?? []}
        loading={shortagesLoading}
        itemIdsOnLines={itemIdsOnLines}
        onAdd={(row) =>
          addLineWithItem(
            {
              id: row.item?.id ?? 0,
              uuid: row.item?.uuid ?? "",
              label: row.item?.name ?? "Item",
              code: null,
              externalSku: null,
            },
            row.shortage_qty,
          )
        }
        onRefresh={() => void loadShortages()}
      />

      {/* SECTION 3: lines editor */}
      <Card className="border-border/60">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2 text-base">
                <Package className="size-4 text-muted-foreground" />
                Lines
              </CardTitle>
              <CardDescription className="text-xs">
                Unit price pre-fills from the last paid for this
                (vendor, item, currency). A ±20% deviation flags amber —
                non-blocking but worth a second look.
              </CardDescription>
            </div>
            <span className="text-[11px] font-mono text-muted-foreground">
              {state.lines.length} lines
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {state.lines.length === 0 && (
            <p className="rounded-md border border-dashed border-border/60 px-4 py-6 text-center text-xs text-muted-foreground">
              No lines yet. Click "Add line" to start.
            </p>
          )}
          {state.lines.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-border/60">
              <table className="min-w-[1000px] text-sm">
                <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="w-8 px-2 py-2 text-left">#</th>
                    <th className="px-2 py-2 text-left">Item *</th>
                    <th className="px-2 py-2 text-left">Vendor part no.</th>
                    <th className="w-24 px-2 py-2 text-right">Qty *</th>
                    <th className="w-32 px-2 py-2 text-right">Unit price *</th>
                    <th className="w-32 px-2 py-2 text-right">Subtotal</th>
                    <th className="w-44 px-2 py-2 text-left">Site (override)</th>
                    <th className="w-40 px-2 py-2 text-left">Expected (override)</th>
                    <th className="w-8 px-2 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {state.lines.map((line, i) => {
                    const item = pickedItems[line.tempId] ?? null;
                    const lineWarehouse =
                      pickedLineWarehouses[line.tempId] ?? null;
                    const qty = parseFloat(line.qty_ordered) || 0;
                    const price = parseFloat(line.unit_price) || 0;
                    const subtotal = qty * price;
                    const validity = lineValidity.find(
                      (v) => v.tempId === line.tempId,
                    );
                    const deviation = priceDeviation(
                      line.unit_price,
                      line.last_paid_price,
                    );
                    return [
                      <tr
                        key={line.tempId}
                        className={cn(
                          "align-top",
                          validity?.issues.length &&
                            "bg-destructive/[0.02]",
                        )}
                      >
                        <td className="px-2 py-2 text-xs font-mono text-muted-foreground">
                          {i + 1}
                        </td>
                        <td className="px-2 py-2">
                          <SearchPicker<ItemOption>
                            fetcher={fetchItemOptions}
                            value={item}
                            onChange={(opt) => onItemPick(line, opt)}
                            placeholder="Search items…"
                            emptyHint="No active items match."
                            compact
                          />
                          {item && (
                            <p className="mt-0.5 text-[10px] font-mono text-muted-foreground">
                              {item.code ?? item.externalSku ?? `#${item.id}`}
                            </p>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <Input
                            value={line.vendor_part_no}
                            onChange={(e) =>
                              patchLine(line.tempId, {
                                vendor_part_no: e.target.value,
                              })
                            }
                            placeholder="—"
                            className="h-9 font-mono text-xs"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <Input
                            type="text"
                            inputMode="decimal"
                            value={line.qty_ordered}
                            onChange={(e) =>
                              patchLine(line.tempId, {
                                qty_ordered: e.target.value,
                              })
                            }
                            placeholder="Qty"
                            aria-label={`Line ${i + 1} quantity`}
                            className="h-9 text-right font-mono text-xs"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <Input
                            type="text"
                            inputMode="decimal"
                            value={line.unit_price}
                            onChange={(e) =>
                              patchLine(line.tempId, {
                                unit_price: e.target.value,
                              })
                            }
                            placeholder="Price"
                            aria-label={`Line ${i + 1} unit price`}
                            className="h-9 text-right font-mono text-xs"
                          />
                          {line.last_paid_price && (
                            <p
                              className={cn(
                                "mt-0.5 flex items-center justify-end gap-1 text-[10px]",
                                deviation && deviation.abs >= 20
                                  ? "text-amber-600"
                                  : "text-muted-foreground",
                              )}
                              title={`Last paid ${line.last_paid_price} on ${line.last_paid_at?.slice(0, 10)}`}
                            >
                              {deviation && deviation.abs >= 20 && (
                                <AlertTriangle className="size-3" />
                              )}
                              Last {line.last_paid_price}
                              {deviation &&
                                ` (${deviation.sign}${deviation.abs.toFixed(0)}%)`}
                            </p>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-xs">
                          {subtotal.toFixed(2)}
                        </td>
                        <td className="px-2 py-2">
                          <SearchPicker<WarehouseOption>
                            fetcher={fetchWarehouseOptions}
                            value={lineWarehouse}
                            onChange={(opt) => onLineWarehousePick(line, opt)}
                            placeholder="Use PO default"
                            emptyHint="No warehouses match."
                            compact
                          />
                        </td>
                        <td className="px-2 py-2">
                          <Input
                            type="date"
                            value={line.expected_delivery_date}
                            onChange={(e) =>
                              patchLine(line.tempId, {
                                expected_delivery_date: e.target.value,
                              })
                            }
                            className="h-9 text-xs"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            onClick={() => removeLine(line.tempId)}
                            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                            aria-label="Remove line"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </td>
                      </tr>,
                      // Sub-row: per-MO reservation picker. Renders only
                      // when this line's item has dependent MOs in the
                      // shortage feed AND the buyer has typed a qty.
                      // Default is empty (BE falls back to auto-FIFO).
                      <ReservationPickerRow
                        key={`${line.tempId}-reservations`}
                        line={line}
                        item={item}
                        shortages={shortages ?? []}
                        onChange={(reservations) =>
                          patchLine(line.tempId, { reservations })
                        }
                      />,
                    ];
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addLine}
            disabled={!isCreator}
          >
            <Plus className="mr-1.5 size-4" />
            Add line
          </Button>
        </CardContent>
      </Card>

      {/* SECTION 4: totals footer */}
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base">Totals</CardTitle>
          <CardDescription className="text-xs">
            Discount, tax, and grand total are the FE's preview — the
            backend recomputes them on save so the PO record is the
            source of truth.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2.5">
          <Row label="Lines subtotal" value={fmtMoney(totals.subtotal)} mono />
          <RowEditable
            label="Discount (%)"
            id="discount_pct"
            value={state.discount_pct}
            onChange={(v) => setField("discount_pct", v)}
            onFocus={() => focusField("discount_pct")}
            onBlur={() => blurField("discount_pct")}
            suffix={`− ${fmtMoney(totals.discount_amount)}`}
            placeholder="0"
          />
          <Row
            label={`Tax (${state.tax_rate || "0"}%)`}
            value={`+ ${fmtMoney(totals.tax_amount)}`}
            mono
          />
          <RowEditable
            label="Shipping fees"
            id="shipping_fees"
            value={state.shipping_fees}
            onChange={(v) => setField("shipping_fees", v)}
            onFocus={() => focusField("shipping_fees")}
            onBlur={() => blurField("shipping_fees")}
            placeholder="0.00"
          />
          <RowEditable
            label="Additional fees"
            id="additional_fees"
            value={state.additional_fees}
            onChange={(v) => setField("additional_fees", v)}
            onFocus={() => focusField("additional_fees")}
            onBlur={() => blurField("additional_fees")}
            placeholder="0.00"
          />
          <div className="mt-2 flex items-baseline justify-between border-t border-border/60 pt-3">
            <span className="text-sm font-semibold">Grand total</span>
            <span className="font-mono text-xl font-bold">
              {fmtMoney(totals.grand_total)}
            </span>
          </div>
        </CardContent>
      </Card>

      <ActionBar
        position="bottom"
        canSaveDraft={canSaveDraft}
        canSubmit={canSubmit}
        isCreator={isCreator}
        creator={creator?.name}
        pending={pending}
        uploadStatus={uploadProgress}
        peers={null}
        onCancel={() => router.push("/procurement/purchase-orders")}
        onSaveDraft={() => performSave(false)}
        onSubmit={() => performSave(true)}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────

function ActionBar({
  position,
  canSaveDraft,
  canSubmit,
  isCreator,
  creator,
  pending,
  uploadStatus,
  peers,
  onCancel,
  onSaveDraft,
  onSubmit,
}: {
  position: "top" | "bottom";
  canSaveDraft: boolean;
  canSubmit: boolean;
  isCreator: boolean;
  creator: string | null | undefined;
  pending: boolean;
  uploadStatus: string | null;
  peers: import("@/lib/realtime/use-live-form").CollabPeer[] | null;
  onCancel: () => void;
  onSaveDraft: () => void;
  onSubmit: () => void;
}) {
  return (
    <div
      className={cn(
        "z-20 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/95 px-4 py-3 shadow-sm backdrop-blur",
        position === "top" ? "sticky top-2" : "",
      )}
    >
      <div className="flex items-center gap-3">
        {peers && <CollabAvatars peers={peers} />}
        {!isCreator && creator && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3.5" />
            Only{" "}
            <span className="font-medium text-foreground">{creator}</span>{" "}
            can save / submit. Your edits sync live.
          </span>
        )}
        {uploadStatus && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            {uploadStatus}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onSaveDraft}
          disabled={!isCreator || !canSaveDraft || pending}
          title={
            !isCreator && creator
              ? `Only ${creator} can save from this room.`
              : undefined
          }
        >
          {pending ? (
            <Loader2 className="mr-1.5 size-4 animate-spin" />
          ) : (
            <Save className="mr-1.5 size-4" />
          )}
          Save as draft
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onSubmit}
          disabled={!isCreator || !canSubmit || pending}
          title={
            !canSubmit
              ? "Pick a vendor, a delivery warehouse, and at least one valid line (with item + qty + price + destination warehouse) first."
              : undefined
          }
        >
          {pending ? (
            <Loader2 className="mr-1.5 size-4 animate-spin" />
          ) : (
            <Send className="mr-1.5 size-4" />
          )}
          Submit for approval
        </Button>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-sm",
          mono && "font-mono",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function RowEditable({
  label,
  id,
  value,
  onChange,
  onFocus,
  onBlur,
  placeholder,
  suffix,
}: {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  placeholder?: string;
  suffix?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label
        htmlFor={id}
        className="text-xs text-muted-foreground"
      >
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder={placeholder}
          className="h-8 w-24 text-right font-mono text-xs"
        />
        {suffix && (
          <span className="font-mono text-xs text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
    </div>
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
      tone: "amber" as const,
      title: "Form is at capacity",
      detail: error.limit
        ? `Up to ${error.limit} people can draft this PO at once.`
        : "Wait for someone to leave, then refresh.",
    },
    forbidden: {
      icon: LockKeyhole,
      tone: "muted" as const,
      title: "You can't draft a PO here",
      detail: "Ask an admin for the `procurement.po_create` permission.",
    },
    bad_topic: {
      icon: AlertCircle,
      tone: "destructive" as const,
      title: "Unknown form",
      detail: "Reload the page.",
    },
    unknown: {
      icon: AlertCircle,
      tone: "destructive" as const,
      title: "Couldn't open the form",
      detail: "Something went wrong on our end.",
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

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function fmtMoney(n: number): string {
  return n.toFixed(2);
}

function priceDeviation(
  proposed: string,
  lastPaid: string | null | undefined,
): { sign: "+" | "−"; abs: number } | null {
  const p = parseFloat(proposed);
  const last = parseFloat(lastPaid ?? "");
  if (!Number.isFinite(p) || !Number.isFinite(last) || last === 0) return null;
  const pct = ((p - last) / last) * 100;
  return {
    sign: pct >= 0 ? "+" : "−",
    abs: Math.abs(pct),
  };
}

/** Shape one vendor row off `/api/vendors?...` into the picker option
 *  the form reads metadata off (lead time, currency_code). */
function vendorRowToOption(v: {
  id: number;
  uuid: string;
  name: string;
  code?: string | null;
  currency_code?: string;
  default_lead_time_days?: number;
  approval_status?: string;
  is_active?: boolean;
}): VendorOption {
  return {
    id: v.id,
    uuid: v.uuid,
    label: v.name,
    code: v.code ?? null,
    currencyCode: v.currency_code ?? "GBP",
    defaultLeadTimeDays: v.default_lead_time_days ?? 0,
    isApproved: v.approval_status === "approved",
    isActive: v.is_active !== false,
  };
}

/** Shape one item row off `/api/items?...` into the picker option the
 *  per-line row reads off (item code / external SKU). */
function itemRowToOption(i: {
  id: number;
  uuid: string;
  name: string;
  code?: string | null;
  external_sku?: string | null;
}): ItemOption {
  return {
    id: i.id,
    uuid: i.uuid,
    label: i.name,
    code: i.code ?? i.external_sku ?? null,
    externalSku: i.external_sku ?? null,
  };
}

/**
 * Per-line sub-row that lets procurement reserve the new PO line's
 * qty against specific MOs. Renders inline under the line row when
 * the item is in the shortages feed with dependent MOs. Left empty
 * → BE falls back to auto-FIFO (earliest planned_start wins). Any
 * qty filled → BE creates placeholder bookings exactly per spec.
 */
function ReservationPickerRow({
  line,
  item,
  shortages,
  onChange,
}: {
  line: POLineDraft;
  item: ItemOption | null;
  shortages: ShortageRow[];
  onChange: (next: POLineDraftReservation[]) => void;
}) {
  const shortage = useMemo(() => {
    if (!item) return null;
    return shortages.find((r) => r.item?.id === item.id) ?? null;
  }, [item, shortages]);

  const deps = shortage?.dependent_mos ?? [];

  // Auto-expand when the planner already set something — otherwise
  // the picker stays collapsed so a 200-MO list doesn't drop into
  // the DOM by default. The collapse rule is the primary perf knob:
  // visible MO rows are bounded by user intent.
  const hasReservations = (line.reservations ?? []).length > 0;
  const [expanded, setExpanded] = useState(hasReservations);
  const [search, setSearch] = useState("");

  // Re-open if external state added reservations (e.g. deep-link).
  useEffect(() => {
    if (hasReservations) setExpanded(true);
  }, [hasReservations]);

  if (!item || deps.length === 0) return null;

  const orderedQty = parseFloat(line.qty_ordered) || 0;
  const reservedTotal = (line.reservations ?? []).reduce(
    (acc, r) => acc + (parseFloat(r.qty) || 0),
    0,
  );
  const autoLeft = Math.max(orderedQty - reservedTotal, 0);
  const reservedQty = reservedTotal;
  const over = reservedTotal > orderedQty + 1e-6;

  function qtyFor(moUuid: string): string {
    return line.reservations.find((r) => r.mo_uuid === moUuid)?.qty ?? "";
  }

  function patchReservation(moUuid: string, qty: string) {
    const others = (line.reservations ?? []).filter((r) => r.mo_uuid !== moUuid);
    const trimmed = qty.trim();
    if (trimmed === "" || parseFloat(trimmed) <= 0) {
      onChange(others);
    } else {
      onChange([...others, { mo_uuid: moUuid, qty: trimmed }]);
    }
  }

  function autoSplit() {
    // Even-cap: walk MOs in planned_start order, drop the full MO qty
    // onto each until the line runs out. (Mirrors the BE FIFO default
    // — but visible so the planner sees what would happen and can
    // tweak.)
    let remaining = orderedQty;
    const next: POLineDraftReservation[] = [];
    for (const m of deps) {
      if (remaining <= 0) break;
      const cap = parseFloat(m.quantity) || 0;
      const give = Math.min(cap, remaining);
      if (give > 0) {
        next.push({ mo_uuid: m.uuid, qty: String(give) });
        remaining -= give;
      }
    }
    onChange(next);
    setExpanded(true);
  }

  function clearAll() {
    onChange([]);
  }

  const tone = over
    ? "text-destructive"
    : reservedQty === 0
      ? "text-muted-foreground"
      : "text-foreground";

  // Filter + cap visible MOs. Reservations always render so the
  // planner doesn't lose sight of what they already set when the
  // search hides everything else.
  const needle = search.trim().toLowerCase();
  const reservedUuids = new Set(line.reservations.map((r) => r.mo_uuid));

  const matchesSearch = (m: ShortageDependentMo) => {
    if (!needle) return true;
    return (
      (m.code ?? "").toLowerCase().includes(needle) ||
      (m.item_name ?? "").toLowerCase().includes(needle)
    );
  };

  const filtered = deps.filter(matchesSearch);
  const pinned = deps.filter((m) => reservedUuids.has(m.uuid));
  const cap = 20;
  const visible = (() => {
    if (filtered.length <= cap) return filtered;
    const remaining = filtered.filter((m) => !reservedUuids.has(m.uuid));
    return [...pinned, ...remaining.slice(0, Math.max(cap - pinned.length, 0))];
  })();
  const hidden = filtered.length - visible.length;

  // Compact / collapsed strip — no MO list in the DOM, just a
  // single-line summary + the FIFO toggle + Override link. Keeps
  // the picker invisible-by-default at scale.
  if (!expanded) {
    return (
      <tr className="bg-muted/10">
        <td colSpan={9} className="px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/40 bg-card px-3 py-1.5 text-[11px]">
            <span className="text-muted-foreground">
              <span className="font-mono font-medium text-foreground">
                Reserve for MOs:
              </span>{" "}
              {deps.length} waiting · auto-FIFO will distribute by earliest
              planned start
            </span>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="rounded border border-border/60 px-2 py-0.5 hover:bg-muted"
            >
              Override
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="bg-muted/10">
      <td colSpan={9} className="px-3 py-2.5">
        <div className="space-y-2 rounded-md border border-border/40 bg-card p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Reserve for MOs ({deps.length} waiting)
            </p>
            <div className="flex items-center gap-2 text-[11px]">
              <span className={cn("font-mono", tone)}>
                {reservedQty.toLocaleString()} reserved
              </span>
              <span className="text-muted-foreground">
                · {autoLeft.toLocaleString()} auto-FIFO
                {orderedQty > 0 && ` of ${orderedQty.toLocaleString()}`}
              </span>
              <button
                type="button"
                onClick={autoSplit}
                className="rounded border border-border/60 px-1.5 py-0.5 text-[11px] hover:bg-muted"
              >
                Fill FIFO
              </button>
              {reservedQty > 0 && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="rounded border border-border/60 px-1.5 py-0.5 text-[11px] hover:bg-muted"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="rounded border border-border/60 px-1.5 py-0.5 text-[11px] hover:bg-muted"
                title="Collapse the picker — reservations stay set."
              >
                Collapse
              </button>
            </div>
          </div>

          {deps.length > 8 && (
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${deps.length} waiting MOs by code or item…`}
              className="h-7 text-[11px]"
            />
          )}

          <table className="w-full text-[11px]">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border/40">
                <th className="px-1 py-1 text-left font-medium">MO</th>
                <th className="px-1 py-1 text-left font-medium">Item</th>
                <th className="px-1 py-1 text-right font-medium">MO qty</th>
                <th className="px-1 py-1 text-left font-medium">Planned</th>
                <th className="w-28 px-1 py-1 text-right font-medium">
                  Reserve
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((m) => (
                <tr key={m.uuid} className="border-b border-border/20">
                  <td className="px-1 py-1 font-mono text-[10px]">
                    {m.code ?? m.uuid.slice(0, 8)}
                  </td>
                  <td className="truncate px-1 py-1 text-muted-foreground">
                    {m.item_name}
                  </td>
                  <td className="px-1 py-1 text-right font-mono">
                    {m.quantity}
                  </td>
                  <td className="px-1 py-1 text-muted-foreground">
                    {m.planned_start
                      ? new Date(m.planned_start).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="px-1 py-1 text-right">
                    <Input
                      value={qtyFor(m.uuid)}
                      onChange={(e) => patchReservation(m.uuid, e.target.value)}
                      placeholder="0"
                      inputMode="decimal"
                      className="h-7 text-right text-[11px]"
                    />
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-1 py-3 text-center text-[11px] text-muted-foreground"
                  >
                    No MOs match the search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {hidden > 0 && (
            <p className="text-[11px] text-muted-foreground">
              +{hidden} more MOs hidden — refine the search to find a specific
              one. Anything left out gets auto-FIFO at submit time.
            </p>
          )}
          {over && (
            <p className="text-[11px] text-destructive">
              Reserved more than the ordered qty. The server will clamp the
              overflow.
            </p>
          )}
        </div>
      </td>
    </tr>
  );
}

/**
 * Quick-add panel for items still short across open MOs. Sits above
 * the lines editor on the New PO page so procurement can build a
 * multi-line order without bouncing back to /procurement/shortages.
 *
 * One row per shortage; "Add" button drops a pre-filled line into the
 * form (item + shortage qty). Items already on the form's lines show
 * a "On PO" badge instead of the Add button so the same row can't be
 * added twice.
 */
function ShortageSuggestions({
  rows,
  loading,
  itemIdsOnLines,
  onAdd,
  onRefresh,
}: {
  rows: ShortageRow[];
  loading: boolean;
  itemIdsOnLines: Set<number>;
  onAdd: (row: ShortageRow) => void;
  onRefresh: () => void;
}) {
  const visible = rows.slice(0, 12);
  const hidden = Math.max(rows.length - visible.length, 0);

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-amber-600" />
              Shortages — suggested items
            </CardTitle>
            <CardDescription className="text-xs">
              Items still short across open MOs after subtracting
              bookings and qty on other open POs. Click <b>Add</b> to
              drop a pre-filled line into this PO.
            </CardDescription>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onRefresh}
            disabled={loading}
            className="h-8 text-[11px]"
          >
            {loading ? "Loading…" : "Refresh"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading && rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/60 px-4 py-4 text-center text-xs text-muted-foreground">
            Loading shortages…
          </p>
        ) : rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/60 px-4 py-4 text-center text-xs text-muted-foreground">
            Nothing short right now. Every open MO has its booked or
            on-order qty covered.
          </p>
        ) : (
          <ul className="divide-y divide-border/40 rounded-md border border-border/60">
            {visible.map((row) => {
              const onPO = row.item ? itemIdsOnLines.has(row.item.id) : false;
              const uom = row.item?.stock_uom?.symbol ?? "";
              return (
                <li
                  key={row.item?.id ?? row.item?.uuid ?? row.shortage_qty}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="truncate text-sm font-medium">
                      {row.item?.name ?? "Unknown item"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Short by{" "}
                      <span className="font-mono font-semibold text-red-700 dark:text-red-300">
                        {row.shortage_qty} {uom}
                      </span>
                      {Number(row.expecting_qty) > 0 && (
                        <span className="ml-2">
                          ·{" "}
                          <span className="text-sky-700 dark:text-sky-300">
                            {row.expecting_qty} {uom} on open PO
                          </span>
                        </span>
                      )}
                      {row.dependent_mos.length > 0 && (
                        <span className="ml-2">
                          · {row.dependent_mos.length} MO
                          {row.dependent_mos.length === 1 ? "" : "s"} waiting
                        </span>
                      )}
                    </p>
                  </div>
                  {onPO ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                      On this PO
                    </span>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px]"
                      onClick={() => onAdd(row)}
                      disabled={!row.item}
                    >
                      <Plus className="mr-1 size-3" />
                      Add
                    </Button>
                  )}
                </li>
              );
            })}
            {hidden > 0 && (
              <li className="px-3 py-2 text-center text-[11px] text-muted-foreground">
                +{hidden} more on{" "}
                <a href="/procurement/shortages" className="underline">
                  the full shortages list
                </a>
              </li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
