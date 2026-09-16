"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  completeMaintenanceTaskAction,
  createMaintenanceTaskAction,
  deleteMaintenanceTaskAction,
  updateMaintenanceTaskAction,
} from "@/lib/equipment/actions";
import type {
  EquipmentMaintenanceTask,
  MaintenancePeriodicity,
  MaintenanceTaskType,
} from "@/lib/equipment/types";
import type { CompanyDefaults } from "@/lib/types";
import { formatCompanyDate } from "@/lib/format/company";

const TYPE_LABEL: Record<MaintenanceTaskType, string> = {
  preventive: "Preventive",
  calibration: "Calibration",
  inspection: "Inspection",
  safety_check: "Safety check",
  cleaning: "Cleaning",
  other: "Other",
};

const PERIODICITY_LABEL: Record<MaintenancePeriodicity, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  half_yearly: "Half-yearly",
  yearly: "Yearly",
  two_yearly: "Every 2 years",
  three_yearly: "Every 3 years",
};

interface Props {
  equipmentUuid: string;
  tasks: EquipmentMaintenanceTask[];
  canEdit: boolean;
  prefs: CompanyDefaults;
}

/**
 * Preventive-maintenance / calibration task list for one equipment
 * unit. Each row shows the task, next-due chip (green / amber /
 * red), a "Mark done" button that bumps the last-completion date
 * and recomputes next-due, and an archive button (soft-delete —
 * task history stays).
 *
 * "Add task" opens an inline form under the header.
 */
