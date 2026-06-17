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
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  WorkingHoursEditor,
  summarizeWorkingHours,
} from "@/components/scheduling/working-hours-editor";
import {
  HolidaysEditor,
  summarizeHolidays,
} from "@/components/scheduling/holidays-editor";
import type { WorkingHours, Holiday } from "@/lib/company/bags";
import type { CompanyDefaults } from "@/lib/types";
import type { FieldErrors } from "@/lib/auth/actions";
import type { ErrorResult } from "@/lib/errors/server";
import { cn } from "@/lib/utils";
import { useLiveForm } from "@/lib/realtime/use-live-form";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import { invalidateAudit } from "@/lib/audit/invalidator";
import {
  createWorkstationGroupAction,
  deleteWorkstationGroupAction,
  updateWorkstationGroupAction,
} from "@/lib/production/actions";
import type {
  WorkstationGroup,
  WorkstationGroupKind,
} from "@/lib/production/types";

interface FormState {
  name: string;
  notes: string;
  default_operation_notes: string;
  instances: string;
  kind: WorkstationGroupKind;
  hourly_rate_enabled: boolean;
  hourly_rate: string;
  custom_working_hours: boolean;
  working_hours: WorkingHours;
  custom_holidays: boolean;
  holidays: Holiday[];
  color: string | null;
  is_active: boolean;
}

interface WorkstationGroupFormProps {
  /** `null` ⇒ create mode; otherwise edit. */
  group: WorkstationGroup | null;
  company: CompanyDefaults;
  canEdit: boolean;
  canDelete: boolean;
  /** Fired on successful save so the EditModeToggle wrapper flips
   *  the page back to view mode. */
  onSavedSuccess?: () => void;
}

const KIND_LABELS: Record<WorkstationGroupKind, string> = {
  active_processing: "Active processing",
  passive_processing: "Passive processing",
};

const KIND_HINTS: Record<WorkstationGroupKind, string> = {
  active_processing:
    "Operator-driven. The schedule consumes labour against the group.",
  passive_processing:
    "Machine runs unattended after setup (ovens, curing, fermentation).",
};

// MRPEasy-style palette. Stored as `#rrggbb`; an empty string means
// "no colour assigned" and the schedule view falls back to the
// neutral chip styling.
const COLOR_PALETTE = [
  "#16a34a",
  "#84cc16",
  "#65a30d",
  "#15803d",
  "#10b981",
  "#22d3ee",
  "#06b6d4",
  "#0284c7",
  "#0ea5e9",
  "#1d4ed8",
  "#1e3a8a",
  "#312e81",
  "#7c3aed",
  "#9333ea",
  "#a21caf",
  "#be185d",
  "#db2777",
  "#dc2626",
  "#ef4444",
  "#7f1d1d",
  "#ea580c",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#facc15",
  "#a3e635",
];

function initialFrom(group: WorkstationGroup | null): FormState {
  if (!group) {
    return {
      name: "",
      notes: "",
      default_operation_notes: "",
      instances: "1",
      kind: "active_processing",
      hourly_rate_enabled: false,
      hourly_rate: "",
      custom_working_hours: false,
      working_hours: {},
      custom_holidays: false,
      holidays: [],
      color: null,
      is_active: true,
    };
  }
  return {
    name: group.name,
    notes: group.notes ?? "",
    default_operation_notes: group.default_operation_notes ?? "",
    instances: String(group.instances ?? 1),
    kind: group.kind,
    hourly_rate_enabled: group.hourly_rate_enabled,
    hourly_rate: group.hourly_rate ?? "",
    custom_working_hours: group.custom_working_hours,
    working_hours: (group.working_hours as WorkingHours) ?? {},
    custom_holidays: group.custom_holidays,
    holidays: (group.holidays ?? []).map((d) => ({ date: d, name: "" })),
    color: group.color,
    is_active: group.is_active,
  };
}

