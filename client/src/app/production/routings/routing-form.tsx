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
  Loader2,
  Lock,
  LockKeyhole,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  createRoutingAction,
  deleteRoutingAction,
  updateRoutingAction,
} from "@/lib/production/actions";
import type {
  BOMSummary,
  Routing,
  RoutingUpsertInput,
} from "@/lib/production/types";

interface ItemOption extends SearchPickerOption {
  uuid: string;
}

interface BOMOption extends SearchPickerOption {
  uuid: string;
  itemId: number;
  isPrimary: boolean;
}

interface GroupOption extends SearchPickerOption {
  color: string | null;
}

interface WorkerOption extends SearchPickerOption {
  uuid: string;
  email: string;
}

interface StepDraft {
  tempId: string;
  workstation_group: GroupOption | null;
  operation_description: string;
  setup_time_min: string;
  cycle_time_min: string;
  fixed_cost: string;
  variable_cost: string;
  capacity: string;
  workers: WorkerOption[];
}

interface FormState {
  name: string;
  notes: string;
  output_item: ItemOption | null;
  connect_bom: boolean;
  bom: BOMOption | null;
  is_active: boolean;
  other_fixed_cost: string;
  other_variable_cost: string;
  other_variable_cost_basis: string;
  steps: StepDraft[];
}

interface RoutingFormProps {
  routing: Routing | null;
  /** When creating from an item page, pre-fill the output item. */
  outputItem: Item | null;
  /** Optional pre-fill of the connected BOM. */
  initialBom: BOMSummary | null;
  company: CompanyDefaults;
  canEdit: boolean;
  canDelete: boolean;
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `tmp-${Math.random().toString(36).slice(2, 10)}`;
}

function emptyStep(): StepDraft {
  return {
    tempId: newId(),
    workstation_group: null,
    operation_description: "",
    setup_time_min: "",
    cycle_time_min: "",
    fixed_cost: "",
    variable_cost: "",
    capacity: "1",
    workers: [],
  };
}

function hydrateSteps(routing: Routing | null): StepDraft[] {
  if (!routing || routing.steps.length === 0) return [emptyStep()];
  return routing.steps
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((s) => ({
      tempId: newId(),
      workstation_group: s.workstation_group
        ? {
            id: s.workstation_group.id,
            label: s.workstation_group.name,
            code: s.workstation_group.code,
            color: s.workstation_group.color,
          }
        : null,
      operation_description: s.operation_description ?? "",
      setup_time_min: s.setup_time_min ?? "",
      cycle_time_min: s.cycle_time_min ?? "",
      fixed_cost: s.fixed_cost ?? "",
      variable_cost: s.variable_cost ?? "",
      capacity: s.capacity ?? "1",
      workers: s.workers.map((w) => ({
        id: w.id,
        uuid: w.uuid,
        label: w.name,
        email: w.email,
      })),
    }));
}

function initialFrom(
  routing: Routing | null,
  outputItem: Item | null,
  initialBom: BOMSummary | null,
): FormState {
  return {
    name: routing?.name ?? "",
    notes: routing?.notes ?? "",
    output_item: routing?.item
      ? {
          id: routing.item.id,
          uuid: routing.item.uuid,
          label: routing.item.name,
          code: routing.item.code,
        }
      : outputItem
        ? {
            id: outputItem.id,
            uuid: outputItem.uuid,
            label: outputItem.name,
            code: outputItem.code,
          }
        : null,
    connect_bom: !!(routing?.bom ?? initialBom),
    bom: routing?.bom
      ? {
          id: routing.bom.id,
          uuid: routing.bom.uuid,
          label: routing.bom.name,
          code: routing.bom.code,
          itemId: routing.bom.item?.id ?? 0,
          isPrimary: routing.bom.is_primary,
        }
      : initialBom
        ? {
            id: initialBom.id,
            uuid: initialBom.uuid,
            label: initialBom.name,
            code: initialBom.code,
            itemId: initialBom.item?.id ?? 0,
            isPrimary: initialBom.is_primary,
          }
        : null,
    is_active: routing?.is_active ?? true,
    other_fixed_cost: routing?.other_fixed_cost ?? "",
    other_variable_cost: routing?.other_variable_cost ?? "",
    other_variable_cost_basis: routing?.other_variable_cost_basis ?? "1",
    steps: hydrateSteps(routing),
  };
}

