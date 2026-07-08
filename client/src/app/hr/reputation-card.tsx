"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Award, Plus, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { FieldError } from "@/components/forms/field-error";
import { ErrorBanner } from "@/components/forms/error-banner";
import type { ErrorResult } from "@/lib/errors/server";
import { formatCompanyDate } from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";
import type {
  HREmployee,
  HREmployeeReputationEvent,
  ReputationEventType,
} from "@/lib/hr/types";
import { recordReputationEventAction } from "@/lib/hr/actions";
import { invalidateAudit } from "@/lib/audit/invalidator";

interface Props {
  employee: HREmployee;
  initial: HREmployeeReputationEvent[];
  canEdit: boolean;
  onEmployeeUpdated?: (employee: HREmployee) => void;
  /** If set, a subtle "View all →" link renders in the card header
   *  pointing at the dedicated infinite-scroll page. The parent only
   *  passes this when the server reported `next_cursor !== null`, so
   *  a card that already shows the full timeline stays clean. */
  viewAllHref?: string;
}

/** Manual-event options — the auto_perf_* variants come from
 *  vita-performance's forwarder and shouldn't be hand-picked. */
const MANUAL_EVENT_TYPES: {
  value: ReputationEventType;
  label: string;
  suggestedDelta: number;
}[] = [
  { value: "manual_positive", label: "Positive recognition", suggestedDelta: 10 },
  {
    value: "manual_negative",
    label: "Negative incident",
    suggestedDelta: -10,
  },
];

const EVENT_LABEL: Record<ReputationEventType, string> = {
  auto_perf_excellent: "Excellent performance (auto)",
  auto_perf_high: "High performance (auto)",
  auto_perf_low: "Low performance (auto)",
  auto_perf_very_low: "Very low performance (auto)",
  manual_positive: "Positive recognition",
  manual_negative: "Negative incident",
};

function tone(delta: number): "emerald" | "rose" | "muted" {
  if (delta > 0) return "emerald";
  if (delta < 0) return "rose";
  return "muted";
}

