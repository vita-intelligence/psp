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
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
import type { CompanyDefaults } from "@/lib/types";
import type { FieldErrors } from "@/lib/auth/actions";
import type { ErrorResult } from "@/lib/errors/server";
import { cn } from "@/lib/utils";
import { useLiveForm } from "@/lib/realtime/use-live-form";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import { invalidateAudit } from "@/lib/audit/invalidator";
import {
  createWorkstationAction,
  deleteWorkstationAction,
  updateWorkstationAction,
} from "@/lib/production/actions";
import type { Workstation } from "@/lib/production/types";

interface GroupOption extends SearchPickerOption {
  hourlyRate: string | null;
  hourlyRateEnabled: boolean;
}

interface SiteOption extends SearchPickerOption {
  kind: string;
}

interface WorkerOption extends SearchPickerOption {
  email: string;
  uuid: string;
}

interface FormState {
  name: string;
  notes: string;
  workstation_group: GroupOption | null;
  warehouse: SiteOption | null;
  productivity: string;
  hourly_rate_enabled: boolean;
  hourly_rate: string;
  idle_from: string;
  idle_to: string;
  is_active: boolean;
  default_workers: WorkerOption[];
}

interface WorkstationFormProps {
  workstation: Workstation | null;
  company: CompanyDefaults;
  canEdit: boolean;
  canDelete: boolean;
}

function initialFrom(ws: Workstation | null): FormState {
  if (!ws) {
    return {
      name: "",
      notes: "",
      workstation_group: null,
      warehouse: null,
      productivity: "1.00",
      hourly_rate_enabled: false,
      hourly_rate: "",
      idle_from: "",
      idle_to: "",
      is_active: true,
      default_workers: [],
    };
  }
  return {
    name: ws.name,
    notes: ws.notes ?? "",
    workstation_group: ws.workstation_group
      ? {
          id: ws.workstation_group.id,
          label: ws.workstation_group.name,
          code: ws.workstation_group.code,
          hourlyRate: ws.workstation_group.hourly_rate,
          hourlyRateEnabled: ws.workstation_group.hourly_rate_enabled,
        }
      : null,
    warehouse: ws.warehouse
      ? {
          id: ws.warehouse.id,
          label: ws.warehouse.name,
          code: ws.warehouse.code,
          kind: ws.warehouse.kind,
        }
      : null,
    productivity: ws.productivity ?? "1.00",
    hourly_rate_enabled: ws.hourly_rate_enabled,
    hourly_rate: ws.hourly_rate ?? "",
    idle_from: ws.idle_from ?? "",
    idle_to: ws.idle_to ?? "",
    is_active: ws.is_active,
    default_workers: (ws.default_workers ?? []).map((u) => ({
      id: u.id,
      uuid: u.uuid,
      label: u.name,
      email: u.email,
    })),
  };
}