export function RoutingForm({
  routing,
  outputItem,
  initialBom,
  company,
  canEdit,
  canDelete,
}: RoutingFormProps) {
  const router = useRouter();
  const resource = routing ? `routing:${routing.uuid}` : "routing:new";
  useFormPresenceBeacon(resource);

  type CommitPayload =
    | { kind: "created"; uuid: string; name: string }
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
    initialState: useMemo(
      () => initialFrom(routing, outputItem, initialBom),
      [routing, outputItem, initialBom],
    ),
    onCommit: (raw) => {
      const msg = raw as CommitPayload | null;
      if (!msg) return;
      if (msg.kind === "created") {
        toast.success("Routing created", {
          description: `${creator?.name ?? "The host"} just finalized "${msg.name}".`,
        });
        router.push(`/production/routings/${msg.uuid}`);
      } else if (msg.kind === "saved") {
        toast.success("Saved");
        setOriginal(msg.state);
        resetState(msg.state);
        if (routing) invalidateAudit("routing", routing.id);
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

  const [original, setOriginal] = useState<FormState>(() =>
    initialFrom(routing, outputItem, initialBom),
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [deletePending, setDeletePending] = useState(false);

  const dirty = JSON.stringify(state) !== JSON.stringify(original);

  // ---- pickers --------------------------------------------------

  async function searchItems(q: string): Promise<ItemOption[]> {
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
    if (!state.output_item) return [];
    try {
      const url = q
        ? `/api/production/boms?search=${encodeURIComponent(q)}&item_id=${state.output_item.id}&limit=25`
        : `/api/production/boms?item_id=${state.output_item.id}&limit=25`;
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

  async function searchGroups(q: string): Promise<GroupOption[]> {
    try {
      const url = q
        ? `/api/production/workstation-groups?search=${encodeURIComponent(q)}&limit=25`
        : `/api/production/workstation-groups?limit=25`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return [];
      const body = (await res.json()) as {
        items?: Array<{ id: number; name: string; code: string | null; color: string | null }>;
      };
      return (body.items ?? []).map((g) => ({
        id: g.id,
        label: g.name,
        code: g.code,
        color: g.color,
      }));
    } catch {
      return [];
    }
  }

  async function searchWorkers(q: string): Promise<WorkerOption[]> {
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

  // ---- step helpers --------------------------------------------

  function patchStep(tempId: string, patch: Partial<StepDraft>) {
    setField(
      "steps",
      state.steps.map((s) => (s.tempId === tempId ? { ...s, ...patch } : s)),
    );
  }

  function addStep() {
    setField("steps", [...state.steps, emptyStep()]);
  }

  function removeStep(tempId: string) {
    const next = state.steps.filter((s) => s.tempId !== tempId);
    setField("steps", next.length === 0 ? [emptyStep()] : next);
  }

  function addWorker(tempId: string, opt: WorkerOption | null) {
    if (!opt) return;
    const step = state.steps.find((s) => s.tempId === tempId);
    if (!step) return;
    if (step.workers.some((w) => w.id === opt.id)) return;
    patchStep(tempId, { workers: [...step.workers, opt] });
  }

  function removeWorker(tempId: string, workerId: number) {
    const step = state.steps.find((s) => s.tempId === tempId);
    if (!step) return;
    patchStep(tempId, {
      workers: step.workers.filter((w) => w.id !== workerId),
    });
  }

  // ---- submit --------------------------------------------------

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setActionError(null);

    if (!state.output_item) {
      setFieldErrors({ item_id: ["Pick an output item."] });
      return;
    }
    if (state.connect_bom && !state.bom) {
      setFieldErrors({ bom_id: ["Pick a BOM or untick \"Connect BOM\"."] });
      return;
    }

    const validSteps = state.steps.filter((s) => s.workstation_group != null);
    if (validSteps.length === 0) {
      setFieldErrors({
        steps: ["Add at least one operation with a workstation group."],
      });
      return;
    }

    const payload: RoutingUpsertInput = {
      item_id: state.output_item.id,
      bom_id: state.connect_bom && state.bom ? state.bom.id : null,
      name: state.name.trim(),
      notes: state.notes.trim() || null,
      is_active: state.is_active,
      other_fixed_cost: state.other_fixed_cost.trim() || null,
      other_variable_cost: state.other_variable_cost.trim() || null,
      other_variable_cost_basis: state.other_variable_cost_basis || "1",
      steps: validSteps.map((s, idx) => ({
        workstation_group_id: s.workstation_group!.id,
        operation_description: s.operation_description.trim() || null,
        setup_time_min: s.setup_time_min.trim() || null,
        cycle_time_min: s.cycle_time_min.trim() || null,
        fixed_cost: s.fixed_cost.trim() || null,
        variable_cost: s.variable_cost.trim() || null,
        capacity: s.capacity.trim() || "1",
        sort_order: idx,
        default_worker_ids: s.workers.map((w) => w.id),
      })),
    };

    startTransition(async () => {
      const res = routing
        ? await updateRoutingAction(routing.uuid, payload)
        : await createRoutingAction(payload);

      if (res.ok) {
        toast.success(routing ? "Routing saved" : "Routing created");
        setOriginal(state);
        invalidateAudit("routing", res.routing.id);
        if (routing) {
          broadcastCommit({ kind: "saved", state });
        } else {
          broadcastCommit({
            kind: "created",
            uuid: res.routing.uuid,
            name: res.routing.name,
          });
          router.push(`/production/routings/${res.routing.uuid}`);
        }
        return;
      }
      setFieldErrors(res.fields ?? {});
      setActionError(res);
    });
  }

  async function onDelete() {
    if (!routing) return;
    if (
      !window.confirm(
        `Delete "${routing.name}"? Any MO planning that referenced this routing will need to be re-pointed.`,
      )
    ) {
      return;
    }
    setDeletePending(true);
    const res = await deleteRoutingAction(routing.uuid);
    setDeletePending(false);
    if (res.ok) {
      toast.success("Routing deleted");
      router.push("/production/routings");
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
              {routing ? routing.name : "New routing"}
            </CardTitle>
            <CardDescription>
              Ordered list of operations that turns a BOM's inputs into
              the finished item. Each step runs on one workstation
              group and carries setup + cycle time + cost + worker
              assignments.
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
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <fieldset disabled={!canEdit || pending} className="contents">
          <form onSubmit={onSubmit} noValidate className="space-y-6">
            <div className="space-y-4">
              <SectionTitle>Header</SectionTitle>

              <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
                <Label className="pt-2.5 text-sm font-medium">
                  Output item <span className="text-destructive">*</span>
                </Label>
                <div className="space-y-1.5">
                  <SearchPicker<ItemOption>
                    value={state.output_item}
                    onChange={(opt) => {
                      setField("output_item", opt);
                      // Different item → clear stale BOM ref.
                      if (state.bom && opt && state.bom.itemId !== opt.id) {
                        setField("bom", null);
                      }
                    }}
                    fetcher={searchItems}
                    placeholder="Search items by name or code…"
                    disabled={!canEdit || !!routing}
                    onFocus={() => focusField("item_id")}
                    onBlur={() => blurField("item_id")}
                  />
                  {routing && (
                    <p className="text-[11px] text-muted-foreground">
                      Item is locked on existing routings.
                    </p>
                  )}
                  <FieldError messages={fieldErrors.item_id} />
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
                <Label htmlFor="name" className="pt-2.5 text-sm font-medium">
                  Name <span className="text-destructive">*</span>
                </Label>
                <div className="space-y-1.5">
                  <div className="relative">
                    <Input
                      id="name"
                      value={state.name}
                      onChange={(e) => setField("name", e.target.value)}
                      onFocus={() => focusField("name")}
                      onBlur={() => blurField("name")}
                      placeholder={
                        state.output_item
                          ? `${state.output_item.label} Routing`
                          : "Routing name"
                      }
                      required
                      className={cn(
                        "h-11",
                        fieldErrors.name?.length &&
                          "border-destructive focus-visible:ring-destructive/20",
                      )}
                    />
                    <FieldEditingIndicator peer={fieldEditors.name} />
                  </div>
                  <FieldError messages={fieldErrors.name} />
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
                <Label className="pt-1 text-sm font-medium">
                  Connected BOM
                </Label>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="connect_bom"
                      checked={state.connect_bom}
                      onCheckedChange={(v) => {
                        const next = v === true;
                        setField("connect_bom", next);
                        if (!next) setField("bom", null);
                      }}
                      disabled={!state.output_item}
                    />
                    <Label
                      htmlFor="connect_bom"
                      className="cursor-pointer text-sm text-muted-foreground"
                    >
                      Tie this routing to a specific BOM
                    </Label>
                  </div>
                  {state.connect_bom && (
                    <>
                      <SearchPicker<BOMOption>
                        value={state.bom}
                        onChange={(opt) => setField("bom", opt)}
                        fetcher={searchBoms}
                        placeholder="Pick a BOM for this item…"
                        disabled={!canEdit || !state.output_item}
                      />
                      <FieldError messages={fieldErrors.bom_id} />
                    </>
                  )}
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
                <Label htmlFor="notes" className="pt-2.5 text-sm font-medium">
                  Notes
                </Label>
                <div className="space-y-1.5">
                  <div className="relative">
                    <Textarea
                      id="notes"
                      value={state.notes}
                      onChange={(e) => setField("notes", e.target.value)}
                      onFocus={() => focusField("notes")}
                      onBlur={() => blurField("notes")}
                      rows={2}
                    />
                    <FieldEditingIndicator peer={fieldEditors.notes} />
                  </div>
                  <FieldError messages={fieldErrors.notes} />
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
                <Label className="pt-1.5 text-sm font-medium">Active</Label>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={state.is_active}
                    onCheckedChange={(v) => setField("is_active", v)}
                  />
                  <span className="text-sm text-muted-foreground">
                    {state.is_active
                      ? "Active — selectable on MOs + the schedule."
                      : "Inactive — hidden from selectors."}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-md border border-border/60 bg-card p-4">
              <div className="flex items-center justify-between">
                <SectionTitle>Operations</SectionTitle>
                {canEdit && (
                  <Button type="button" variant="outline" size="sm" onClick={addStep}>
                    <Plus className="mr-1 size-3.5" />
                    Add step
                  </Button>
                )}
              </div>
              <FieldError messages={fieldErrors.steps} />

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5 text-left w-8">#</th>
                      <th className="px-2 py-1.5 text-left">Workstation group</th>
                      <th className="px-2 py-1.5 text-left">Operation</th>
                      <th className="px-2 py-1.5 text-right">Setup min</th>
                      <th className="px-2 py-1.5 text-right">Cycle min</th>
                      <th className="px-2 py-1.5 text-right">Fixed cost</th>
                      <th className="px-2 py-1.5 text-right">Var cost</th>
                      <th className="px-2 py-1.5 text-right">Capacity</th>
                      <th className="px-2 py-1.5 text-left">Workers</th>
                      <th className="px-2 py-1.5 w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60 align-top">
                    {state.steps.map((step, idx) => (
                      <StepRow
                        key={step.tempId}
                        idx={idx}
                        step={step}
                        canEdit={canEdit}
                        searchGroups={searchGroups}
                        searchWorkers={searchWorkers}
                        onPatch={(patch) => patchStep(step.tempId, patch)}
                        onRemove={() => removeStep(step.tempId)}
                        onAddWorker={(opt) => addWorker(step.tempId, opt)}
                        onRemoveWorker={(id) =>
                          removeWorker(step.tempId, id)
                        }
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-3 rounded-md border border-border/60 bg-muted/30 p-4">
              <SectionTitle>Other costs</SectionTitle>
              <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
                <Label htmlFor="ofc" className="pt-2.5 text-sm font-medium">
                  Other fixed cost
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="ofc"
                    value={state.other_fixed_cost}
                    onChange={(e) => setField("other_fixed_cost", e.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                    className="h-10 font-mono"
                  />
                  <span className="text-xs text-muted-foreground">
                    {company.currency_code}
                  </span>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
                <Label htmlFor="ovc" className="pt-2.5 text-sm font-medium">
                  Other variable cost
                </Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    id="ovc"
                    value={state.other_variable_cost}
                    onChange={(e) =>
                      setField("other_variable_cost", e.target.value)
                    }
                    inputMode="decimal"
                    placeholder="0.00"
                    className="h-10 w-32 font-mono"
                  />
                  <span className="text-xs text-muted-foreground">
                    {company.currency_code} per
                  </span>
                  <Input
                    value={state.other_variable_cost_basis}
                    onChange={(e) =>
                      setField("other_variable_cost_basis", e.target.value)
                    }
                    inputMode="decimal"
                    placeholder="1"
                    className="h-10 w-20 font-mono"
                  />
                  <span className="text-xs text-muted-foreground">each</span>
                </div>
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
                      can {routing ? "save" : "create"} from this room.
                    </span>
                  </div>
                )}
                <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-between">
                  <div>
                    {routing && canDelete && isCreator && (
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
                      disabled={!dirty || pending || !isCreator}
                      title={
                        isCreator
                          ? undefined
                          : creator
                            ? `Only ${creator.name} can ${
                                routing ? "save" : "create"
                              } from this room.`
                            : undefined
                      }
                    >
                      {pending && (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      )}
                      {routing ? "Save changes" : "Create routing"}
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

function StepRow({
  idx,
  step,
  canEdit,
  searchGroups,
  searchWorkers,
  onPatch,
  onRemove,
  onAddWorker,
  onRemoveWorker,
}: {
  idx: number;
  step: StepDraft;
  canEdit: boolean;
  searchGroups: (q: string) => Promise<GroupOption[]>;
  searchWorkers: (q: string) => Promise<WorkerOption[]>;
  onPatch: (patch: Partial<StepDraft>) => void;
  onRemove: () => void;
  onAddWorker: (opt: WorkerOption | null) => void;
  onRemoveWorker: (id: number) => void;
}) {
  return (
    <tr>
      <td className="px-2 py-2 font-mono text-[10px] text-muted-foreground">
        {idx + 1}
      </td>
      <td className="px-2 py-2 min-w-[12rem]">
        <SearchPicker<GroupOption>
          value={step.workstation_group}
          onChange={(opt) => onPatch({ workstation_group: opt })}
          fetcher={searchGroups}
          placeholder="Pick group…"
          disabled={!canEdit}
          renderRow={(opt) => (
            <div className="flex min-w-0 items-center gap-2">
              {opt.color && (
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-sm border border-border/60"
                  style={{ backgroundColor: opt.color }}
                />
              )}
              <span className="truncate text-sm">{opt.label}</span>
            </div>
          )}
        />
      </td>
      <td className="px-2 py-2 min-w-[12rem]">
        <Textarea
          value={step.operation_description}
          onChange={(e) => onPatch({ operation_description: e.target.value })}
          rows={1}
          placeholder="SOP notes…"
          className="min-h-[2.5rem]"
          disabled={!canEdit}
        />
      </td>
      <td className="px-2 py-2 w-24">
        <Input
          value={step.setup_time_min}
          onChange={(e) => onPatch({ setup_time_min: e.target.value })}
          inputMode="decimal"
          placeholder="0"
          className="h-9 text-right font-mono text-xs"
          disabled={!canEdit}
        />
      </td>
      <td className="px-2 py-2 w-24">
        <Input
          value={step.cycle_time_min}
          onChange={(e) => onPatch({ cycle_time_min: e.target.value })}
          inputMode="decimal"
          placeholder="0"
          className="h-9 text-right font-mono text-xs"
          disabled={!canEdit}
        />
      </td>
      <td className="px-2 py-2 w-24">
        <Input
          value={step.fixed_cost}
          onChange={(e) => onPatch({ fixed_cost: e.target.value })}
          inputMode="decimal"
          placeholder="0"
          className="h-9 text-right font-mono text-xs"
          disabled={!canEdit}
        />
      </td>
      <td className="px-2 py-2 w-24">
        <Input
          value={step.variable_cost}
          onChange={(e) => onPatch({ variable_cost: e.target.value })}
          inputMode="decimal"
          placeholder="0"
          className="h-9 text-right font-mono text-xs"
          disabled={!canEdit}
        />
      </td>
      <td className="px-2 py-2 w-20">
        <Input
          value={step.capacity}
          onChange={(e) => onPatch({ capacity: e.target.value })}
          inputMode="decimal"
          placeholder="1"
          className="h-9 text-right font-mono text-xs"
          disabled={!canEdit}
        />
      </td>
      <td className="px-2 py-2 min-w-[12rem]">
        <div className="space-y-1">
          {step.workers.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {step.workers.map((w) => (
                <span
                  key={w.id}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px]"
                >
                  <span className="font-medium">{w.label}</span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => onRemoveWorker(w.id)}
                      aria-label={`Remove ${w.label}`}
                      className="rounded-full p-0.5 hover:bg-destructive/10 hover:text-destructive"
                    >
                      <X className="size-2.5" />
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
          {canEdit && (
            <SearchPicker<WorkerOption>
              value={null}
              onChange={onAddWorker}
              fetcher={searchWorkers}
              placeholder="Add worker…"
              renderRow={(opt) => (
                <div className="min-w-0">
                  <p className="truncate text-xs">{opt.label}</p>
                  <p className="truncate text-[9px] text-muted-foreground">
                    {opt.email}
                  </p>
                </div>
              )}
            />
          )}
        </div>
      </td>
      <td className="px-1 py-2 text-center">
        {canEdit && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove step ${idx + 1}`}
            className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </td>
    </tr>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
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
        "Ask an admin for the `production.routing_edit` permission to join this form.",
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