export function WorkstationGroupForm({
  group,
  company,
  canEdit,
  canDelete,
  onSavedSuccess,
}: WorkstationGroupFormProps) {
  const router = useRouter();
  const resource = group
    ? `workstation-group:${group.uuid}`
    : "workstation-group:new";

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
    initialState: useMemo(() => initialFrom(group), [group]),
    onCommit: (raw) => {
      const msg = raw as CommitPayload | null;
      if (!msg) return;
      if (msg.kind === "created") {
        toast.success("Workstation group created", {
          description: `${creator?.name ?? "The host"} just finalized "${msg.name}".`,
        });
        router.push(`/production/workstation-groups/${msg.uuid}`);
      } else if (msg.kind === "saved") {
        toast.success("Saved", {
          description: `${creator?.name ?? "The host"} just saved the form.`,
        });
        setOriginal(msg.state);
        resetState(msg.state);
        if (group) invalidateAudit("workstation_group", group.id);
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

  useEffect(() => {
    return () => hideCursor();
  }, [hideCursor]);

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

  const [original, setOriginal] = useState<FormState>(() => initialFrom(group));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [deletePending, setDeletePending] = useState(false);

  const dirty = JSON.stringify(state) !== JSON.stringify(original);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setActionError(null);

    const instances = Number(state.instances);
    if (!Number.isFinite(instances) || instances < 1) {
      setFieldErrors({ instances: ["Must be a whole number 1 or more."] });
      return;
    }

    const payload = {
      name: state.name.trim(),
      notes: state.notes.trim() || null,
      default_operation_notes: state.default_operation_notes.trim() || null,
      instances,
      kind: state.kind,
      hourly_rate_enabled: state.hourly_rate_enabled,
      hourly_rate: state.hourly_rate_enabled
        ? state.hourly_rate.trim() || null
        : null,
      custom_working_hours: state.custom_working_hours,
      working_hours: state.custom_working_hours
        ? (state.working_hours as Record<string, unknown>)
        : {},
      custom_holidays: state.custom_holidays,
      holidays: state.custom_holidays
        ? state.holidays.map((h) => h.date).filter(Boolean)
        : [],
      color: state.color,
      is_active: state.is_active,
    };

    startTransition(async () => {
      const res = group
        ? await updateWorkstationGroupAction(group.uuid, payload)
        : await createWorkstationGroupAction(payload);

      if (res.ok) {
        toast.success(group ? "Workstation group saved" : "Workstation group created");
        setOriginal(state);
        invalidateAudit("workstation_group", res.group.id);

        if (group) {
          broadcastCommit({ kind: "saved", state });
          onSavedSuccess?.();
        } else {
          broadcastCommit({
            kind: "created",
            uuid: res.group.uuid,
            name: res.group.name,
          });
          router.push(`/production/workstation-groups/${res.group.uuid}`);
        }
        return;
      }
      setFieldErrors(res.fields ?? {});
      setActionError(res);
    });
  }

  async function onDelete() {
    if (!group) return;
    if (
      !window.confirm(
        `Delete "${group.name}"? Workstations attached to this group will need to be reassigned.`,
      )
    ) {
      return;
    }
    setDeletePending(true);
    const res = await deleteWorkstationGroupAction(group.uuid);
    setDeletePending(false);
    if (res.ok) {
      toast.success("Workstation group deleted");
      router.push("/production/workstation-groups");
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
              {group ? group.name : "New workstation group"}
            </CardTitle>
            <CardDescription>
              Group of identical workstations — an oven bank, packaging
              line, blending station. Working hours and holidays inherit
              from{" "}
              <span className="font-medium text-foreground">
                {company.name}
              </span>{" "}
              unless overridden.
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
              <SectionTitle>General</SectionTitle>

              <CollabRow
                id="name"
                label="Name"
                required
                value={state.name}
                onChange={(v) => setField("name", v)}
                onFocus={focusField}
                onBlur={blurField}
                editor={fieldEditors.name}
                errors={fieldErrors.name}
              />

              <CollabRow
                id="instances"
                label="Number of instances"
                value={state.instances}
                onChange={(v) => setField("instances", v.replace(/[^\d]/g, ""))}
                onFocus={focusField}
                onBlur={blurField}
                editor={fieldEditors.instances}
                errors={fieldErrors.instances}
                hint="How many identical workstations are in this group (1+)."
                mono
              />

              <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
                <Label className="pt-2.5 text-sm font-medium">Type</Label>
                <div className="space-y-1.5">
                  <div className="relative">
                    <Select
                      value={state.kind}
                      onValueChange={(v) =>
                        setField("kind", v as WorkstationGroupKind)
                      }
                    >
                      <SelectTrigger
                        onFocus={() => focusField("kind")}
                        onBlur={() => blurField("kind")}
                        className="h-10 w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(["active_processing", "passive_processing"] as const).map(
                          (k) => (
                            <SelectItem key={k} value={k}>
                              {KIND_LABELS[k]}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                    <FieldEditingIndicator peer={fieldEditors.kind} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {KIND_HINTS[state.kind]}
                  </p>
                </div>
              </div>

              <CollabTextareaRow
                id="notes"
                label="Notes"
                value={state.notes}
                onChange={(v) => setField("notes", v)}
                onFocus={focusField}
                onBlur={blurField}
                editor={fieldEditors.notes}
                errors={fieldErrors.notes}
              />

              <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
                <Label
                  htmlFor="default_operation_notes"
                  className="pt-2.5 text-sm font-medium"
                >
                  Default operation notes
                </Label>
                <div className="space-y-1.5">
                  <div className="relative">
                    <Textarea
                      id="default_operation_notes"
                      value={state.default_operation_notes}
                      onChange={(e) =>
                        setField("default_operation_notes", e.target.value)
                      }
                      onFocus={() => focusField("default_operation_notes")}
                      onBlur={() => blurField("default_operation_notes")}
                      rows={6}
                      placeholder="Standard operating procedure for this group — checks, weights, time targets, safety notes…"
                      aria-invalid={Boolean(
                        fieldErrors.default_operation_notes &&
                          fieldErrors.default_operation_notes.length > 0,
                      )}
                    />
                    <FieldEditingIndicator
                      peer={fieldEditors.default_operation_notes}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Auto-fills the operation description on routing steps and
                    MO operations whenever this group is picked. Individual
                    workstations can override.
                  </p>
                  <FieldError messages={fieldErrors.default_operation_notes} />
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
                <Label className="pt-1.5 text-sm font-medium">Active</Label>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={state.is_active}
                    onCheckedChange={(v) => setField("is_active", v)}
                    aria-label="Workstation group is active"
                  />
                  <span className="text-sm text-muted-foreground">
                    {state.is_active
                      ? "Active — visible in the schedule and routings."
                      : "Inactive — hidden from selectors."}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-4 rounded-md border border-border/60 bg-muted/30 p-4">
              <SectionTitle>Hourly rate</SectionTitle>
              <div className="flex items-start gap-3">
                <Switch
                  checked={state.hourly_rate_enabled}
                  onCheckedChange={(v) => {
                    setField("hourly_rate_enabled", v);
                    if (!v) setField("hourly_rate", "");
                  }}
                  aria-label="Set a per-hour cost rate"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {state.hourly_rate_enabled
                      ? "Tracking an hourly labour cost"
                      : "No hourly cost tracked"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    When on, manufacturing-order costing includes a
                    labour charge of{" "}
                    <span className="font-medium text-foreground">
                      {state.hourly_rate || "—"}
                    </span>{" "}
                    {company.currency_code} per hour of runtime against
                    this group.
                  </p>
                </div>
              </div>
              {state.hourly_rate_enabled && (
                <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
                  <Label
                    htmlFor="hourly_rate"
                    className="pt-2.5 text-sm font-medium"
                  >
                    Rate ({company.currency_code})
                  </Label>
                  <div className="space-y-1.5">
                    <div className="relative">
                      <Input
                        id="hourly_rate"
                        value={state.hourly_rate}
                        onChange={(e) => setField("hourly_rate", e.target.value)}
                        onFocus={() => focusField("hourly_rate")}
                        onBlur={() => blurField("hourly_rate")}
                        inputMode="decimal"
                        placeholder="0.00"
                        className="h-10 font-mono"
                      />
                      <FieldEditingIndicator peer={fieldEditors.hourly_rate} />
                    </div>
                    <FieldError messages={fieldErrors.hourly_rate} />
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-4 rounded-md border border-border/60 bg-muted/30 p-4">
              <SectionTitle>Working hours</SectionTitle>
              <div className="flex items-start gap-3">
                <Switch
                  checked={state.custom_working_hours}
                  onCheckedChange={(v) => {
                    setField("custom_working_hours", v);
                    if (!v) setField("working_hours", {});
                    else if (
                      Object.keys(state.working_hours).length === 0 &&
                      company.working_hours
                    ) {
                      setField(
                        "working_hours",
                        company.working_hours as WorkingHours,
                      );
                    }
                  }}
                  aria-label="Override company working hours"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {state.custom_working_hours
                      ? "Group-specific schedule"
                      : "Inheriting from company"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Currently:{" "}
                    <span className="font-medium text-foreground">
                      {state.custom_working_hours
                        ? summarizeWorkingHours(state.working_hours)
                        : summarizeWorkingHours(
                            company.working_hours as WorkingHours | null,
                          )}
                    </span>
                  </p>
                </div>
              </div>
              {state.custom_working_hours && (
                <WorkingHoursEditor
                  value={state.working_hours}
                  onChange={(v) => setField("working_hours", v)}
                />
              )}
            </div>

            <div className="space-y-4 rounded-md border border-border/60 bg-muted/30 p-4">
              <SectionTitle>Holidays</SectionTitle>
              <div className="flex items-start gap-3">
                <Switch
                  checked={state.custom_holidays}
                  onCheckedChange={(v) => {
                    setField("custom_holidays", v);
                    if (!v) setField("holidays", []);
                  }}
                  aria-label="Override company holidays"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {state.custom_holidays
                      ? "Group-specific holiday list"
                      : "Inheriting from company"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Currently:{" "}
                    <span className="font-medium text-foreground">
                      {state.custom_holidays
                        ? summarizeHolidays(state.holidays)
                        : "Company defaults"}
                    </span>
                  </p>
                </div>
              </div>
              {state.custom_holidays && (
                <HolidaysEditor
                  value={state.holidays}
                  onChange={(v) => setField("holidays", v)}
                />
              )}
            </div>

            <div className="space-y-3 rounded-md border border-border/60 bg-muted/30 p-4">
              <SectionTitle>Colour</SectionTitle>
              <p className="text-xs text-muted-foreground">
                Used to colour this group in the schedule view and on
                routing diagrams.
              </p>
              <div className="flex flex-wrap gap-2">
                {COLOR_PALETTE.map((c) => {
                  const active = state.color === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Pick ${c}`}
                      onClick={() => setField("color", c)}
                      className={cn(
                        "size-7 rounded-md border-2 transition",
                        active
                          ? "border-foreground/80 ring-2 ring-offset-2 ring-foreground/30"
                          : "border-transparent hover:border-border",
                      )}
                      style={{ backgroundColor: c }}
                    />
                  );
                })}
                {state.color && (
                  <button
                    type="button"
                    onClick={() => setField("color", null)}
                    className="rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-muted"
                  >
                    Clear
                  </button>
                )}
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
                      can {group ? "save" : "create"} from this room. Your
                      edits sync to them live.
                    </span>
                  </div>
                )}
                <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-between">
                  <div>
                    {group && canDelete && isCreator && (
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
                                group ? "save" : "create"
                              } from this room.`
                            : undefined
                      }
                    >
                      {pending && (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      )}
                      {group ? "Save changes" : "Create group"}
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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  );
}

interface CollabRowProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onFocus: (field: string) => void;
  onBlur: (field: string) => void;
  editor: import("@/lib/realtime/use-live-form").CollabPeer | null;
  errors?: string[];
  required?: boolean;
  placeholder?: string;
  hint?: string;
  mono?: boolean;
}

function CollabRow({
  id,
  label,
  value,
  onChange,
  onFocus,
  onBlur,
  editor,
  errors,
  required,
  placeholder,
  hint,
  mono,
}: CollabRowProps) {
  const hasError = Boolean(errors && errors.length > 0);
  return (
    <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
      <Label htmlFor={id} className="pt-2.5 text-sm font-medium">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      <div className="space-y-1.5">
        <div className="relative">
          <Input
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => onFocus(id)}
            onBlur={() => onBlur(id)}
            required={required}
            placeholder={placeholder}
            aria-invalid={hasError}
            className={cn(
              "h-11",
              mono && "font-mono",
              hasError && "border-destructive focus-visible:ring-destructive/20",
            )}
          />
          <FieldEditingIndicator peer={editor} />
        </div>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        <FieldError messages={errors} />
      </div>
    </div>
  );
}

interface CollabTextareaRowProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onFocus: (field: string) => void;
  onBlur: (field: string) => void;
  editor: import("@/lib/realtime/use-live-form").CollabPeer | null;
  errors?: string[];
}

function CollabTextareaRow({
  id,
  label,
  value,
  onChange,
  onFocus,
  onBlur,
  editor,
  errors,
}: CollabTextareaRowProps) {
  const hasError = Boolean(errors && errors.length > 0);
  return (
    <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
      <Label htmlFor={id} className="pt-2.5 text-sm font-medium">
        {label}
      </Label>
      <div className="space-y-1.5">
        <div className="relative">
          <Textarea
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => onFocus(id)}
            onBlur={() => onBlur(id)}
            rows={3}
            aria-invalid={hasError}
            className={cn(
              hasError && "border-destructive focus-visible:ring-destructive/20",
            )}
          />
          <FieldEditingIndicator peer={editor} />
        </div>
        <FieldError messages={errors} />
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
      tone: "amber",
      title: "Form is at capacity",
      detail: error.limit
        ? `Up to ${error.limit} people can edit this form at once. Wait for someone to leave, then refresh.`
        : "Wait for someone to leave, then refresh.",
    },
    forbidden: {
      icon: LockKeyhole,
      tone: "muted",
      title: "You can't edit here",
      detail:
        "Ask an admin for the `production.workstation_group_edit` permission to join this form.",
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
