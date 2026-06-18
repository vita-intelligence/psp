"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  Factory,
  Loader2,
  Lock,
  LockKeyhole,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FieldError } from "@/components/forms/field-error";
import { ErrorBanner } from "@/components/forms/error-banner";
import { CollabAvatars } from "@/components/realtime/collab-avatars";
import { FieldEditingIndicator } from "@/components/realtime/field-editing-indicator";
import { RemoteCursor } from "@/components/realtime/remote-cursor";
import {
  SearchPicker,
  type SearchPickerOption,
} from "@/components/forms/search-picker";
import type { CompanyDefaults, Item } from "@/lib/types";
import type { FieldErrors } from "@/lib/auth/actions";
import type { ErrorResult } from "@/lib/errors/server";
import { cn } from "@/lib/utils";
import { useLiveForm } from "@/lib/realtime/use-live-form";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import { invalidateAudit } from "@/lib/audit/invalidator";
import { formatCompanyMoney } from "@/lib/format/company";
import {
  createManufacturingOrderAction,
  deleteManufacturingOrderAction,
  updateManufacturingOrderAction,
} from "@/lib/production/actions";
import type {
  BOMSummary,
  ManufacturingOrder,
  ManufacturingOrderUpsertInput,
} from "@/lib/production/types";

interface SiteOption extends SearchPickerOption {
  kind: string;
}

interface ItemOption extends SearchPickerOption {
  uuid: string;
}

interface BOMOption extends SearchPickerOption {
  uuid: string;
  itemId: number;
  isPrimary: boolean;
}

interface UserOption extends SearchPickerOption {
  email: string;
  uuid: string;
}

interface FormState {
  site: SiteOption | null;
  product: ItemOption | null;
  bom: BOMOption | null;
  quantity: string;
  due_date: string;
  expiry_date: string;
  assigned_to: UserOption | null;
  revision: string;
  notes: string;
}

interface Props {
  mo: ManufacturingOrder | null;
  company: CompanyDefaults;
  canEdit: boolean;
  canDelete: boolean;
  /** Optional callback fired after a successful save / create. The
   *  EditModeToggle wrapper passes a `setView()` here so the page
   *  flips back to view mode after the form commits. */
  onSavedSuccess?: () => void;
}

function initialFrom(mo: ManufacturingOrder | null): FormState {
  if (!mo) {
    return {
      site: null,
      product: null,
      bom: null,
      quantity: "",
      due_date: "",
      expiry_date: "",
      assigned_to: null,
      revision: "V00",
      notes: "",
    };
  }
  return {
    site: mo.warehouse
      ? {
          id: mo.warehouse.id,
          label: mo.warehouse.name,
          code: mo.warehouse.code,
          kind: mo.warehouse.kind,
        }
      : null,
    product: mo.item
      ? { id: mo.item.id, uuid: mo.item.uuid, label: mo.item.name, code: mo.item.code }
      : null,
    bom: mo.bom
      ? {
          id: mo.bom.id,
          uuid: mo.bom.uuid,
          label: mo.bom.name,
          code: mo.bom.code,
          itemId: mo.bom.item?.id ?? 0,
          isPrimary: mo.bom.is_primary,
        }
      : null,
    quantity: mo.quantity,
    due_date: mo.due_date ?? "",
    expiry_date: mo.expiry_date ?? "",
    assigned_to: mo.assigned_to
      ? {
          id: mo.assigned_to.id,
          uuid: mo.assigned_to.uuid ?? "",
          label: mo.assigned_to.name,
          email: mo.assigned_to.email,
        }
      : null,
    revision: mo.revision,
    notes: mo.notes ?? "",
  };
}