export function WorkstationForm({
  workstation,
  company,
  canEdit,
  canDelete,
}: WorkstationFormProps) {
  const router = useRouter();
  const resource = workstation
    ? `workstation:${workstation.uuid}`
    : "workstation:new";
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
    initialState: useMemo(() => initialFrom(workstation), [workstation]),
    onCommit: (raw) => {
      const msg = raw as CommitPayload | null;
      if (!msg) return;
      if (msg.kind === "created") {
        toast.success("Workstation created", {
          description: `${creator?.name ?? "The host"} just finalized "${msg.name}".`,
        });
        router.push(`/production/workstations/${msg.uuid}`);
      } else if (msg.kind === "saved") {
        toast.success("Saved", {
          description: `${creator?.name ?? "The host"} just saved the form.`,
        });
        setOriginal(msg.state);
        resetState(msg.state);
        if (workstation) invalidateAudit("workstation", workstation.id);
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
    initialFrom(workstation),
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [deletePending, setDeletePending] = useState(false);

  const dirty = JSON.stringify(state) !== JSON.stringify(original);

  // ---- pickers --------------------------------------------------

  async function searchGroups(q: string): Promise<GroupOption[]> {
    try {
      const url = q
        ? `/api/production/workstation-groups?search=${encodeURIComponent(q)}&limit=25`
        : `/api/production/workstation-groups?limit=25`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return [];
      const body = (await res.json()) as {
        items?: Array<{
          id: number;
          name: string;
          code: string | null;
          hourly_rate: string | null;
          hourly_rate_enabled: boolean;
        }>;
      };
      return (body.items ?? []).map((g) => ({
        id: g.id,
        label: g.name,
        code: g.code,
        hourlyRate: g.hourly_rate,
        hourlyRateEnabled: g.hourly_rate_enabled,
      }));
    } catch {
      return [];
    }
  }

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

  function addWorker(opt: WorkerOption | null) {
    if (!opt) return;
    if (state.default_workers.some((w) => w.id === opt.id)) return;
    setField("default_workers", [...state.default_workers, opt]);
  }

  function removeWorker(id: number) {
    setField(
      "default_workers",
      state.default_workers.filter((w) => w.id !== id),
    );
  }

  // ---- submit ---------------------------------------------------

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setActionError(null);

    if (!state.workstation_group) {
      setFieldErrors({ workstation_group_id: ["Pick a workstation group."] });
      return;
    }
    if (!state.warehouse) {
      setFieldErrors({ warehouse_id: ["Pick a production site."] });
      return;
    }

    const productivityNum = Number(state.productivity);
    if (!Number.isFinite(productivityNum) || productivityNum <= 0) {
      setFieldErrors({ productivity: ["Must be greater than zero."] });
      return;
    }

    const payload = {
      name: state.name.trim(),
      notes: state.notes.trim() || null,
      workstation_group_id: state.workstation_group.id,
      warehouse_id: state.warehouse.id,
      productivity: String(productivityNum),
      hourly_rate_enabled: state.hourly_rate_enabled,
      hourly_rate: state.hourly_rate_enabled
        ? state.hourly_rate.trim() || null
        : null,
      idle_from: state.idle_from || null,
      idle_to: state.idle_to || null,
      is_active: state.is_active,
      default_worker_ids: state.default_workers.map((w) => w.id),
    };

    startTransition(async () => {
      const res = workstation
        ? await updateWorkstationAction(workstation.uuid, payload)
        : await createWorkstationAction(payload);

      if (res.ok) {
        toast.success(workstation ? "Workstation saved" : "Workstation created");
        setOriginal(state);
        invalidateAudit("workstation", res.workstation.id);
        if (workstation) {
          broadcastCommit({ kind: "saved", state });
        } else {
          broadcastCommit({
            kind: "created",
            uuid: res.workstation.uuid,
            name: res.workstation.name,
          });
          router.push(`/production/workstations/${res.workstation.uuid}`);
        }
        return;
      }
      setFieldErrors(res.fields ?? {});
      setActionError(res);
    });
  }

  async function onDelete() {
    if (!workstation) return;
    if (
      !window.confirm(
        `Delete "${workstation.name}"? Any future scheduling on this station will need to be re-assigned.`,
      )
    ) {
      return;
    }
    setDeletePending(true);
    const res = await deleteWorkstationAction(workstation.uuid);
    setDeletePending(false);
    if (res.ok) {
      toast.success("Workstation deleted");
      router.push("/production/workstations");
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

  // Inheritance label for the hourly rate section: when the override
  // is off, show what the schedule will actually use (group rate or
  // "no rate") so the operator isn't guessing.
  const inheritedRateLabel = state.workstation_group
    ? state.workstation_group.hourlyRateEnabled && state.workstation_group.hourlyRate
      ? `${state.workstation_group.hourlyRate} ${company.currency_code} / h from "${state.workstation_group.label}"`
      : `No rate set on "${state.workstation_group.label}"`
    : "Pick a workstation group first";

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
              {workstation ? workstation.name : "New workstation"}
            </CardTitle>
            <CardDescription>
              One physical workstation inside a group on a production
              site. Schedule, MOs, and vita-performance scoring read
              against this row.
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

              <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
                <Label className="pt-2.5 text-sm font-medium">
                  Type <span className="text-destructive">*</span>
                </Label>
                <div className="space-y-1.5">
                  <SearchPicker<GroupOption>
                    value={state.workstation_group}
                    onChange={(opt) => setField("workstation_group", opt)}
                    fetcher={searchGroups}
                    placeholder="Pick a workstation group…"
                    disabled={!canEdit}
                    onFocus={() => focusField("workstation_group_id")}
                    onBlur={() => blurField("workstation_group_id")}
                  />
                  <FieldError messages={fieldErrors.workstation_group_id} />
                </div>
              </div>

              <CollabRow
                id="productivity"
                label="Productivity"
                required
                value={state.productivity}
                onChange={(v) => setField("productivity", v)}
                onFocus={focusField}
                onBlur={blurField}
                editor={fieldEditors.productivity}
                errors={fieldErrors.productivity}
                mono
                hint="Throughput multiplier — 1.00 is the group's baseline. Higher = faster than baseline."
              />

              <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
                <Label className="pt-2.5 text-sm font-medium">
                  Site <span className="text-destructive">*</span>
                </Label>
                <div className="space-y-1.5">
                  <SearchPicker<SiteOption>
                    value={state.warehouse}
                    onChange={(opt) => setField("warehouse", opt)}
                    fetcher={searchSites}
                    placeholder="Pick a production site…"
                    disabled={!canEdit}
                    onFocus={() => focusField("warehouse_id")}
                    onBlur={() => blurField("warehouse_id")}
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
                <Label className="pt-1.5 text-sm font-medium">Active</Label>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={state.is_active}
                    onCheckedChange={(v) => setField("is_active", v)}
                    aria-label="Workstation is active"
                  />
                  <span className="text-sm text-muted-foreground">
                    {state.is_active
                      ? "Active — visible in the schedule + on MOs."
                      : "Inactive — hidden from selectors."}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-md border border-border/60 bg-muted/30 p-4">
              <SectionTitle>Hourly rate</SectionTitle>
              <div className="flex items-start gap-3">
                <Switch
                  checked={state.hourly_rate_enabled}
                  onCheckedChange={(v) => {
                    setField("hourly_rate_enabled", v);
                    if (!v) setField("hourly_rate", "");
                  }}
                  aria-label="Override the group's hourly rate"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {state.hourly_rate_enabled
                      ? "Custom rate for this workstation"
                      : "Inheriting from group"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Currently:{" "}
                    <span className="font-medium text-foreground">
                      {state.hourly_rate_enabled
                        ? `${state.hourly_rate || "—"} ${company.currency_code} / h`
                        : inheritedRateLabel}
                    </span>
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

            <div className="space-y-3 rounded-md border border-border/60 bg-muted/30 p-4">
              <SectionTitle>Default workers</SectionTitle>
              <p className="text-xs text-muted-foreground">
                Operators pre-assigned to MOs running here. The picker
                searches across all users; remove a chip to drop an
                assignment.
              </p>

              {state.default_workers.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {state.default_workers.map((w) => (
                    <span
                      key={w.id}
                      className="inline-flex items-center gap-1.5 rounded-full bg-background px-2.5 py-1 text-xs"
                    >
                      <span className="font-medium">{w.label}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {w.email}
                      </span>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => removeWorker(w.id)}
                          aria-label={`Remove ${w.label}`}
                          className="rounded-full p-0.5 hover:bg-destructive/10 hover:text-destructive"
                        >
                          <X className="size-3" />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}

              <SearchPicker<WorkerOption>
                value={null}
                onChange={(opt) => addWorker(opt)}
                fetcher={searchWorkers}
                placeholder="Add a default worker…"
                disabled={!canEdit}
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

            <div className="space-y-3 rounded-md border border-border/60 bg-muted/30 p-4">
              <SectionTitle>Planned idle window</SectionTitle>
              <p className="text-xs text-muted-foreground">
                Mark the workstation offline for a fixed window
                (maintenance, refurb). Leave both empty when in normal
                operation.
              </p>
              <div className="grid gap-2 sm:grid-cols-2 sm:gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="idle_from" className="text-sm">From</Label>
                  <div className="relative">
                    <Input
                      id="idle_from"
                      type="date"
                      value={state.idle_from}
                      onChange={(e) => setField("idle_from", e.target.value)}
                      onFocus={() => focusField("idle_from")}
                      onBlur={() => blurField("idle_from")}
                    />
                    <FieldEditingIndicator peer={fieldEditors.idle_from} />
                  </div>
                  <FieldError messages={fieldErrors.idle_from} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="idle_to" className="text-sm">To</Label>
                  <div className="relative">
                    <Input
                      id="idle_to"
                      type="date"
                      value={state.idle_to}
                      onChange={(e) => setField("idle_to", e.target.value)}
                      onFocus={() => focusField("idle_to")}
                      onBlur={() => blurField("idle_to")}
                    />
                    <FieldEditingIndicator peer={fieldEditors.idle_to} />
                  </div>
                  <FieldError messages={fieldErrors.idle_to} />
                </div>
              </div>
            </div>

            {workstation?.external_id && (
              <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2.5 text-xs">
                <p className="font-medium">vita-performance link</p>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {workstation.external_id}
                </p>
                <p className="mt-0.5 text-muted-foreground">
                  Read-only. Populated by the sync job — matches the
                  `kiosk_token` on the mirror row in vita-performance.
                </p>
              </div>
            )}

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
                      can {workstation ? "save" : "create"} from this room. Your
                      edits sync to them live.
                    </span>
                  </div>
                )}
                <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-between">
                  <div>
                    {workstation && canDelete && isCreator && (
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
                                workstation ? "save" : "create"
                              } from this room.`
                            : undefined
                      }
                    >
                      {pending && (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      )}
                      {workstation ? "Save changes" : "Create workstation"}
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
        ? `Up to ${error.limit} people can edit this form at once.`
        : "Wait for someone to leave, then refresh.",
    },
    forbidden: {
      icon: LockKeyhole,
      tone: "muted",
      title: "You can't edit here",
      detail:
        "Ask an admin for the `production.workstation_edit` permission to join this form.",
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

// Silence unused imports if a feature is dropped — kept here so the
// next iteration can wire them in (Plus icon for an "add worker"
// button if we switch off the inline picker).
void Plus;