export function EquipmentMaintenanceTasksCard({
  equipmentUuid,
  tasks,
  canEdit,
  prefs,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [editingUuid, setEditingUuid] = useState<string | null>(null);
  // Task currently open in the "Mark done" confirm dialog. Null =
  // no dialog. Using the task object (not just uuid) so the dialog
  // can pre-fill the completion form off its state.
  const [completingTask, setCompletingTask] =
    useState<EquipmentMaintenanceTask | null>(null);
  const [form, setForm] = useState<{
    task_name: string;
    task_type: MaintenanceTaskType;
    periodicity: MaintenancePeriodicity | "";
    start_date: string;
    certificate_required: boolean;
    notes: string;
  }>({
    task_name: "",
    task_type: "preventive",
    periodicity: "monthly",
    start_date: "",
    certificate_required: false,
    notes: "",
  });

  const activeTasks = useMemo(
    () =>
      [...tasks].sort((a, b) => {
        if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
        const aDue = a.next_due_date ?? "9999-12-31";
        const bDue = b.next_due_date ?? "9999-12-31";
        return aDue.localeCompare(bDue);
      }),
    [tasks],
  );

  function resetForm() {
    setForm({
      task_name: "",
      task_type: "preventive",
      periodicity: "monthly",
      start_date: "",
      certificate_required: false,
      notes: "",
    });
    setShowForm(false);
  }

  function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.task_name.trim()) {
      toast.error("Task name is required");
      return;
    }
    startTransition(async () => {
      const res = await createMaintenanceTaskAction(equipmentUuid, {
        task_name: form.task_name.trim(),
        task_type: form.task_type,
        periodicity: form.periodicity || null,
        start_date: form.start_date || null,
        next_due_date: form.start_date || null,
        certificate_required: form.certificate_required,
        notes: form.notes || null,
      });
      if (res.ok) {
        toast.success("Task added");
        resetForm();
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  function onConfirmComplete(input: {
    task: EquipmentMaintenanceTask;
    completed_on: string;
    reason: string;
    evidence_urls: string[];
  }) {
    const { task, completed_on, reason, evidence_urls } = input;
    startTransition(async () => {
      const res = await completeMaintenanceTaskAction(
        equipmentUuid,
        task.uuid,
        {
          completed_on,
          reason: reason || `Marked complete: ${task.task_name}`,
          evidence_urls,
        },
      );
      if (res.ok) {
        toast.success("Task completed — next due date bumped");
        setCompletingTask(null);
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  function onUpdate(
    taskUuid: string,
    input: {
      task_name: string;
      task_type: MaintenanceTaskType;
      periodicity: MaintenancePeriodicity | "";
      next_due_date: string;
      certificate_required: boolean;
      notes: string;
    },
  ) {
    if (!input.task_name.trim()) {
      toast.error("Task name is required");
      return;
    }
    startTransition(async () => {
      const res = await updateMaintenanceTaskAction(equipmentUuid, taskUuid, {
        task_name: input.task_name.trim(),
        task_type: input.task_type,
        periodicity: input.periodicity || null,
        next_due_date: input.next_due_date || null,
        certificate_required: input.certificate_required,
        notes: input.notes || null,
      });
      if (res.ok) {
        toast.success("Task updated");
        setEditingUuid(null);
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  function onArchive(taskUuid: string, taskName: string) {
    if (!confirm(`Archive "${taskName}"? Its history stays on the timeline.`)) return;
    startTransition(async () => {
      const res = await deleteMaintenanceTaskAction(equipmentUuid, taskUuid);
      if (res.ok) {
        toast.success("Archived");
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-muted-foreground" />
              Maintenance schedule
              <span className="text-[11px] font-normal text-muted-foreground">
                · {activeTasks.filter((t) => t.is_active).length} active
              </span>
            </CardTitle>
            <CardDescription>
              Preventive and calibration tasks scheduled on this unit.
              Each task carries its own cadence + next-due date;
              completion writes a "Maintenance completed" event to the
              timeline.
            </CardDescription>
          </div>
          {canEdit ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowForm((s) => !s)}
              disabled={pending}
              type="button"
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add task
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">

      {showForm && canEdit ? (
        <form
          onSubmit={onCreate}
          className="mb-4 space-y-3 rounded-md border border-border/60 bg-muted/30 p-3"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="task_name" className="text-xs">
                Task name
              </Label>
              <Input
                id="task_name"
                value={form.task_name}
                onChange={(e) => setForm({ ...form, task_name: e.target.value })}
                placeholder="e.g. Quarterly torque calibration"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="task_type" className="text-xs">
                Type
              </Label>
              <Select
                value={form.task_type}
                onValueChange={(v) =>
                  setForm({ ...form, task_type: v as MaintenanceTaskType })
                }
              >
                <SelectTrigger id="task_type" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TYPE_LABEL) as MaintenanceTaskType[]).map((t) => (
                    <SelectItem key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="periodicity" className="text-xs">
                Cadence
              </Label>
              <Select
                value={form.periodicity || "none"}
                onValueChange={(v) =>
                  setForm({
                    ...form,
                    periodicity: v === "none" ? "" : (v as MaintenancePeriodicity),
                  })
                }
              >
                <SelectTrigger id="periodicity" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">One-off (no recurrence)</SelectItem>
                  {(Object.keys(PERIODICITY_LABEL) as MaintenancePeriodicity[]).map(
                    (p) => (
                      <SelectItem key={p} value={p}>
                        {PERIODICITY_LABEL[p]}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="start_date" className="text-xs">
                First due date
              </Label>
              <Input
                id="start_date"
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                className="mt-1"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={form.certificate_required}
              onChange={(e) =>
                setForm({ ...form, certificate_required: e.target.checked })
              }
              className="h-3.5 w-3.5"
            />
            Requires a certificate on completion (BRCGS / FSSC evidence)
          </label>
          <div>
            <Label htmlFor="notes" className="text-xs">
              Notes
            </Label>
            <Textarea
              id="notes"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="mt-1"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={resetForm}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Add task
            </Button>
          </div>
        </form>
      ) : null}

      {activeTasks.length === 0 ? (
        <p className="rounded-md bg-muted/40 p-4 text-center text-sm text-muted-foreground">
          No maintenance tasks yet.{" "}
          {canEdit
            ? "Add a preventive-maintenance or calibration cadence to keep the asset in service."
            : ""}
        </p>
      ) : (
        <ul className="space-y-2">
          {activeTasks.map((task) => (
            <TaskRow
              key={task.uuid}
              task={task}
              equipmentUuid={equipmentUuid}
              canEdit={canEdit}
              pending={pending}
              prefs={prefs}
              isEditing={editingUuid === task.uuid}
              onStartEdit={() => setEditingUuid(task.uuid)}
              onCancelEdit={() => setEditingUuid(null)}
              onSubmitEdit={(input) => onUpdate(task.uuid, input)}
              onStartComplete={() => setCompletingTask(task)}
              onArchive={onArchive}
            />
          ))}
        </ul>
      )}

      <CompleteTaskDialog
        task={completingTask}
        pending={pending}
        prefs={prefs}
        onCancel={() => setCompletingTask(null)}
        onConfirm={onConfirmComplete}
      />
      </CardContent>
    </Card>
  );
}

interface TaskRowProps {
  task: EquipmentMaintenanceTask;
  equipmentUuid: string;
  canEdit: boolean;
  pending: boolean;
  prefs: CompanyDefaults;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSubmitEdit: (input: {
    task_name: string;
    task_type: MaintenanceTaskType;
    periodicity: MaintenancePeriodicity | "";
    next_due_date: string;
    certificate_required: boolean;
    notes: string;
  }) => void;
  onStartComplete: () => void;
  onArchive: (uuid: string, name: string) => void;
}

function TaskRow(props: TaskRowProps) {
  const {
    task,
    canEdit,
    pending,
    prefs,
    isEditing,
    onStartEdit,
    onCancelEdit,
    onSubmitEdit,
    onStartComplete,
    onArchive,
  } = props;
  const chip = dueChip(task.next_due_date);
  const inactive = !task.is_active;

  if (isEditing) {
    return (
      <li
        className={`rounded-md border ${
          inactive
            ? "border-border/40 bg-muted/20"
            : "border-border/60 bg-background"
        }`}
      >
        <TaskEditForm
          task={task}
          pending={pending}
          onCancel={onCancelEdit}
          onSubmit={onSubmitEdit}
        />
      </li>
    );
  }

  return (
    <li
      className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm ${
        inactive
          ? "border-border/40 bg-muted/20 opacity-60"
          : "border-border/60 bg-background"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{task.task_name}</span>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
            {TYPE_LABEL[task.task_type]}
          </span>
          {task.certificate_required ? (
            <span
              className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800"
              title="Certificate required on completion"
            >
              Cert
            </span>
          ) : null}
          {inactive ? (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              Archived
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          <span>
            {task.periodicity
              ? PERIODICITY_LABEL[task.periodicity]
              : "One-off"}
          </span>
          {task.next_due_date ? (
            <span className={chip.className}>
              {chip.icon}
              Next: {formatCompanyDate(task.next_due_date, prefs)}
              {chip.suffix ? ` (${chip.suffix})` : null}
            </span>
          ) : (
            <span>No due date set</span>
          )}
          {task.last_completion_date ? (
            <span>
              Last: {formatCompanyDate(task.last_completion_date, prefs)}
            </span>
          ) : null}
          {task.assigned_to_user ? (
            <span>· Assigned to {task.assigned_to_user.name}</span>
          ) : null}
        </div>
        {task.notes ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            {task.notes}
          </p>
        ) : null}
      </div>
      {canEdit && task.is_active ? (
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={onStartComplete}
            disabled={pending}
            title="Mark done — bumps next-due date"
          >
            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
            Mark done
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={onStartEdit}
            disabled={pending}
            title="Edit task"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => onArchive(task.uuid, task.task_name)}
            disabled={pending}
            title="Archive task"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function TaskEditForm({
  task,
  pending,
  onCancel,
  onSubmit,
}: {
  task: EquipmentMaintenanceTask;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (input: {
    task_name: string;
    task_type: MaintenanceTaskType;
    periodicity: MaintenancePeriodicity | "";
    next_due_date: string;
    certificate_required: boolean;
    notes: string;
  }) => void;
}) {
  const [name, setName] = useState(task.task_name);
  const [type, setType] = useState<MaintenanceTaskType>(task.task_type);
  const [periodicity, setPeriodicity] = useState<MaintenancePeriodicity | "">(
    task.periodicity ?? "",
  );
  const [nextDue, setNextDue] = useState(task.next_due_date ?? "");
  const [certRequired, setCertRequired] = useState(task.certificate_required);
  const [notes, setNotes] = useState(task.notes ?? "");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          task_name: name,
          task_type: type,
          periodicity,
          next_due_date: nextDue,
          certificate_required: certRequired,
          notes,
        });
      }}
      className="space-y-3 p-3"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`edit_name_${task.uuid}`} className="text-xs">
            Task name
          </Label>
          <Input
            id={`edit_name_${task.uuid}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor={`edit_type_${task.uuid}`} className="text-xs">
            Type
          </Label>
          <Select
            value={type}
            onValueChange={(v) => setType(v as MaintenanceTaskType)}
          >
            <SelectTrigger id={`edit_type_${task.uuid}`} className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(TYPE_LABEL) as MaintenanceTaskType[]).map((t) => (
                <SelectItem key={t} value={t}>
                  {TYPE_LABEL[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor={`edit_cadence_${task.uuid}`} className="text-xs">
            Cadence
          </Label>
          <Select
            value={periodicity || "none"}
            onValueChange={(v) =>
              setPeriodicity(
                v === "none" ? "" : (v as MaintenancePeriodicity),
              )
            }
          >
            <SelectTrigger id={`edit_cadence_${task.uuid}`} className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">One-off (no recurrence)</SelectItem>
              {(Object.keys(PERIODICITY_LABEL) as MaintenancePeriodicity[]).map(
                (p) => (
                  <SelectItem key={p} value={p}>
                    {PERIODICITY_LABEL[p]}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor={`edit_next_${task.uuid}`} className="text-xs">
            Next due date
          </Label>
          <Input
            id={`edit_next_${task.uuid}`}
            type="date"
            value={nextDue}
            onChange={(e) => setNextDue(e.target.value)}
            className="mt-1"
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={certRequired}
          onChange={(e) => setCertRequired(e.target.checked)}
          className="h-3.5 w-3.5"
        />
        Requires a certificate on completion (BRCGS / FSSC evidence)
      </label>
      <div>
        <Label htmlFor={`edit_notes_${task.uuid}`} className="text-xs">
          Notes
        </Label>
        <Textarea
          id={`edit_notes_${task.uuid}`}
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="mt-1"
        />
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={pending}
        >
          <X className="mr-1 h-3.5 w-3.5" />
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : null}
          Save changes
        </Button>
      </div>
    </form>
  );
}

function dueChip(nextDue: string | null): {
  className: string;
  icon: React.ReactNode;
  suffix: string;
} {
  if (!nextDue) {
    return { className: "text-muted-foreground", icon: null, suffix: "" };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(nextDue);
  due.setHours(0, 0, 0, 0);
  const days = Math.round(
    (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (days < 0) {
    return {
      className:
        "inline-flex items-center gap-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800",
      icon: <AlertTriangle className="mr-0.5 h-3 w-3" />,
      suffix: `${-days}d overdue`,
    };
  }
  if (days <= 7) {
    return {
      className:
        "inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800",
      icon: null,
      suffix: `in ${days}d`,
    };
  }
  return {
    className:
      "inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800",
    icon: null,
    suffix: `in ${days}d`,
  };
}

/**
 * Confirm dialog for "Mark done" — replaces the old one-click bump
 * so a misclick doesn't silently mark a certificate task complete.
 * Captures completion date (defaults to today), a free-text note
 * (winds up on the timeline event), and optional evidence URLs (one
 * per line) — the backend refuses to close a `certificate_required`
 * task without at least one evidence entry.
 */
function CompleteTaskDialog({
  task,
  pending,
  prefs,
  onCancel,
  onConfirm,
}: {
  task: EquipmentMaintenanceTask | null;
  pending: boolean;
  prefs: CompanyDefaults;
  onCancel: () => void;
  onConfirm: (input: {
    task: EquipmentMaintenanceTask;
    completed_on: string;
    reason: string;
    evidence_urls: string[];
  }) => void;
}) {
  const [completedOn, setCompletedOn] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [reason, setReason] = useState("");
  const [evidenceText, setEvidenceText] = useState("");

  // Reset the form each time a different task opens the dialog so
  // stale input from a previous close doesn't leak forward.
  useEffect(() => {
    if (task) {
      setCompletedOn(new Date().toISOString().slice(0, 10));
      setReason("");
      setEvidenceText("");
    }
  }, [task?.uuid]);

  if (!task) return null;

  const evidence_urls = evidenceText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const missingEvidence = task.certificate_required && evidence_urls.length === 0;

  return (
    <Dialog
      open={!!task}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Mark done: {task.task_name}</DialogTitle>
          <DialogDescription>
            {TYPE_LABEL[task.task_type]}
            {task.periodicity ? ` · ${PERIODICITY_LABEL[task.periodicity]}` : ""}
            {task.next_due_date
              ? ` · currently due ${formatCompanyDate(task.next_due_date, prefs)}`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="complete-date" className="text-xs">
              Completed on
            </Label>
            <Input
              id="complete-date"
              type="date"
              value={completedOn}
              onChange={(e) => setCompletedOn(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="complete-reason" className="text-xs">
              Notes (optional)
            </Label>
            <Textarea
              id="complete-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="What was done, or which technician performed it?"
              className="mt-1"
            />
          </div>
          {task.certificate_required ? (
            <div>
              <Label htmlFor="complete-evidence" className="text-xs">
                Evidence URLs (one per line)
                <span className="ml-1 text-destructive">*</span>
              </Label>
              <Textarea
                id="complete-evidence"
                rows={3}
                value={evidenceText}
                onChange={(e) => setEvidenceText(e.target.value)}
                placeholder="https://…/calibration-cert.pdf"
                className="mt-1 font-mono text-xs"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                This task requires a certificate on completion (BRCGS /
                FSSC evidence). Upload the file via the Files card first,
                then paste its URL here.
              </p>
              {missingEvidence ? (
                <p className="mt-1 text-[11px] text-destructive">
                  At least one evidence URL is required.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() =>
              onConfirm({ task, completed_on: completedOn, reason, evidence_urls })
            }
            disabled={pending || missingEvidence || !completedOn}
          >
            {pending ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
            )}
            Confirm completion
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
