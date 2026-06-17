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
  X,
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
import type { FieldErrors } from "@/lib/auth/actions";
import type { ErrorResult } from "@/lib/errors/server";
import { cn } from "@/lib/utils";
import { useLiveForm } from "@/lib/realtime/use-live-form";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import { invalidateAudit } from "@/lib/audit/invalidator";
import { updateManufacturingOrderStepAction } from "@/lib/production/actions";
import type { ManufacturingOrderStep } from "@/lib/production/types";

interface WorkerOption extends SearchPickerOption {
  uuid: string;
  email: string;
}

interface FormState {
  operation_description: string;
  planned_start: string;
  planned_finish: string;
  actual_start: string;
  actual_finish: string;
  applied_overhead_cost: string;
  labor_cost: string;
  quantity: string;
  notes: string;
  workers: WorkerOption[];
}

interface Props {
  step: ManufacturingOrderStep;
  canEdit: boolean;
  canExecute: boolean;
  onSavedSuccess?: () => void;
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function initialFrom(step: ManufacturingOrderStep): FormState {
  return {
    operation_description: step.operation_description ?? "",
    planned_start: toLocalInput(step.planned_start),
    planned_finish: toLocalInput(step.planned_finish),
    actual_start: toLocalInput(step.actual_start),
    actual_finish: toLocalInput(step.actual_finish),
    applied_overhead_cost: step.applied_overhead_cost ?? "",
    labor_cost: step.labor_cost ?? "",
    quantity: step.quantity ?? "",
    notes: step.notes ?? "",
    workers: step.workers.map((w) => ({
      id: w.id,
      uuid: w.uuid,
      label: w.name,
      email: w.email,
    })),
  };
}

export function MOStepForm({
  step,
  canEdit,
  canExecute,
  onSavedSuccess,
}: Props) {
  const router = useRouter();
  const resource = `manufacturing-order-step:${step.uuid}`;
  useFormPresenceBeacon(resource);

  type CommitPayload = { kind: "saved"; state: FormState };

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
    disabled: !canEdit && !canExecute,
    initialState: useMemo(() => initialFrom(step), [step]),
    onCommit: (raw) => {
      const msg = raw as CommitPayload | null;
      if (!msg) return;
      if (msg.kind === "saved") {
        toast.success("Saved");
        setOriginal(msg.state);
        resetState(msg.state);
        invalidateAudit("manufacturing_order_step", step.id);
      }
    },
  });

  const cursorAnchorRef = useRef<HTMLDivElement | null>(null);
  const [anchorSize, setAnchorSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = cursorAnchorRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setAnchorSize({ w: rect.width, h: rect.height });
    };
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => () => hideCursor(), [hideCursor]);

  const onCursorMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = cursorAnchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      setCursor(
        (e.clientX - rect.left) / rect.width,
        (e.clientY - rect.top) / rect.height,
      );
    },
    [setCursor],
  );

  const [original, setOriginal] = useState<FormState>(() => initialFrom(step));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = JSON.stringify(state) !== JSON.stringify(original);

  async function searchWorkers(q: string): Promise<WorkerOption[]> {
    try {
      const url = q
        ? `/api/users?search=${encodeURIComponent(q)}&limit=25`
        : `/api/users?limit=25`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return [];
      const body = (await res.json()) as {
        items?: Array<{
          id: number;
          uuid: string;
          name: string;
          email: string;
        }>;
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

  const excludeWorkerIds = useMemo(
    () => new Set(state.workers.map((w) => w.id)),
    [state.workers],
  );

  function addWorker(opt: WorkerOption | null) {
    if (!opt) return;
    if (state.workers.some((w) => w.id === opt.id)) return;
    setField("workers", [...state.workers, opt]);
  }

  function removeWorker(id: number) {
    setField(
      "workers",
      state.workers.filter((w) => w.id !== id),
    );
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setActionError(null);

    const payload: Record<string, unknown> = {
      operation_description: state.operation_description.trim() || null,
      notes: state.notes.trim() || null,
      planned_start: toIso(state.planned_start),
      planned_finish: toIso(state.planned_finish),
      applied_overhead_cost: state.applied_overhead_cost.trim() || null,
      worker_ids: state.workers.map((w) => w.id),
    };

    // Execute-only fields gated by canExecute. Strip them so a planner
    // (mo_edit only) doesn't accidentally trip the 403 path.
    if (canExecute) {
      payload.actual_start = toIso(state.actual_start);
      payload.actual_finish = toIso(state.actual_finish);
      payload.labor_cost = state.labor_cost.trim() || null;
      payload.quantity = state.quantity.trim() || null;
    }

    startTransition(async () => {
      const res = await updateManufacturingOrderStepAction(
        step.manufacturing_order!.uuid,
        step.uuid,
        payload,
      );
      if (res.ok) {
        toast.success("Operation saved");
        setOriginal(state);
        invalidateAudit("manufacturing_order_step", step.id);
        broadcastCommit({ kind: "saved", state });
        onSavedSuccess?.();
        router.refresh();
        return;
      }
      setFieldErrors(res.fields ?? {});
      setActionError(res);
    });
  }

  function onReset() {
    resetState(original);
    setFieldErrors({});
    setActionError(null);
  }

  if (joinError) return <JoinErrorCard error={joinError} />;

  const readOnly = !canEdit && !canExecute;
  const canEditPlan = canEdit;

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
            <CardTitle>Modify operation</CardTitle>
            <CardDescription>
              Per-MO snapshot of routing step #{step.sort_order + 1}.
              {step.workstation_group ? (
                <>
                  {" "}Workstation group:{" "}
                  <span className="font-medium text-foreground">
                    {step.workstation_group.name}
                  </span>
                  .
                </>
              ) : null}
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <CollabAvatars peers={presence} />
            {readOnly && (
              <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                <LockKeyhole className="size-3" />
                Read-only
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <fieldset disabled={readOnly || pending} className="contents">
          <form onSubmit={onSubmit} noValidate className="space-y-6">
            <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
              <Label
                htmlFor="operation_description"
                className="pt-2.5 text-sm font-medium"
              >
                Operation
              </Label>
              <div className="space-y-1.5">
                <div className="relative">
                  <Textarea
                    id="operation_description"
                    value={state.operation_description}
                    onChange={(e) =>
                      setField("operation_description", e.target.value)
                    }
                    onFocus={() => focusField("operation_description")}
                    onBlur={() => blurField("operation_description")}
                    disabled={!canEditPlan}
                    rows={6}
                    placeholder="Step-by-step SOP for this operation — checks, weights, time targets…"
                  />
                  <FieldEditingIndicator
                    peer={fieldEditors.operation_description}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Snapshotted from the routing template, editable per MO. Routing
                  edits don&apos;t bleed back into this row.
                </p>
                <FieldError messages={fieldErrors.operation_description} />
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
              <Label className="pt-2.5 text-sm font-medium">Workers</Label>
              <div className="space-y-2">
                {state.workers.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {state.workers.map((w) => (
                      <span
                        key={w.id}
                        className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand"
                      >
                        {w.label}
                        {canEditPlan && (
                          <button
                            type="button"
                            onClick={() => removeWorker(w.id)}
                            className="rounded-full p-0.5 hover:bg-brand/20"
                            aria-label={`Remove ${w.label}`}
                          >
                            <X className="size-3" />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    No workers assigned yet.
                  </p>
                )}
                {canEditPlan && (
                  <div className="max-w-md">
                    <SearchPicker<WorkerOption>
                      value={null}
                      onChange={(opt) => addWorker(opt)}
                      fetcher={searchWorkers}
                      placeholder="Add a worker…"
                      excludeIds={excludeWorkerIds}
                      renderRow={(opt) => (
                        <div className="min-w-0">
                          <p className="truncate text-sm">{opt.label}</p>
                          <p className="truncate text-[10px] text-muted-foreground">
                            {opt.email}
                          </p>
                        </div>
                      )}
                    />
                  </div>
                )}
              </div>
            </div>

            <SectionSubhead title="Schedule" />

            <PairRow
              left={
                <DateTimeField
                  id="planned_start"
                  label="Planned start"
                  value={state.planned_start}
                  disabled={!canEditPlan}
                  onChange={(v) => setField("planned_start", v)}
                  onFocus={() => focusField("planned_start")}
                  onBlur={() => blurField("planned_start")}
                  errors={fieldErrors.planned_start}
                  editor={fieldEditors.planned_start}
                />
              }
              right={
                <DateTimeField
                  id="planned_finish"
                  label="Planned finish"
                  value={state.planned_finish}
                  disabled={!canEditPlan}
                  onChange={(v) => setField("planned_finish", v)}
                  onFocus={() => focusField("planned_finish")}
                  onBlur={() => blurField("planned_finish")}
                  errors={fieldErrors.planned_finish}
                  editor={fieldEditors.planned_finish}
                />
              }
            />

            <PairRow
              left={
                <DateTimeField
                  id="actual_start"
                  label="Actual start"
                  value={state.actual_start}
                  disabled={!canExecute}
                  onChange={(v) => setField("actual_start", v)}
                  onFocus={() => focusField("actual_start")}
                  onBlur={() => blurField("actual_start")}
                  errors={fieldErrors.actual_start}
                  editor={fieldEditors.actual_start}
                  hint={
                    !canExecute
                      ? "Needs production.mo_execute permission."
                      : undefined
                  }
                />
              }
              right={
                <DateTimeField
                  id="actual_finish"
                  label="Actual finish"
                  value={state.actual_finish}
                  disabled={!canExecute}
                  onChange={(v) => setField("actual_finish", v)}
                  onFocus={() => focusField("actual_finish")}
                  onBlur={() => blurField("actual_finish")}
                  errors={fieldErrors.actual_finish}
                  editor={fieldEditors.actual_finish}
                />
              }
            />

            <SectionSubhead title="Costs + quantity" />

            <PairRow
              left={
                <DecimalField
                  id="applied_overhead_cost"
                  label="Applied overhead cost"
                  value={state.applied_overhead_cost}
                  disabled={!canEditPlan}
                  onChange={(v) => setField("applied_overhead_cost", v)}
                  onFocus={() => focusField("applied_overhead_cost")}
                  onBlur={() => blurField("applied_overhead_cost")}
                  errors={fieldErrors.applied_overhead_cost}
                  editor={fieldEditors.applied_overhead_cost}
                />
              }
              right={
                <DecimalField
                  id="labor_cost"
                  label="Labor cost"
                  value={state.labor_cost}
                  disabled={!canExecute}
                  onChange={(v) => setField("labor_cost", v)}
                  onFocus={() => focusField("labor_cost")}
                  onBlur={() => blurField("labor_cost")}
                  errors={fieldErrors.labor_cost}
                  editor={fieldEditors.labor_cost}
                />
              }
            />

            <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
              <Label htmlFor="quantity" className="pt-2.5 text-sm font-medium">
                Quantity produced
              </Label>
              <div className="space-y-1.5">
                <div className="relative max-w-[12rem]">
                  <Input
                    id="quantity"
                    value={state.quantity}
                    disabled={!canExecute}
                    inputMode="decimal"
                    onChange={(e) => setField("quantity", e.target.value)}
                    onFocus={() => focusField("quantity")}
                    onBlur={() => blurField("quantity")}
                    placeholder="0"
                    className="h-10 font-mono"
                  />
                  <FieldEditingIndicator peer={fieldEditors.quantity} />
                </div>
                <FieldError messages={fieldErrors.quantity} />
              </div>
            </div>

            <SectionSubhead title="Notes" />

            <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
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
                    disabled={!canEditPlan && !canExecute}
                    rows={3}
                    placeholder="One-line operator notes — checklists belong in the Operation field."
                  />
                  <FieldEditingIndicator peer={fieldEditors.notes} />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Use the Discussion thread below for back-and-forth between
                  operators / quality / planner.
                </p>
                <FieldError messages={fieldErrors.notes} />
              </div>
            </div>

            {actionError && (
              <ErrorBanner
                detail={actionError.detail}
                code={actionError.code}
                debug={actionError.debug}
              />
            )}

            {!readOnly && (
              <>
                {!isCreator && creator && (
                  <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
                    <Lock className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      Only{" "}
                      <span className="font-medium text-foreground">
                        {creator.name}
                      </span>{" "}
                      can save from this room.
                    </span>
                  </div>
                )}
                <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
                  {dirty && !pending && isCreator && (
                    <Button type="button" variant="ghost" onClick={onReset}>
                      Discard
                    </Button>
                  )}
                  <Button
                    type="submit"
                    disabled={!dirty || pending || !isCreator}
                    title={
                      !isCreator && creator
                        ? `Only ${creator.name} can save from this room.`
                        : undefined
                    }
                  >
                    {pending && (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    )}
                    Save changes
                  </Button>
                </div>
              </>
            )}
          </form>
        </fieldset>
      </CardContent>
    </Card>
  );
}

function SectionSubhead({ title }: { title: string }) {
  return (
    <div className="border-t border-border/60 pt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
    </div>
  );
}

function PairRow({
  left,
  right,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {left}
      {right}
    </div>
  );
}

interface FieldProps {
  id: string;
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  errors?: string[];
  editor: import("@/lib/realtime/use-live-form").CollabPeer | null;
  hint?: string;
}

function DateTimeField({
  id,
  label,
  value,
  disabled,
  onChange,
  onFocus,
  onBlur,
  errors,
  editor,
  hint,
}: FieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type="datetime-local"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          disabled={disabled}
          aria-invalid={Boolean(errors && errors.length > 0)}
          className={cn(
            "h-10",
            errors && errors.length > 0 &&
              "border-destructive focus-visible:ring-destructive/20",
          )}
        />
        <FieldEditingIndicator peer={editor} />
      </div>
      {hint && (
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      )}
      <FieldError messages={errors} />
    </div>
  );
}

function DecimalField({
  id,
  label,
  value,
  disabled,
  onChange,
  onFocus,
  onBlur,
  errors,
  editor,
}: FieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      <div className="relative max-w-[16rem]">
        <Input
          id={id}
          value={value}
          inputMode="decimal"
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          disabled={disabled}
          placeholder="0.00"
          aria-invalid={Boolean(errors && errors.length > 0)}
          className={cn(
            "h-10 font-mono",
            errors && errors.length > 0 &&
              "border-destructive focus-visible:ring-destructive/20",
          )}
        />
        <FieldEditingIndicator peer={editor} />
      </div>
      <FieldError messages={errors} />
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
      tone: "amber",
      title: "Form is at capacity",
      detail: error.limit
        ? `Up to ${error.limit} people can edit this operation at once.`
        : "Wait for someone to leave, then refresh.",
    },
    forbidden: {
      icon: LockKeyhole,
      tone: "muted",
      title: "You can't edit here",
      detail:
        "Ask an admin for production.mo_edit or production.mo_execute to join.",
    },
    bad_topic: {
      icon: AlertCircle,
      tone: "destructive",
      title: "Unknown form",
      detail: "We couldn't find this operation room.",
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

