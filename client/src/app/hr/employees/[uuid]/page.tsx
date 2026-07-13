import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ChevronLeft,
  IdCard,
  KeyRound,
  Link2,
  Mail,
  Phone,
  ShieldCheck,
} from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { AuditMetaSection } from "@/components/audit/audit-meta-section";
import { AuditHistoryCard } from "@/components/audit/audit-history-card";
import { CommentThread } from "@/components/comments/comment-thread";
import { UserAvatar } from "@/components/users/user-avatar";
import { LiveTimer } from "@/components/production/live-timer";
import { listCommentsForEntity } from "@/lib/comments/server";
import { getCompanyDefaults } from "@/lib/company/server";
import { formatCompanyDate, type FormatPrefs } from "@/lib/format/company";
import {
  getHREmployee,
  listHREmployeeReputationEvents,
  listHREmployeeSessions,
  listHREmployeeWages,
} from "@/lib/hr/server";
import type { HREmployee } from "@/lib/hr/types";
import type { WorkstationSessionRow } from "@/lib/production/sessions";
import { cn } from "@/lib/utils";
import { EmployeeForm } from "../../employee-form";
import { EditModeToggle } from "@/components/forms/edit-mode-toggle";
import { WagesCard } from "../../wages-card";
import { ReputationCard } from "../../reputation-card";
import { ArchiveEmployeeButton } from "./archive-employee-button";
import { EmployeeSessionsCard } from "./employee-sessions-card";

export const metadata = { title: "Employee · HR · PSP" };
export const dynamic = "force-dynamic";

export default async function HREmployeeDetailPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, "hr.view")) redirect("/");

  const { uuid } = await params;
  const [employee, prefs, wagesPage, reputationPage, sessionsPage, comments] =
    await Promise.all([
      getHREmployee(uuid),
      getCompanyDefaults(),
      // Tight preview — only the top 5 of each timeline lands on the
      // profile sidebar. "View all →" jumps to the dedicated
      // infinite-scroll page. Rendering 700+ rows here was the
      // regression this ticket fixes.
      listHREmployeeWages(uuid, { limit: 5 }),
      listHREmployeeReputationEvents(uuid, { limit: 5 }),
      listHREmployeeSessions(uuid, { limit: 5 }),
      listCommentsForEntity("hr_employee", uuid),
    ]);
  if (!employee) notFound();
  if (!prefs) notFound();

  const canEdit = hasPermission(user, "hr.edit");
  const canDelete = hasPermission(user, "hr.delete");
  const wages = wagesPage.items;
  const reputationEvents = reputationPage.items;
  const sessions = sessionsPage.items;
  const active = sessions.find((s) => s.status === "active") ?? null;
  // Only surface the "View all →" link when there's actually a next
  // page — a worker with 3 events shouldn't have to click through to a
  // dedicated page that shows the same 3.
  const reputationViewAll =
    reputationPage.next_cursor
      ? `/hr/employees/${employee.uuid}/reputation`
      : undefined;
  const wagesViewAll =
    wagesPage.next_cursor
      ? `/hr/employees/${employee.uuid}/wages`
      : undefined;
  const sessionsViewAll =
    sessionsPage.next_cursor
      ? `/hr/employees/${employee.uuid}/sessions`
      : undefined;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
          <Link href="/hr/employees">
            <ChevronLeft className="mr-1 size-4" />
            Back to employees
          </Link>
        </Button>
        {canDelete && employee.is_active && (
          <ArchiveEmployeeButton uuid={employee.uuid} name={employee.full_name} />
        )}
      </div>

      <EmployeeHero employee={employee} activeSession={active} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <EditModeToggle canEdit={canEdit}>
            <EmployeeForm employee={employee} canEdit={canEdit} />
          </EditModeToggle>
          <EmployeeSessionsCard
            employeeUuid={employee.uuid}
            initialSessions={sessions}
            prefs={prefs}
            viewAllHref={sessionsViewAll}
          />
          <CommentThread
            entityType="hr_employee"
            entityUuid={employee.uuid}
            initial={comments ?? []}
            canComment={canEdit}
            currentUserId={user.id}
          />
          <AuditHistoryCard
            entityType="hr_employee"
            entityId={employee.id}
            canRestore={canEdit}
          />
        </div>

        <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          <WagesCard
            employee={employee}
            initial={wages}
            canEdit={canEdit}
            viewAllHref={wagesViewAll}
          />
          <ReputationCard
            employee={employee}
            initial={reputationEvents}
            canEdit={canEdit}
            viewAllHref={reputationViewAll}
          />
          <IdentityFacts employee={employee} prefs={prefs} />
          <AuditMetaSection
            inserted_at={employee.inserted_at}
            updated_at={employee.updated_at}
            created_by={employee.created_by}
            updated_by={employee.updated_by}
          />
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------ Hero ------------------------------ */

const REP_TONE = {
  good: {
    text: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-500/10",
    label: "Excellent",
  },
  watch: {
    text: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-500/10",
    label: "Watch",
  },
  risk: {
    text: "text-red-600 dark:text-red-400",
    bg: "bg-red-500/10",
    label: "At risk",
  },
} as const;

function reputationTone(score: number) {
  if (score >= 700) return REP_TONE.good;
  if (score >= 500) return REP_TONE.watch;
  return REP_TONE.risk;
}