export function ManufacturingOrderForm({
  mo,
  company,
  canEdit,
  canDelete,
  onSavedSuccess,
}: Props) {
  const router = useRouter();
  const resource = mo ? `manufacturing-order:${mo.uuid}` : "manufacturing-order:new";
  useFormPresenceBeacon(resource);

  type CommitPayload =
    | { kind: "created"; uuid: string; code: string | null }
    | { kind: "saved"; state: FormState };

  const {
    state,
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
  } = useLiveForm<FormState>({
    resource,
    disabled: !canEdit,
    initialState: useMemo(() => initialFrom(mo), [mo]),
    onCommit: (raw) => {
      const msg = raw as CommitPayload | null;
      if (!msg) return;
      if (msg.kind === "created") {
        toast.success("Manufacturing order created", {
          description: `${creator?.name ?? "The host"} just saved ${msg.code ?? "the MO"}.`,
        });
        router.push(`/production/manufacturing-orders/${msg.uuid}`);
      } else if (msg.kind === "saved") {
        toast.success("Saved");
        setOriginal(msg.state);
        resetState(msg.state);
        if (mo) invalidateAudit("manufacturing_order", mo.id);
      }
    },
  });

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
      setCursor((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
    },
    [setCursor],
  );

  const [original, setOriginal] = useState<FormState>(() => initialFrom(mo));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [deletePending, setDeletePending] = useState(false);

  const dirty = JSON.stringify(state) !== JSON.stringify(original);
  // MO header is mostly frozen once it leaves draft. We let the
  // operator amend (Approved → Draft) instead of editing in place.
  const isFrozen = mo != null && mo.status !== "draft";

  // ---- pickers --------------------------------------------------

  async function searchSites(q: string): Promise<SiteOption[]> {
    try {
      const url = q
        ? `/api/production-facilities?search=${encodeURIComponent(q)}&limit=25`
        : `/api/production-facilities?limit=25`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return [];
      const body = (await res.json()) as {
        items?: Array<{ id: number; name: string; code: string | null; kind: string }>;
      };
      return (body.items ?? []).map((s) => ({
        id: s.id,
        label: s.name,
        code: s.code,
        kind: s.kind,
      }));
    } catch {
      return [];
    }
  }

  async function searchProducts(q: string): Promise<ItemOption[]> {
    try {
      const url = q
        ? `/api/items?search=${encodeURIComponent(q)}&limit=25`
        : `/api/items?limit=25`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return [];
      const body = (await res.json()) as { items?: Item[] };
      return (body.items ?? []).map((i) => ({
        id: i.id,
        uuid: i.uuid,
        label: i.name,
        code: i.code,
      }));
    } catch {
      return [];
    }
  }

  async function searchBoms(q: string): Promise<BOMOption[]> {
    if (!state.product) return [];
    try {
      const url = q
        ? `/api/production/boms?search=${encodeURIComponent(q)}&item_id=${state.product.id}&limit=25`
        : `/api/production/boms?item_id=${state.product.id}&limit=25`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return [];
      const body = (await res.json()) as { items?: BOMSummary[] };
      return (body.items ?? []).map((b) => ({
        id: b.id,
        uuid: b.uuid,
        label: b.name,
        code: b.code,
        itemId: b.item?.id ?? 0,
        isPrimary: b.is_primary,
      }));
    } catch {
      return [];
    }
  }

  async function searchUsers(q: string): Promise<UserOption[]> {
    try {
      const url = q
        ? `/api/users?search=${encodeURIComponent(q)}&limit=25`
        : `/api/users?limit=25`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return [];
      const body = (await res.json()) as {
        items?: Array<{ id: number; uuid: string; name: string; email: string }>;
      };
      return (body.items ?? []).map((u) => ({
        id: u.id,
        uuid: u.uuid,
        label: u.name,
        email: u.email,
      }));
    } catch {
      return [];
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setActionError(null);

    if (!state.site) {
      setFieldErrors({ warehouse_id: ["Pick a site."] });
      return;
    }
    if (!state.product) {
      setFieldErrors({ item_id: ["Pick a product."] });
      return;
    }
    if (!state.bom) {
      setFieldErrors({ bom_id: ["Pick a BOM."] });
      return;
    }
    if (!state.assigned_to) {
      setFieldErrors({ assigned_to_id: ["Pick an assignee."] });
      return;
    }
    const qty = Number(state.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setFieldErrors({ quantity: ["Quantity must be greater than zero."] });
      return;
    }
    const payload: ManufacturingOrderUpsertInput = {
      warehouse_id: state.site.id,
      item_id: state.product.id,
      bom_id: state.bom.id,
      quantity: String(qty),
      due_date: state.due_date || null,
      expiry_date: state.expiry_date || null,
      assigned_to_id: state.assigned_to.id,
      revision: state.revision.trim() || "V00",
      notes: state.notes.trim() || null,
    };

    startTransition(async () => {
      const res = mo
        ? await updateManufacturingOrderAction(mo.uuid, payload)
        : await createManufacturingOrderAction(payload);

      if (res.ok) {
        toast.success(mo ? "MO saved" : "MO created");
        setOriginal(state);
        invalidateAudit("manufacturing_order", res.mo.id);
        if (mo) {
          broadcastCommit({ kind: "saved", state });
          onSavedSuccess?.();
        } else {
          broadcastCommit({
            kind: "created",
            uuid: res.mo.uuid,
            code: res.mo.code,
          });
          router.push(`/production/manufacturing-orders/${res.mo.uuid}`);
        }
        return;
      }
      setFieldErrors(res.fields ?? {});
      setActionError(res);
    });
  }

  async function onDelete() {
    if (!mo) return;
    if (
      !window.confirm(
        `Delete ${mo.code ?? "this MO"}? Any schedule slot tied to it will need to be re-planned.`,
      )
    ) {
      return;
    }
    setDeletePending(true);
    const res = await deleteManufacturingOrderAction(mo.uuid);
    setDeletePending(false);
    if (res.ok) {
      toast.success("Manufacturing order deleted");
      router.push("/production/manufacturing-orders");
      router.refresh();
    } else {
      setActionError(res);
    }
  }

  function onReset() {
    resetState(original);
    setFieldErrors({});
    setActionError(null);
  }

  if (joinError) {
    return <JoinErrorCard error={joinError} />;
  }

  return (
    <Card
      ref={cursorAnchorRef}
      onMouseMove={onCursorMove}
      onMouseLeave={hideCursor}
      className="relative border-border/60"
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
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>
              {mo ? `Manufacturing order ${mo.code ?? `#${mo.id}`}` : "New manufacturing order"}
            </CardTitle>
            <CardDescription>
              Planned production run. Header is editable while in
              draft; approved + later statuses freeze most fields
              behind the amend flow.
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <CollabAvatars peers={presence} />
            {!canEdit && (
              <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                <LockKeyhole className="size-3" />
                Read-only
              </span>
            )}
            {isFrozen && canEdit && (
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                <Lock className="size-3" />
                Frozen — amend to edit
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <fieldset disabled={!canEdit || pending || isFrozen} className="contents">
          <form onSubmit={onSubmit} noValidate className="space-y-6">
            <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
              <Label className="pt-2.5 text-sm font-medium">
                Site <span className="text-destructive">*</span>
              </Label>
              <div className="space-y-1.5">
                <SearchPicker<SiteOption>
                  value={state.site}
                  onChange={(opt) => setField("site", opt)}
                  fetcher={searchSites}
                  placeholder="Pick a production site…"
                  disabled={!canEdit || isFrozen}
                  renderRow={(opt) => (
                    <div className="flex min-w-0 items-center gap-2">
                      <Factory className="size-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="truncate text-sm">{opt.label}</p>
                        {opt.code && (
                          <p className="font-mono text-[10px] text-muted-foreground">
                            {opt.code}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                />
                <FieldError messages={fieldErrors.warehouse_id} />
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
              <Label className="pt-2.5 text-sm font-medium">
                Product <span className="text-destructive">*</span>
              </Label>
              <div className="space-y-1.5">
                <SearchPicker<ItemOption>
                  value={state.product}
                  onChange={(opt) => {
                    setField("product", opt);
                    // Different product → clear stale BOM ref.
                    if (state.bom && opt && state.bom.itemId !== opt.id) {
                      setField("bom", null);
                    }
                  }}
                  fetcher={searchProducts}
                  placeholder="Search products…"
                  disabled={!canEdit || isFrozen}
                />
                <FieldError messages={fieldErrors.item_id} />
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
              <Label className="pt-2.5 text-sm font-medium">
                Quantity <span className="text-destructive">*</span>
              </Label>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1 max-w-[16rem]">
                    <Input
                      id="quantity"
                      value={state.quantity}
                      onChange={(e) => setField("quantity", e.target.value)}
                      onFocus={() => focusField("quantity")}
                      onBlur={() => blurField("quantity")}
                      inputMode="decimal"
                      placeholder="e.g. 1500"
                      className="h-11 font-mono"
                    />
                    <FieldEditingIndicator peer={fieldEditors.quantity} />
                  </div>
                  <span className="text-xs text-muted-foreground">Each</span>
                </div>
                <FieldError messages={fieldErrors.quantity} />
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
              <Label htmlFor="due_date" className="pt-2.5 text-sm font-medium">
                Due date
              </Label>
              <div className="max-w-[14rem]">
                <Input
                  id="due_date"
                  type="date"
                  value={state.due_date}
                  onChange={(e) => setField("due_date", e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
              <Label htmlFor="expiry_date" className="pt-2.5 text-sm font-medium">
                Expiry date
              </Label>
              <div className="max-w-[14rem]">
                <Input
                  id="expiry_date"
                  type="date"
                  value={state.expiry_date}
                  onChange={(e) => setField("expiry_date", e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
              <Label className="pt-2.5 text-sm font-medium">
                Assigned to <span className="text-destructive">*</span>
              </Label>
              <div className="space-y-1.5">
                <SearchPicker<UserOption>
                  value={state.assigned_to}
                  onChange={(opt) => setField("assigned_to", opt)}
                  fetcher={searchUsers}
                  placeholder="Pick the operator responsible…"
                  disabled={!canEdit || isFrozen}
                  renderRow={(opt) => (
                    <div className="min-w-0">
                      <p className="truncate text-sm">{opt.label}</p>
                      <p className="truncate text-[10px] text-muted-foreground">
                        {opt.email}
                      </p>
                    </div>
                  )}
                />
                <FieldError messages={fieldErrors.assigned_to_id} />
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
              <Label htmlFor="revision" className="pt-2.5 text-sm font-medium">
                Revision
              </Label>
              <div className="max-w-[8rem]">
                <Input
                  id="revision"
                  value={state.revision}
                  onChange={(e) => setField("revision", e.target.value)}
                  placeholder="V00"
                  className="font-mono"
                />
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
              <Label className="pt-2.5 text-sm font-medium">
                Bill of materials <span className="text-destructive">*</span>
              </Label>
              <div className="space-y-1.5">
                <SearchPicker<BOMOption>
                  value={state.bom}
                  onChange={(opt) => setField("bom", opt)}
                  fetcher={searchBoms}
                  placeholder={
                    state.product ? "Pick a BOM for this product…" : "Pick a product first"
                  }
                  disabled={!canEdit || isFrozen || !state.product}
                  renderRow={(opt) => (
                    <div className="min-w-0">
                      <p className="truncate text-sm">
                        {opt.label}{" "}
                        {opt.isPrimary && (
                          <span className="ml-1 rounded-full bg-emerald-500/10 px-1.5 text-[9px] font-medium text-emerald-700 dark:text-emerald-300">
                            primary
                          </span>
                        )}
                      </p>
                      {opt.code && (
                        <p className="font-mono text-[10px] text-muted-foreground">
                          {opt.code}
                        </p>
                      )}
                    </div>
                  )}
                />
                <FieldError messages={fieldErrors.bom_id} />
                {mo?.approximate_cost && (
                  <p className="text-[11px] text-muted-foreground">
                    Approximate cost (qty × BOM cost):{" "}
                    <span className="font-medium text-foreground">
                      {formatCompanyMoney(mo.approximate_cost, company)}
                    </span>
                  </p>
                )}
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
              <Label htmlFor="notes" className="pt-2.5 text-sm font-medium">
                Notes
              </Label>
              <div>
                <Textarea
                  id="notes"
                  value={state.notes}
                  onChange={(e) => setField("notes", e.target.value)}
                  rows={3}
                />
              </div>
            </div>

            {actionError && (
              <ErrorBanner
                detail={actionError.detail}
                code={actionError.code}
                debug={actionError.debug}
              />
            )}

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
                      can {mo ? "save" : "create"} from this room.
                    </span>
                  </div>
                )}
                <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-between">
                  <div>
                    {mo && canDelete && isCreator && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={onDelete}
                        disabled={pending || deletePending}
                        className="text-destructive hover:bg-destructive/10"
                      >
                        {deletePending ? (
                          <Loader2 className="mr-2 size-4 animate-spin" />
                        ) : (
                          <Trash2 className="mr-2 size-4" />
                        )}
                        Delete
                      </Button>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                    {dirty && !pending && isCreator && (
                      <Button type="button" variant="ghost" onClick={onReset}>
                        Discard
                      </Button>
                    )}
                    <Button
                      type="submit"
                      disabled={!dirty || pending || !isCreator || isFrozen}
                      title={
                        isCreator
                          ? isFrozen
                            ? "Move the MO back to draft to edit"
                            : undefined
                          : creator
                            ? `Only ${creator.name} can ${mo ? "save" : "create"} from this room.`
                            : undefined
                      }
                    >
                      {pending && (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      )}
                      {mo ? "Save changes" : "Create MO"}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </form>
        </fieldset>
      </CardContent>
    </Card>
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
      title: "Form is at capacity",
      detail: error.limit
        ? `Up to ${error.limit} people can edit this form at once.`
        : "Wait for someone to leave, then refresh.",
    },
    forbidden: {
      icon: LockKeyhole,
      tone: "muted",
      title: "You can't edit here",
      detail:
        "Ask an admin for the `production.mo_edit` permission to join this form.",
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
      <CardHeader className="flex flex-row items-start gap-3 space-y-0">
        <Icon className={cn("mt-0.5 size-5 shrink-0", iconClass)} />
        <div className="space-y-1">
          <CardTitle className="text-base">{config.title}</CardTitle>
          <CardDescription>{config.detail}</CardDescription>
        </div>
      </CardHeader>
    </Card>
  );
}
