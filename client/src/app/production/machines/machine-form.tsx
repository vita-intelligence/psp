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
  AlertTriangle,
  Factory,
  Gauge,
  Loader2,
  Lock,
  LockKeyhole,
  Trash2,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { subscribeRestore } from "@/lib/audit/invalidator";
import {
  createMachineAction,
  deleteMachineAction,
  recalibrateMachineAction,
  updateMachineAction,
} from "@/lib/production/actions";
import type { Machine } from "@/lib/production/types";

// A machine attaches to exactly one workstation and carries its own
// per-hour cost + calibration cadence. Cost cascade (BE-computed):
//   SUM(active machines' hourly_rate) → workstation.hourly_rate
//     → workstation_group.hourly_rate → £0.
// This form is the compliance surface: the Recalibrate action is the
// only path that stamps `last_calibrated_at` in the audit trail; the
// date input is only exposed for backfill.

interface WorkstationOption extends SearchPickerOption {
  groupName: string | null;
}

interface FormState {
  name: string;
  notes: string;
  workstation: WorkstationOption | null;
  hourly_rate_enabled: boolean;
  hourly_rate: string;
  asset_tag: string;
  serial_number: string;
  manufacturer: string;
  model: string;
  commissioned_at: string;
  last_calibrated_at: string;
  calibration_frequency_months: string;
  next_calibration_due_at: string;
  is_active: boolean;
}

interface MachineFormProps {
  machine: Machine | null;
  company: CompanyDefaults;
  canEdit: boolean;
  canDelete: boolean;
  /** Whether the current user may trigger the compliant Recalibrate
   *  action (stamps last_calibrated_at + recomputes next_due). Hides
   *  the button when false — the plain date inputs are still there
   *  under the edit gate for admin backfill. */
  canRecalibrate: boolean;
  /** Prefilled workstation_id when landing from /new?workstation_id=.
   *  Ignored on the edit form. */
  defaultWorkstationId?: number | null;
  /** Fired on successful save so the EditModeToggle wrapper flips
   *  the page back to view mode. */
  onSavedSuccess?: () => void;
}

function initialFrom(
  machine: Machine | null,
  defaultWorkstationId?: number | null,
): FormState {
  if (!machine) {
    return {
      name: "",
      notes: "",
      workstation:
        defaultWorkstationId && Number.isFinite(defaultWorkstationId)
          ? {
              id: defaultWorkstationId,
              label: "Loading workstation…",
              groupName: null,
            }
          : null,
      hourly_rate_enabled: false,
      hourly_rate: "",
      asset_tag: "",
      serial_number: "",
      manufacturer: "",
      model: "",
      commissioned_at: "",
      last_calibrated_at: "",
      calibration_frequency_months: "",
      next_calibration_due_at: "",
      is_active: true,
    };
  }
  return {
    name: machine.name,
    notes: machine.notes ?? "",
    workstation: machine.workstation
      ? {
          id: machine.workstation.id,
          label: machine.workstation.name,
          code: machine.workstation.code,
          groupName: machine.workstation.workstation_group?.name ?? null,
        }
      : null,
    hourly_rate_enabled: machine.hourly_rate_enabled,
    hourly_rate: machine.hourly_rate ?? "",
    asset_tag: machine.asset_tag ?? "",
    serial_number: machine.serial_number ?? "",
    manufacturer: machine.manufacturer ?? "",
    model: machine.model ?? "",
    commissioned_at: machine.commissioned_at ?? "",
    last_calibrated_at: machine.last_calibrated_at ?? "",
    calibration_frequency_months:
      machine.calibration_frequency_months?.toString() ?? "",
    next_calibration_due_at: machine.next_calibration_due_at ?? "",
    is_active: machine.is_active,
  };
}