function EmployeeHero({
  employee,
  activeSession,
}: {
  employee: HREmployee;
  activeSession: WorkstationSessionRow | null;
}) {
  const tone = reputationTone(employee.reputation_score);
  const code = employee.code ?? employee.employee_number;

  return (
    <section className="rounded-lg border border-border/60 bg-gradient-to-br from-card to-muted/10 p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex min-w-0 items-start gap-4">
          <UserAvatar
            name={employee.full_name}
            email={employee.email ?? employee.uuid}
            sizeClassName="size-16"
            fallbackClassName="text-lg"
          />
          <div className="min-w-0 space-y-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">
              {employee.full_name}
            </h1>
            {(employee.preferred_name || code) && (
              <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                {employee.preferred_name && (
                  <span className="italic">&quot;{employee.preferred_name}&quot;</span>
                )}
                {code && <span className="font-mono text-xs tracking-tight">{code}</span>}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              <HeroBadge
                tone={employee.is_active ? "emerald" : "muted"}
                label={employee.is_active ? "Active" : "Archived"}
              />
              {employee.is_qa && (
                <HeroBadge tone="sky" icon={ShieldCheck} label="QA sign-off" />
              )}
              <HeroBadge
                tone={employee.has_kiosk_pin ? "indigo" : "muted"}
                icon={KeyRound}
                label={employee.has_kiosk_pin ? "Kiosk PIN set" : "No kiosk PIN"}
              />
              {employee.external_id && (
                <HeroBadge tone="muted" icon={Link2} label="Linked to vp" />
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 text-right">
          <span
            className={cn(
              "rounded-md px-3 py-1 text-3xl font-bold tabular-nums",
              tone.text,
              tone.bg,
            )}
          >
            {employee.reputation_score}
          </span>
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Reputation · {tone.label}
          </span>
        </div>
      </div>
      <ActiveSessionStrip session={activeSession} />
    </section>
  );
}

const BADGE_TONE = {
  emerald: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  sky: "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20",
  indigo: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/20",
  muted: "bg-muted text-muted-foreground border-border/60",
} as const;

function HeroBadge({
  tone,
  icon: Icon,
  label,
}: {
  tone: keyof typeof BADGE_TONE;
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        BADGE_TONE[tone],
      )}
    >
      {Icon && <Icon className="size-3" aria-hidden />}
      {label}
    </span>
  );
}

function ActiveSessionStrip({ session }: { session: WorkstationSessionRow | null }) {
  if (!session) {
    return (
      <div
        className="mt-5 flex items-center gap-2 rounded-md border border-dashed border-border/60 bg-background/40 px-4 py-2.5 text-xs text-muted-foreground"
        aria-live="polite"
      >
        <span className="size-2 rounded-full bg-muted-foreground/40" aria-hidden />
        Idle — no active kiosk session
      </div>
    );
  }
  const step = session.manufacturing_order_step;
  const title = step?.workstation_group_name ?? session.activity_label ?? "Working";
  return (
    <div
      className="mt-5 flex flex-wrap items-center gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3"
      aria-live="polite"
    >
      <span className="inline-flex size-2.5 animate-pulse rounded-full bg-emerald-500" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
          Currently working
        </span>
        <span className="truncate text-sm font-semibold">{title}</span>
        {session.workstation && (
          <span className="text-xs text-muted-foreground">
            at{" "}
            {session.workstation.uuid ? (
              <Link
                href={`/production/workstations/${session.workstation.uuid}`}
                className="font-medium text-foreground underline-offset-2 hover:underline"
              >
                {session.workstation.name}
              </Link>
            ) : (
              <span className="font-medium text-foreground">{session.workstation.name}</span>
            )}
            {session.workstation.code && <span> ({session.workstation.code})</span>}
          </span>
        )}
      </div>
      <LiveTimer
        startedAt={session.started_at}
        finishedAt={session.finished_at}
        className="text-sm font-semibold text-emerald-700 dark:text-emerald-400"
      />
    </div>
  );
}

/* --------------------------- Identity facts ------------------------ */

function IdentityFacts({ employee, prefs }: { employee: HREmployee; prefs: FormatPrefs }) {
  const rows: Array<{
    label: string;
    value: string;
    icon?: React.ComponentType<{ className?: string }>;
    mono?: boolean;
    truncate?: boolean;
    valueClass?: string;
  }> = [
    { label: "Hire date", value: formatCompanyDate(employee.hire_date, prefs) },
  ];
  if (employee.termination_date) {
    rows.push({
      label: "Terminated",
      value: formatCompanyDate(employee.termination_date, prefs),
      valueClass: "text-red-600 dark:text-red-400",
    });
  }
  rows.push({
    label: "Email",
    value: employee.email ?? "—",
    icon: Mail,
    mono: Boolean(employee.email),
  });
  rows.push({
    label: "Phone",
    value: employee.phone ?? "—",
    icon: Phone,
    mono: Boolean(employee.phone),
  });
  if (employee.external_id) {
    rows.push({
      label: "External ID",
      value: employee.external_id,
      mono: true,
      truncate: true,
    });
  }

  return (
    <section
      className="rounded-lg border border-border/60 bg-card p-5 shadow-sm"
      aria-label="Identity summary"
    >
      <header className="mb-3 flex items-center gap-2">
        <IdCard className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold tracking-tight">Identity</h2>
      </header>
      <dl className="space-y-2 text-xs">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline gap-2">
            <dt className="flex w-24 shrink-0 items-center gap-1 text-muted-foreground">
              {r.icon && <r.icon className="size-3" aria-hidden />}
              {r.label}
            </dt>
            <dd
              className={cn(
                "min-w-0 flex-1",
                r.mono && "font-mono text-[11px]",
                r.truncate && "truncate",
                r.valueClass,
              )}
              title={r.truncate ? r.value : undefined}
            >
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
