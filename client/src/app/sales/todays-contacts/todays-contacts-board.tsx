"use client";

/**
 * The CRM follow-up board. Three columns at desktop, stacked at
 * mobile. Each row carries:
 *
 *   * Customer name + lifecycle badge
 *   * Last contact (days ago) + frequency
 *   * Action buttons: Log call / Log email / Snooze
 *
 * The actions hit the existing `logCustomerContactEventAction` +
 * the new `snoozeNextContactAction`. After success we call
 * `router.refresh()` so the page re-fetches buckets — the rows
 * naturally rebalance (a logged-call row leaves "due today" and
 * the cadence is reset on the customer).
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlarmClock,
  AlertTriangle,
  Bed,
  CalendarCheck,
  Clock,
  Loader2,
  Phone,
  Mail,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge-mini";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/forms/error-banner";
import type {
  CompanyDefaults,
  CustomerContactEventKind,
  TodayBuckets,
  TodayCustomer,
} from "@/lib/types";
import {
  logCustomerContactEventAction,
  snoozeNextContactAction,
} from "@/lib/customers/actions";
import { formatCompanyDate } from "@/lib/format/company";
import type { ErrorDebug } from "@/lib/errors/types";

interface Props {
  initial: TodayBuckets;
  canEdit: boolean;
  prefs: CompanyDefaults | null;
}

const STATUS_TONE: Record<
  string,
  "emerald" | "amber" | "sky" | "muted" | "destructive"
> = {
  lead: "muted",
  prospect: "sky",
  active: "emerald",
  dormant: "amber",
  inactive: "muted",
};

export function TodaysContactsBoard({ initial, canEdit, prefs }: Props) {
  const [logTarget, setLogTarget] = useState<TodayCustomer | null>(null);

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-3">
        <BucketColumn
          title="Due today"
          subtitle="Cadence rings now"
          icon={CalendarCheck}
          tone="emerald"
          rows={initial.due_today}
          canEdit={canEdit}
          prefs={prefs}
          onLog={setLogTarget}
          emptyHint="Nothing due — nice."
        />
        <BucketColumn
          title="Overdue"
          subtitle="Cadence rang and we missed it"
          icon={AlertTriangle}
          tone="destructive"
          rows={initial.overdue}
          canEdit={canEdit}
          prefs={prefs}
          onLog={setLogTarget}
          emptyHint="Caught up — no overdue follow-ups."
        />
        <BucketColumn
          title="Going quiet"
          subtitle="Ordering customers we haven't spoken to in 90+ days"
          icon={Bed}
          tone="amber"
          rows={initial.going_quiet}
          canEdit={canEdit}
          prefs={prefs}
          onLog={setLogTarget}
          emptyHint="No customers slipping out of touch."
        />
      </div>

      {logTarget && (
        <LogContactDialog
          customer={logTarget}
          onClose={() => setLogTarget(null)}
        />
      )}
    </>
  );
}

interface ColumnProps {
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "emerald" | "amber" | "destructive";
  rows: TodayCustomer[];
  canEdit: boolean;
  prefs: CompanyDefaults | null;
  onLog: (c: TodayCustomer) => void;
  emptyHint: string;
}

function BucketColumn({
  title,
  subtitle,
  icon: Icon,
  tone,
  rows,
  canEdit,
  prefs,
  onLog,
  emptyHint,
}: ColumnProps) {
  const toneRing =
    tone === "destructive"
      ? "border-destructive/40 bg-destructive/5"
      : tone === "amber"
        ? "border-amber-300/60 bg-amber-50/40 dark:border-amber-800/40 dark:bg-amber-950/20"
        : "border-emerald-300/60 bg-emerald-50/40 dark:border-emerald-800/40 dark:bg-emerald-950/20";

  const toneIcon =
    tone === "destructive"
      ? "text-destructive"
      : tone === "amber"
        ? "text-amber-700 dark:text-amber-400"
        : "text-emerald-700 dark:text-emerald-400";

  return (
    <section
      className={`flex flex-col rounded-lg border p-4 shadow-sm ${toneRing}`}
    >
      <header className="mb-3 flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <Icon className={`size-4 ${toneIcon}`} />
            {title}
          </h2>
          <p className="text-[11px] text-muted-foreground">{subtitle}</p>
        </div>
        <Badge tone={tone === "destructive" ? "destructive" : tone}>
          {rows.length}
        </Badge>
      </header>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/60 bg-background/60 px-4 py-6 text-center text-xs text-muted-foreground">
          {emptyHint}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((c) => (
            <CustomerRow
              key={c.id}
              customer={c}
              canEdit={canEdit}
              prefs={prefs}
              onLog={() => onLog(c)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function CustomerRow({
  customer,
  canEdit,
  prefs,
  onLog,
}: {
  customer: TodayCustomer;
  canEdit: boolean;
  prefs: CompanyDefaults | null;
  onLog: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function snooze(days: number) {
    startTransition(async () => {
      const res = await snoozeNextContactAction(customer.uuid, days);
      if (res.ok) {
        toast.success(
          days === 1 ? "Snoozed 1 day" : `Snoozed ${days} days`,
        );
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  const status = customer.status;
  const tone = STATUS_TONE[status] ?? "muted";

  return (
    <li className="rounded-md border border-border/40 bg-background/80 px-3 py-2.5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <Link
            href={`/sales/customers/${customer.uuid}`}
            className="block truncate text-sm font-medium hover:underline"
          >
            {customer.name}
          </Link>
          <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
            <Badge tone={tone}>{status}</Badge>
            {customer.effective_approval_status !== "approved" && (
              <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                <ShieldAlert className="size-3" />
                {customer.effective_approval_status.replace(/_/g, " ")}
              </span>
            )}
            {customer.code && (
              <span className="font-mono">{customer.code}</span>
            )}
          </div>
          <CadenceLine customer={customer} prefs={prefs} />
        </div>
        {canEdit && (
          <div className="flex shrink-0 flex-col gap-1">
            <Button
              type="button"
              size="sm"
              className="h-7 text-[11px]"
              onClick={onLog}
              disabled={pending}
            >
              <Phone className="mr-1 size-3" />
              Log
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={() => snooze(1)}
              disabled={pending}
              title="Snooze 1 day"
            >
              {pending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <AlarmClock className="mr-1 size-3" />
              )}
              +1d
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-[11px] text-muted-foreground"
              onClick={() => snooze(7)}
              disabled={pending}
              title="Snooze 1 week"
            >
              +7d
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

function CadenceLine({
  customer,
  prefs,
}: {
  customer: TodayCustomer;
  prefs: CompanyDefaults | null;
}) {
  const parts: string[] = [];

  if (customer.days_overdue && customer.days_overdue > 0) {
    parts.push(
      customer.days_overdue === 1
        ? "1 day overdue"
        : `${customer.days_overdue} days overdue`,
    );
  } else if (customer.next_contact_at) {
    parts.push(
      `due ${prefs ? formatCompanyDate(customer.next_contact_at, prefs) : customer.next_contact_at.slice(0, 10)}`,
    );
  }

  if (customer.days_since_contact !== null) {
    parts.push(
      customer.days_since_contact === 0
        ? "spoken to today"
        : customer.days_since_contact === 1
          ? "1 day since contact"
          : `${customer.days_since_contact} days since contact`,
    );
  } else {
    parts.push("never contacted");
  }

  parts.push(
    customer.contact_frequency_months === 1
      ? "every month"
      : `every ${customer.contact_frequency_months} months`,
  );

  return (
    <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
      <Clock className="size-3 shrink-0" />
      <span className="truncate">{parts.join(" · ")}</span>
    </p>
  );
}

// ============================================================
// Log dialog — pick kind + summary
// ============================================================

const KIND_OPTIONS: Array<{ value: CustomerContactEventKind; label: string }> =
  [
    { value: "call", label: "Call" },
    { value: "email", label: "Email" },
    { value: "meeting", label: "Meeting" },
    { value: "message", label: "Message" },
    { value: "note", label: "Note" },
    { value: "other", label: "Other" },
  ];

function LogContactDialog({
  customer,
  onClose,
}: {
  customer: TodayCustomer;
  onClose: () => void;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<CustomerContactEventKind>("call");
  const [summary, setSummary] = useState("");
  const [occurredAt, setOccurredAt] = useState(
    new Date().toISOString().slice(0, 16),
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{
    detail: string;
    code?: string;
    debug?: ErrorDebug;
  } | null>(null);

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await logCustomerContactEventAction(customer.uuid, {
        kind,
        summary: summary.trim() || null,
        occurred_at: new Date(occurredAt).toISOString(),
      });
      if (res.ok) {
        toast.success("Contact logged");
        onClose();
        router.refresh();
      } else {
        setError({ detail: res.detail, code: res.code, debug: res.debug });
      }
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log contact — {customer.name}</DialogTitle>
          <DialogDescription>
            Records a touchpoint, advances <code>last_contact_at</code>, and
            resets the cadence based on the customer&rsquo;s frequency setting
            ({customer.contact_frequency_months} months).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Kind</Label>
              <Select
                value={kind}
                onValueChange={(v) => setKind(v as CustomerContactEventKind)}
              >
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KIND_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">When</Label>
              <Input
                type="datetime-local"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
                className="h-10"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Summary</Label>
            <Textarea
              rows={3}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="What did you talk about? Next steps?"
            />
          </div>

          {error && (
            <ErrorBanner
              detail={error.detail}
              code={error.code}
              debug={error.debug}
            />
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={pending}>
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            <Mail className="mr-1.5 size-4" />
            Log contact
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