export function MachineForm({
  machine,
  company,
  canEdit,
  canDelete,
  canRecalibrate,
  defaultWorkstationId,
  onSavedSuccess,
}: MachineFormProps) {
  const router = useRouter();
  const resource = machine ? `machine:${machine.uuid}` : "machine:new";
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
      () => initialFrom(machine, defaultWorkstationId),
      [machine, defaultWorkstationId],
    ),
    onCommit: (raw) => {
      const msg = raw as CommitPayload | null;
      if (!msg) return;
      if (msg.kind === "created") {
        toast.success("Machine created", {
          description: `${creator?.name ?? "The host"} just finalized "${msg.name}".`,
        });
        router.push(`/production/machines/${msg.uuid}`);
      } else if (msg.kind === "saved") {
        toast.success("Saved", {
          description: `${creator?.name ?? "The host"} just saved the form.`,
        });
        setOriginal(msg.state);
        resetState(msg.state);
        if (machine) invalidateAudit("machine", machine.id);
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
      setCursor(
        (e.clientX - rect.left) / rect.width,
        (e.clientY - rect.top) / rect.height,
      );
    },
    [setCursor],
  );

  const [original, setOriginal] = useState<FormState>(() =>
    initialFrom(machine, defaultWorkstationId),
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [deletePending, setDeletePending] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [recalibrateOpen, setRecalibrateOpen] = useState(false);
  const [recalibratePending, setRecalibratePending] = useState(false);
  const [recalibrateDate, setRecalibrateDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [recalibrateFrequency, setRecalibrateFrequency] = useState<string>(
    () => machine?.calibration_frequency_months?.toString() ?? "",
  );

  // Restore-from-history integration — the Activity card's Restore
  // button pushes a snapshot keyed by (entity_type, entity_id); we
  // populate the current form state so the operator can save it.
  useEffect(() => {
    if (!machine) return;
    return subscribeRestore("machine", machine.id, (snapshot) => {
      const s = snapshot as Partial<FormState> & Record<string, unknown>;
      resetState({
        ...state,
        name: (s.name as string) ?? state.name,
        notes: (s.notes as string) ?? "",
        hourly_rate_enabled:
          (s.hourly_rate_enabled as boolean) ?? state.hourly_rate_enabled,
        hourly_rate: (s.hourly_rate as string) ?? "",
        asset_tag: (s.asset_tag as string) ?? "",
        serial_number: (s.serial_number as string) ?? "",
        manufacturer: (s.manufacturer as string) ?? "",
        model: (s.model as string) ?? "",
        commissioned_at: (s.commissioned_at as string) ?? "",
        last_calibrated_at: (s.last_calibrated_at as string) ?? "",
        calibration_frequency_months:
          s.calibration_frequency_months !== undefined &&
          s.calibration_frequency_months !== null
            ? String(s.calibration_frequency_months)
            : "",
        next_calibration_due_at: (s.next_calibration_due_at as string) ?? "",
        is_active: (s.is_active as boolean) ?? state.is_active,
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machine]);

  const dirty = JSON.stringify(state) !== JSON.stringify(original);

  // ---- workstation picker --------------------------------------

  async function searchWorkstations(q: string): Promise<WorkstationOption[]> {
    try {
      const params = new URLSearchParams();
      params.set("is_active", "true");
      params.set("limit", "200");
      if (q) params.set("search", q);
      const res = await fetch(
        `/api/production/workstations?${params.toString()}`,
        { cache: "no-store" },
      );
      if (!res.ok) return [];
      const body = (await res.json()) as {
        items?: Array<{
          id: number;
          name: string;
          code: string | null;
          workstation_group?: { name: string } | null;
        }>;
      };
      return (body.items ?? []).map((w) => ({
        id: w.id,
        label: w.name,
        code: w.code,
        groupName: w.workstation_group?.name ?? null,
      }));
    } catch {
      return [];
    }
  }

  // Hydrate the "Loading workstation…" placeholder when we arrived
  // with a query-string workstation_id but no label to show.
  useEffect(() => {
    if (
      !machine &&
      state.workstation &&
      state.workstation.label === "Loading workstation…"
    ) {
      (async () => {
        try {
          const res = await fetch(
            `/api/production/workstations?is_active=true&limit=200`,
            { cache: "no-store" },
          );
          if (!res.ok) return;
          const body = (await res.json()) as {
            items?: Array<{
              id: number;
              name: string;
              code: string | null;
              workstation_group?: { name: string } | null;
            }>;
          };
          const found = (body.items ?? []).find(
            (w) => w.id === state.workstation!.id,
          );
          if (found) {
            setField("workstation", {
              id: found.id,
              label: found.name,
              code: found.code,
              groupName: found.workstation_group?.name ?? null,
            });
          }
        } catch {
          /* leave placeholder */
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- submit ---------------------------------------------------

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setActionError(null);

    if (!state.workstation) {
      setFieldErrors({ workstation_id: ["Pick a workstation to attach to."] });
      return;
    }

    const freqRaw = state.calibration_frequency_months.trim();
    let freqInt: number | null = null;
    if (freqRaw !== "") {
      const parsed = Number.parseInt(freqRaw, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setFieldErrors({
          calibration_frequency_months: [
            "Must be a positive integer (months).",
          ],
        });
        return;
      }
      freqInt = parsed;
    }

    const payload = {
      name: state.name.trim(),
      notes: state.notes.trim() || null,
      workstation_id: state.workstation.id,
      hourly_rate_enabled: state.hourly_rate_enabled,
      hourly_rate: state.hourly_rate_enabled
        ? state.hourly_rate.trim() || null
        : null,
      asset_tag: state.asset_tag.trim() || null,
      serial_number: state.serial_number.trim() || null,
      manufacturer: state.manufacturer.trim() || null,
      model: state.model.trim() || null,
      commissioned_at: state.commissioned_at || null,
      last_calibrated_at: state.last_calibrated_at || null,
      calibration_frequency_months: freqInt,
      next_calibration_due_at: state.next_calibration_due_at || null,
      is_active: state.is_active,
    };

    startTransition(async () => {
      const res = machine
        ? await updateMachineAction(machine.uuid, payload)
        : await createMachineAction(payload);

      if (res.ok) {
        toast.success(machine ? "Machine saved" : "Machine created");
        setOriginal(state);
        invalidateAudit("machine", res.machine.id);
        if (machine) {
          broadcastCommit({ kind: "saved", state });
          onSavedSuccess?.();
        } else {
          broadcastCommit({
            kind: "created",
            uuid: res.machine.uuid,
            name: res.machine.name,
          });
          router.push(`/production/machines/${res.machine.uuid}`);
        }
        return;
      }
      setFieldErrors(res.fields ?? {});
      setActionError(res);
    });
  }

  async function onDeleteConfirmed() {
    if (!machine) return;
    setDeletePending(true);
    const res = await deleteMachineAction(machine.uuid);
    setDeletePending(false);
    setDeleteOpen(false);
    if (res.ok) {
      toast.success("Machine deleted");
      router.push("/production/machines");
      router.refresh();
    } else {
      setActionError(res);
    }
  }

  async function onRecalibrateConfirmed() {
    if (!machine) return;
    setRecalibratePending(true);
    const freqParsed = recalibrateFrequency.trim()
      ? Number.parseInt(recalibrateFrequency.trim(), 10)
      : null;
    const res = await recalibrateMachineAction(machine.uuid, {
      calibrated_at: recalibrateDate || undefined,
      frequency_months:
        freqParsed !== null && Number.isFinite(freqParsed) && freqParsed > 0
          ? freqParsed
          : null,
    });
    setRecalibratePending(false);
    if (res.ok) {
      toast.success("Recalibration recorded", {
        description: `Last calibrated: ${res.machine.last_calibrated_at ?? "—"}. Next due: ${res.machine.next_calibration_due_at ?? "—"}.`,
      });
      setRecalibrateOpen(false);
      invalidateAudit("machine", res.machine.id);
      broadcastCommit({
        kind: "saved",
        state: {
          ...state,
          last_calibrated_at: res.machine.last_calibrated_at ?? "",
          next_calibration_due_at: res.machine.next_calibration_due_at ?? "",
          calibration_frequency_months:
            res.machine.calibration_frequency_months?.toString() ?? "",
        },
      });
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
            <CardTitle>{machine ? machine.name : "New machine"}</CardTitle>
            <CardDescription>
              One physical asset attached to a workstation. Sums into
              the workstation&apos;s per-hour cost, and carries its own
              calibration cadence + traceability metadata for audit.
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
            {/* --- Identity ---------------------------------- */}
            <div className="space-y-4">
              <SectionTitle>Identity</SectionTitle>

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
                placeholder="Encapsulator #3"
              />

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
            </div>

            {/* --- Workstation attachment -------------------- */}
            <div className="space-y-4">
              <SectionTitle>Attachment</SectionTitle>

              <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
                <Label className="pt-2.5 text-sm font-medium">
                  Workstation <span className="text-destructive">*</span>
                </Label>
                <div className="space-y-1.5">
                  <SearchPicker<WorkstationOption>
                    value={state.workstation}
                    onChange={(opt) => setField("workstation", opt)}
                    fetcher={searchWorkstations}
                    placeholder="Pick a workstation…"
                    disabled={!canEdit}
                    onFocus={() => focusField("workstation_id")}
                    onBlur={() => blurField("workstation_id")}
                    renderRow={(opt) => (
                      <div className="flex min-w-0 items-center gap-2">
                        <Factory className="size-3.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="truncate text-sm">{opt.label}</p>
                          {opt.groupName && (
                            <p className="truncate text-[10px] text-muted-foreground">
                              {opt.groupName}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  />
                  {state.workstation?.groupName && (
                    <p className="text-xs text-muted-foreground">
                      Group:{" "}
                      <span className="font-medium text-foreground">
                        {state.workstation.groupName}
                      </span>
                    </p>
                  )}
                  <FieldError messages={fieldErrors.workstation_id} />
                </div>
              </div>
            </div>

            {/* --- Machine cost per hour --------------------- */}
            <div className="space-y-3 rounded-md border border-border/60 bg-muted/30 p-4">
              <SectionTitle>Machine cost per hour</SectionTitle>
              <p className="text-xs text-muted-foreground">
                Per-hour machinery cost (energy, depreciation, upkeep).
                Contributes to the sum of machine costs on the
                workstation. NOT worker wages — those come from HR.
              </p>
              <div className="flex items-start gap-3">
                <Switch
                  checked={state.hourly_rate_enabled}
                  onCheckedChange={(v) => {
                    setField("hourly_rate_enabled", v);
                    if (!v) setField("hourly_rate", "");
                  }}
                  aria-label="Charge a per-hour cost for this machine"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {state.hourly_rate_enabled
                      ? "Contributing to the workstation's per-hour rate"
                      : "No cost — this machine is free to run"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Currently:{" "}
                    <span className="font-medium text-foreground">
                      {state.hourly_rate_enabled
                        ? `${state.hourly_rate || "—"} ${company.currency_code} / h`
                        : "—"}
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
                    Machine cost ({company.currency_code} / h)
                  </Label>
                  <div className="space-y-1.5">
                    <div className="relative">
                      <Input
                        id="hourly_rate"
                        value={state.hourly_rate}
                        onChange={(e) =>
                          setField("hourly_rate", e.target.value)
                        }
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

            {/* --- Traceability ----------------------------- */}
            <div className="space-y-3 rounded-md border border-border/60 bg-muted/30 p-4">
              <SectionTitle>Traceability</SectionTitle>
              <p className="text-xs text-muted-foreground">
                Identity + provenance fields required at audit. The
                asset tag is company-unique and can&apos;t collide with
                another machine.
              </p>

              <CollabRow
                id="asset_tag"
                label="Asset tag"
                value={state.asset_tag}
                onChange={(v) => setField("asset_tag", v)}
                onFocus={focusField}
                onBlur={blurField}
                editor={fieldEditors.asset_tag}
                errors={fieldErrors.asset_tag}
                placeholder="AT-00042"
                mono
                hint="Company-unique. Used on the fixed-asset ledger."
              />

              <CollabRow
                id="serial_number"
                label="Serial number"
                value={state.serial_number}
                onChange={(v) => setField("serial_number", v)}
                onFocus={focusField}
                onBlur={blurField}
                editor={fieldEditors.serial_number}
                errors={fieldErrors.serial_number}
                mono
              />

              <CollabRow
                id="manufacturer"
                label="Manufacturer"
                value={state.manufacturer}
                onChange={(v) => setField("manufacturer", v)}
                onFocus={focusField}
                onBlur={blurField}
                editor={fieldEditors.manufacturer}
                errors={fieldErrors.manufacturer}
              />

              <CollabRow
                id="model"
                label="Model"
                value={state.model}
                onChange={(v) => setField("model", v)}
                onFocus={focusField}
                onBlur={blurField}
                editor={fieldEditors.model}
                errors={fieldErrors.model}
              />
            </div>

            {/* --- Calibration ------------------------------ */}
            <div className="space-y-3 rounded-md border border-border/60 bg-muted/30 p-4">
              <div className="flex items-start justify-between gap-3">
                <SectionTitle>Calibration</SectionTitle>
                {machine && canRecalibrate && canEdit && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setRecalibrateDate(
                        new Date().toISOString().slice(0, 10),
                      );
                      setRecalibrateFrequency(
                        machine.calibration_frequency_months?.toString() ?? "",
                      );
                      setRecalibrateOpen(true);
                    }}
                  >
                    <Gauge className="mr-1.5 size-3.5" />
                    Recalibrate
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                The Recalibrate action is the compliant path — it stamps
                the audit trail with actor + timestamp. The date fields
                below are only for admin backfill.
              </p>

              {machine?.calibration_overdue && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/[0.06] px-3 py-2.5 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <div className="space-y-0.5">
                    <p className="font-medium">Calibration overdue</p>
                    <p>
                      Next due date has passed. Trigger the Recalibrate
                      action once the technician has signed off.
                    </p>
                  </div>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="commissioned_at" className="text-sm">
                    Commissioned
                  </Label>
                  <div className="relative">
                    <Input
                      id="commissioned_at"
                      type="date"
                      value={state.commissioned_at}
                      onChange={(e) =>
                        setField("commissioned_at", e.target.value)
                      }
                      onFocus={() => focusField("commissioned_at")}
                      onBlur={() => blurField("commissioned_at")}
                    />
                    <FieldEditingIndicator
                      peer={fieldEditors.commissioned_at}
                    />
                  </div>
                  <FieldError messages={fieldErrors.commissioned_at} />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="last_calibrated_at" className="text-sm">
                    Last calibrated
                  </Label>
                  <div className="relative">
                    <Input
                      id="last_calibrated_at"
                      type="date"
                      value={state.last_calibrated_at}
                      onChange={(e) =>
                        setField("last_calibrated_at", e.target.value)
                      }
                      onFocus={() => focusField("last_calibrated_at")}
                      onBlur={() => blurField("last_calibrated_at")}
                    />
                    <FieldEditingIndicator
                      peer={fieldEditors.last_calibrated_at}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Prefer the Recalibrate action for routine updates.
                  </p>
                  <FieldError messages={fieldErrors.last_calibrated_at} />
                </div>

                <div className="space-y-1.5">
                  <Label
                    htmlFor="calibration_frequency_months"
                    className="text-sm"
                  >
                    Frequency (months)
                  </Label>
                  <div className="relative">
                    <Input
                      id="calibration_frequency_months"
                      value={state.calibration_frequency_months}
                      onChange={(e) =>
                        setField(
                          "calibration_frequency_months",
                          e.target.value,
                        )
                      }
                      onFocus={() =>
                        focusField("calibration_frequency_months")
                      }
                      onBlur={() => blurField("calibration_frequency_months")}
                      inputMode="numeric"
                      placeholder="12"
                      className="h-10 font-mono"
                    />
                    <FieldEditingIndicator
                      peer={fieldEditors.calibration_frequency_months}
                    />
                  </div>
                  <FieldError
                    messages={fieldErrors.calibration_frequency_months}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label
                    htmlFor="next_calibration_due_at"
                    className="text-sm"
                  >
                    Next due
                  </Label>
                  <div className="relative">
                    <Input
                      id="next_calibration_due_at"
                      type="date"
                      value={state.next_calibration_due_at}
                      onChange={(e) =>
                        setField("next_calibration_due_at", e.target.value)
                      }
                      onFocus={() => focusField("next_calibration_due_at")}
                      onBlur={() => blurField("next_calibration_due_at")}
                    />
                    <FieldEditingIndicator
                      peer={fieldEditors.next_calibration_due_at}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Recomputed automatically on Recalibrate. Editable
                    for backfill.
                  </p>
                  <FieldError
                    messages={fieldErrors.next_calibration_due_at}
                  />
                </div>
              </div>
            </div>

            {/* --- Status ---------------------------------- */}
            <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
              <Label className="pt-1.5 text-sm font-medium">
                {machine ? "Archived?" : "Active"}
              </Label>
              <div className="flex items-center gap-2">
                <Switch
                  checked={state.is_active}
                  onCheckedChange={(v) => setField("is_active", v)}
                  aria-label="Machine is active"
                />
                <span className="text-sm text-muted-foreground">
                  {state.is_active
                    ? "Active — sums into the workstation's per-hour rate."
                    : "Archived — hidden from the cost cascade."}
                </span>
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
                      can {machine ? "save" : "create"} from this room.
                      Your edits sync to them live.
                    </span>
                  </div>
                )}
                <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-between">
                  <div>
                    {machine && canDelete && isCreator && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setDeleteOpen(true)}
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
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={onReset}
                      >
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
                                machine ? "save" : "create"
                              } from this room.`
                            : undefined
                      }
                    >
                      {pending && (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      )}
                      {machine ? "Save changes" : "Create machine"}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </form>
        </fieldset>
      </CardContent>

      {/* Recalibrate dialog — compliant path for stamping the audit
          trail. Never available on the /new form. */}
      <Dialog open={recalibrateOpen} onOpenChange={setRecalibrateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record recalibration</DialogTitle>
            <DialogDescription>
              Stamps the calibration event in the audit trail with your
              user + timestamp. Next-due date is recomputed from the
              cadence.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="recalibrate_date" className="text-sm">
                Calibrated at
              </Label>
              <Input
                id="recalibrate_date"
                type="date"
                value={recalibrateDate}
                onChange={(e) => setRecalibrateDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="recalibrate_frequency" className="text-sm">
                Frequency (months)
              </Label>
              <Input
                id="recalibrate_frequency"
                inputMode="numeric"
                placeholder={
                  machine?.calibration_frequency_months?.toString() ?? "12"
                }
                value={recalibrateFrequency}
                onChange={(e) => setRecalibrateFrequency(e.target.value)}
                className="font-mono"
              />
              <p className="text-[11px] text-muted-foreground">
                Blank keeps the current cadence. Override to change it
                going forward.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRecalibrateOpen(false)}
              disabled={recalibratePending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={onRecalibrateConfirmed}
              disabled={recalibratePending}
            >
              {recalibratePending && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Record recalibration
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation — matches the workstation-form pattern. */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this machine?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes {machine?.name ?? "this machine"} from the cost
              cascade. Prefer archiving over deleting when the record is
              already referenced in production history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletePending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={onDeleteConfirmed}
              disabled={deletePending}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deletePending && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
        "Ask an admin for the `production.machine_edit` permission to join this form.",
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