export function ReputationCard({
  employee,
  initial,
  canEdit,
  onEmployeeUpdated,
  viewAllHref,
}: Props) {
  const prefs = useFormatPrefs();
  const [events, setEvents] = useState<HREmployeeReputationEvent[]>(initial);
  const [open, setOpen] = useState(false);

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <Award className="size-4 text-muted-foreground" />
              Reputation events
              <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold">
                {employee.reputation_score}
              </span>
            </CardTitle>
            <CardDescription>
              Score is a linear-decay projection over 180 days
              (300–850 band). Cached on the employee row; recomputed on
              every event.
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            {viewAllHref && (
              <Link
                href={viewAllHref}
                className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                View all →
              </Link>
            )}
            {canEdit && (
              <Button
                size="sm"
                type="button"
                variant="outline"
                onClick={() => setOpen(true)}
              >
                <Plus className="mr-1.5 size-4" />
                Record event
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/60 px-4 py-8 text-center text-xs text-muted-foreground">
            No reputation events recorded. Auto-events land here as they
            flow in from vita-performance; the &ldquo;Record event&rdquo;
            button captures manual recognition or incidents.
          </p>
        ) : (
          <ol className="relative space-y-4 border-l border-border/60 pl-6">
            {events.map((ev) => {
              const t = tone(ev.score_delta);
              return (
                <li key={ev.id} className="relative">
                  <span
                    aria-hidden
                    className={`absolute -left-[26px] top-1.5 flex size-3 items-center justify-center rounded-full ring-4 ring-background ${
                      t === "emerald"
                        ? "bg-emerald-500"
                        : t === "rose"
                          ? "bg-rose-500"
                          : "bg-muted-foreground/50"
                    }`}
                  >
                    {ev.score_delta > 0 ? (
                      <ThumbsUp className="size-2 text-white" />
                    ) : ev.score_delta < 0 ? (
                      <ThumbsDown className="size-2 text-white" />
                    ) : null}
                  </span>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold">
                        {EVENT_LABEL[ev.event_type] ?? ev.event_type}
                      </span>
                      <span
                        className={`font-mono text-sm ${
                          t === "emerald"
                            ? "text-emerald-600 dark:text-emerald-400"
                            : t === "rose"
                              ? "text-rose-600 dark:text-rose-400"
                              : "text-muted-foreground"
                        }`}
                      >
                        {ev.score_delta > 0 ? "+" : ""}
                        {ev.score_delta}
                      </span>
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      {formatCompanyDate(ev.inserted_at, prefs)}
                    </span>
                  </div>
                  {ev.reason && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {ev.reason}
                    </p>
                  )}
                  <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                    {ev.session_external_id ? (
                      <>Session {ev.session_external_id}</>
                    ) : ev.created_by_user ? (
                      <>Recorded by {ev.created_by_user.name}</>
                    ) : null}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>

      <RecordEventDialog
        employee={employee}
        open={open}
        onOpenChange={setOpen}
        onCreated={(ev, updated) => {
          setEvents((prev) => [ev, ...prev]);
          onEmployeeUpdated?.(updated);
          invalidateAudit("hr_employee", employee.id);
        }}
      />
    </Card>
  );
}

interface RecordEventDialogProps {
  employee: HREmployee;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (event: HREmployeeReputationEvent, employee: HREmployee) => void;
}

function RecordEventDialog({
  employee,
  open,
  onOpenChange,
  onCreated,
}: RecordEventDialogProps) {
  const [eventType, setEventType] =
    useState<ReputationEventType>("manual_positive");
  const [scoreDelta, setScoreDelta] = useState<string>("10");
  const [reason, setReason] = useState("");
  const [fieldErrors, setFieldErrors] = useState<
    Record<string, string[] | undefined>
  >({});
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setEventType("manual_positive");
    setScoreDelta("10");
    setReason("");
    setFieldErrors({});
    setActionError(null);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setActionError(null);

    const delta = Number.parseInt(scoreDelta, 10);
    if (!Number.isFinite(delta)) {
      setFieldErrors({ score_delta: ["must be a whole number"] });
      return;
    }

    startTransition(async () => {
      const res = await recordReputationEventAction(employee.uuid, {
        event_type: eventType,
        score_delta: delta,
        reason: reason.trim() || null,
      });
      if (res.ok) {
        toast.success("Reputation event recorded");
        onCreated(res.event, res.employee);
        reset();
        onOpenChange(false);
        return;
      }
      setFieldErrors(res.fields ?? {});
      setActionError(res);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record reputation event</DialogTitle>
          <DialogDescription>
            Adjusts {employee.full_name}&apos;s score. The cached score is
            recomputed atomically.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <div className="grid gap-1.5">
            <Label htmlFor="rep_event_type">Event type</Label>
            <Select
              value={eventType}
              onValueChange={(v) => {
                const cast = v as ReputationEventType;
                setEventType(cast);
                const preset = MANUAL_EVENT_TYPES.find(
                  (t) => t.value === cast,
                );
                if (preset) setScoreDelta(String(preset.suggestedDelta));
              }}
            >
              <SelectTrigger id="rep_event_type" className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MANUAL_EVENT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Auto-performance events come from vita-performance and can
              only be recorded via the integration channel.
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rep_score_delta">Score delta</Label>
            <Input
              id="rep_score_delta"
              type="number"
              step="1"
              required
              inputMode="numeric"
              value={scoreDelta}
              onChange={(e) => setScoreDelta(e.target.value)}
            />
            <FieldError messages={fieldErrors.score_delta} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rep_reason">Reason (optional)</Label>
            <Textarea
              id="rep_reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="What happened? Why the delta?"
            />
            <FieldError messages={fieldErrors.reason} />
          </div>
          {actionError && (
            <ErrorBanner
              detail={actionError.detail}
              code={actionError.code}
              debug={actionError.debug}
            />
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Record event"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
