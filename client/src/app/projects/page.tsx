import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  CheckCircle2,
  ClipboardList,
  Cog,
  Factory,
  FileText,
  PackageOpen,
  Plus,
  ShieldCheck,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { listProjects } from "@/lib/projects/server";
import { Badge } from "@/components/ui/badge-mini";
import { cn } from "@/lib/utils";
import type {
  OrderWizardPhaseKey,
  ProjectSummary,
} from "@/lib/types";

export const metadata = { title: "Production pipeline · PSP" };

// ============================================================================
// Phase metadata — single source of truth for the kanban column chrome.
// ============================================================================
//
// Columns always render in this order, regardless of whether they have any
// rows. An empty column still tells the operator the pipeline shape so a
// glance from across the room shows where today's bottleneck sits.

const PHASE_COLUMNS: ReadonlyArray<OrderWizardPhaseKey> = [
  "setup",
  "approval",
  "production_planning",
  "awaiting_ingredients",
  "in_production",
  "closeout",
  "final_release",
  "awaiting_routing",
  "ready_to_dispatch",
  "awaiting_pickup",
  "dispatched",
];

const PHASE_ICON: Record<OrderWizardPhaseKey, typeof ClipboardList> = {
  setup: FileText,
  approval: ShieldCheck,
  production_planning: Factory,
  awaiting_ingredients: Truck,
  in_production: Cog,
  closeout: PackageOpen,
  final_release: ShieldCheck,
  awaiting_routing: PackageOpen,
  ready_to_dispatch: FileText,
  awaiting_pickup: Truck,
  dispatched: CheckCircle2,
  cancelled: Ban,
};

const PHASE_LABEL: Record<OrderWizardPhaseKey, string> = {
  setup: "Order setup",
  approval: "Awaiting approval",
  production_planning: "Need MO created",
  awaiting_ingredients: "Awaiting ingredients",
  in_production: "In production",
  closeout: "Awaiting closeout",
  final_release: "Awaiting release",
  awaiting_routing: "Awaiting routing",
  ready_to_dispatch: "Shipment paperwork",
  awaiting_pickup: "Awaiting pickup",
  dispatched: "Dispatched",
  cancelled: "Cancelled",
};

/**
 * Accent stripe under each column header — mimics the colour-coded R&D
 * pipeline reference the team is anchoring the redesign on.
 *
 * Tones map to the phase's "temperature":
 *   - setup           → muted grey  (nothing's happened yet)
 *   - approval        → sky         (admin signoff in flight)
 *   - planning        → sky         (admin, but moving towards production)
 *   - awaiting ingr.  → amber       (procurement bottleneck)
 *   - in production   → amber       (floor work in flight)
 *   - closeout        → amber       (QC + warehouse handoff)
 *   - ready to ship   → emerald     (done, awaiting customer)
 */
const PHASE_ACCENT: Record<OrderWizardPhaseKey, string> = {
  setup: "bg-slate-400/70 dark:bg-slate-500/70",
  approval: "bg-sky-500/80 dark:bg-sky-400/80",
  production_planning: "bg-sky-500/80 dark:bg-sky-400/80",
  awaiting_ingredients: "bg-amber-500/80 dark:bg-amber-400/80",
  in_production: "bg-amber-500/80 dark:bg-amber-400/80",
  closeout: "bg-amber-500/80 dark:bg-amber-400/80",
  final_release: "bg-sky-500/80 dark:bg-sky-400/80",
  awaiting_routing: "bg-sky-500/80 dark:bg-sky-400/80",
  ready_to_dispatch: "bg-sky-500/80 dark:bg-sky-400/80",
  awaiting_pickup: "bg-amber-500/80 dark:bg-amber-400/80",
  dispatched: "bg-emerald-500/80 dark:bg-emerald-400/80",
  cancelled: "bg-destructive/70",
};

const PHASE_COUNT_TONE: Record<
  OrderWizardPhaseKey,
  "muted" | "sky" | "amber" | "emerald" | "destructive"
> = {
  setup: "muted",
  approval: "sky",
  production_planning: "sky",
  awaiting_ingredients: "amber",
  in_production: "amber",
  closeout: "amber",
  final_release: "sky",
  awaiting_routing: "sky",
  ready_to_dispatch: "sky",
  awaiting_pickup: "amber",
  dispatched: "emerald",
  cancelled: "destructive",
};

export default async function ProjectsPage() {
  const user = await requireUser();
  if (!hasPermission(user, "customer_orders.view")) {
    redirect("/settings/profile");
  }

  const projects = await listProjects();
  const rows = projects ?? [];
  const total = rows.length;
  const grouped = groupByPhase(rows);
  const canCreate = hasPermission(user, "customer_orders.create");

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-10">
        <div className="mx-auto max-w-[1600px] space-y-6">
          <PageHeader
            icon={ClipboardList}
            title="Production pipeline"
            description={
              <>
                Every customer order in flight, by phase. Click a card to
                open the project control board — it tells you what to do
                next without leaving the page.
                {total > 0 && (
                  <>
                    {" "}
                    <span className="font-medium text-foreground">
                      {total} project{total === 1 ? "" : "s"} live.
                    </span>
                  </>
                )}
              </>
            }
            actions={
              canCreate && (
                <Button asChild size="sm" className="shrink-0">
                  <Link href="/sales/orders/new">
                    <Plus className="mr-1.5 size-4" />
                    Start new project
                  </Link>
                </Button>
              )
            }
          />

          {total === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No active projects"
              body={
                <>
                  Once a customer order is submitted for approval, it shows
                  up here with its current phase + the next action you need
                  to take. Drafts don&rsquo;t appear until they&rsquo;re
                  submitted.
                </>
              }
              cta={
                <Link
                  href="/sales/orders/new"
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Start a new customer order
                  <ArrowRight className="size-3.5" />
                </Link>
              }
            />
          ) : (
            <KanbanBoard grouped={grouped} />
          )}
        </div>
      </main>
    </div>
  );
}

// ============================================================================
// Kanban board — 7 columns, horizontal scroll on narrow viewports.
// ============================================================================

function KanbanBoard({
  grouped,
}: {
  grouped: Partial<Record<OrderWizardPhaseKey, ProjectSummary[]>>;
}) {
  // Outer wrapper takes the horizontal scroll; the inner row is the
  // actual flex container. Min-width on each column keeps them from
  // collapsing into unreadable widths on wide-but-busy viewports.
  return (
    <div className="-mx-2 overflow-x-auto pb-4 sm:-mx-4">
      <div className="flex min-w-min gap-3 px-2 sm:gap-4 sm:px-4">
        {PHASE_COLUMNS.map((phaseKey) => {
          const rows = grouped[phaseKey] ?? [];
          return (
            <KanbanColumn key={phaseKey} phaseKey={phaseKey} rows={rows} />
          );
        })}
      </div>
    </div>
  );
}

function KanbanColumn({
  phaseKey,
  rows,
}: {
  phaseKey: OrderWizardPhaseKey;
  rows: ProjectSummary[];
}) {
  const Icon = PHASE_ICON[phaseKey];
  const accent = PHASE_ACCENT[phaseKey];
  const countTone = PHASE_COUNT_TONE[phaseKey];

  return (
    <section
      aria-label={PHASE_LABEL[phaseKey]}
      className="flex w-[280px] shrink-0 flex-col rounded-xl border border-border/60 bg-muted/20 sm:w-[300px]"
    >
      {/* ---------- Column header ---------- */}
      <header className="space-y-2 px-3 pt-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            <h2 className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {PHASE_LABEL[phaseKey]}
            </h2>
          </div>
          <Badge tone={countTone} className="shrink-0">
            {rows.length}
          </Badge>
        </div>
        <div className={cn("h-1 rounded-full", accent)} />
      </header>

      {/* ---------- Cards ---------- */}
      <div className="flex-1 space-y-2 p-3">
        {rows.length === 0 ? (
          <div className="flex h-16 items-center justify-center text-xs text-muted-foreground/50">
            —
          </div>
        ) : (
          rows.map((row) => (
            <ProjectCard key={row.customer_order.id} project={row} />
          ))
        )}
      </div>
    </section>
  );
}

// ============================================================================
// Project card — dense kanban tile.
// ============================================================================

function ProjectCard({ project }: { project: ProjectSummary }) {
  const co = project.customer_order;
  const customerName = co.customer?.name ?? "—";

  return (
    <Link
      href={`/projects/${co.uuid}`}
      data-collab-id={`project:${co.uuid}`}
      className="group block rounded-lg border border-border/60 bg-card p-3 shadow-sm transition hover:border-brand/60 hover:shadow-md"
    >
      {/* CO code — top, monospace, small */}
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {co.code ?? `CO #${co.id}`}
      </p>

      {/* Customer name */}
      <h3 className="mt-0.5 truncate text-sm font-semibold tracking-tight">
        {customerName}
      </h3>

      {/* Next action */}
      {project.next_action_title && (
        <p
          className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground"
          title={project.next_action_title}
        >
          {project.next_action_title}
        </p>
      )}

      {/* Chips — only render when > 0 */}
      <CardChips project={project} />
    </Link>
  );
}

function CardChips({ project }: { project: ProjectSummary }) {
  const chips: React.ReactNode[] = [];
  const phase = project.phase.key;

  // Blockers always show — they're current issues, not future-phase
  // noise. Everything else is gated by phase so a draft card
  // doesn't show "2 need MO" before MOs are even on the agenda.
  if (project.blocker_count > 0) {
    chips.push(
      <Chip
        key="blockers"
        tone="destructive"
        icon={<AlertTriangle className="size-2.5" />}
        title={`${project.blocker_count} blocker${
          project.blocker_count === 1 ? "" : "s"
        }`}
      >
        {project.blocker_count} blocker
        {project.blocker_count === 1 ? "" : "s"}
      </Chip>,
    );
  }

  // "Need MO" only relevant once production planning is the active
  // concern — i.e. CO is confirmed.
  if (
    project.lines_awaiting_mo > 0 &&
    (phase === "production_planning" ||
      phase === "awaiting_ingredients" ||
      phase === "in_production")
  ) {
    chips.push(
      <Chip
        key="awaiting_mo"
        tone="sky"
        title={`${project.lines_awaiting_mo} line${
          project.lines_awaiting_mo === 1 ? "" : "s"
        } waiting for MO`}
      >
        {project.lines_awaiting_mo} need MO
      </Chip>,
    );
  }

  // POs are only on the agenda once MOs exist and bookings might
  // have placeholders. Split the chip by what the planner can
  // actually do about it:
  //
  //   - Unsent PO → amber "Sign PO" (planner blocked something).
  //   - All sent → sky "Awaiting delivery" (procurement is doing
  //     its job, just wait for the vendor).
  if (
    phase === "awaiting_ingredients" ||
    phase === "in_production"
  ) {
    if (project.mos_awaiting_po_send > 0) {
      chips.push(
        <Chip
          key="po_send"
          tone="amber"
          title={`${project.mos_awaiting_po_send} MO${
            project.mos_awaiting_po_send === 1 ? "" : "s"
          } depend on a PO that hasn't been sent to the vendor yet`}
        >
          {project.mos_awaiting_po_send} sign PO
        </Chip>,
      );
    }

    if (project.mos_awaiting_delivery > 0) {
      chips.push(
        <Chip
          key="po_delivery"
          tone="sky"
          title={`${project.mos_awaiting_delivery} MO${
            project.mos_awaiting_delivery === 1 ? "" : "s"
          } awaiting delivery from the vendor`}
        >
          {project.mos_awaiting_delivery} awaiting delivery
        </Chip>,
      );
    }
  }

  if (project.mos_in_production > 0 && phase === "in_production") {
    chips.push(
      <Chip
        key="in_production"
        tone="amber"
        title={`${project.mos_in_production} MO${
          project.mos_in_production === 1 ? "" : "s"
        } in production`}
      >
        {project.mos_in_production} making
      </Chip>,
    );
  }

  if (project.mos_awaiting_closeout > 0 && phase === "closeout") {
    chips.push(
      <Chip
        key="closeout"
        tone="emerald"
        title={`${project.mos_awaiting_closeout} MO${
          project.mos_awaiting_closeout === 1 ? "" : "s"
        } awaiting closeout`}
      >
        {project.mos_awaiting_closeout} to close
      </Chip>,
    );
  }

  if (chips.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1">{chips}</div>
  );
}

function Chip({
  children,
  tone,
  icon,
  title,
}: {
  children: React.ReactNode;
  tone: "destructive" | "sky" | "amber" | "emerald";
  icon?: React.ReactNode;
  title?: string;
}) {
  // Small palette inline rather than reusing Badge — the kanban chip
  // sits at 9-10px and Badge's default padding is too tall for the
  // dense card layout.
  const tones: Record<typeof tone, string> = {
    destructive:
      "bg-destructive/10 text-destructive ring-destructive/20",
    sky: "bg-sky-50 text-sky-700 ring-sky-200/60 dark:bg-sky-950/30 dark:text-sky-300 dark:ring-sky-700/40",
    amber:
      "bg-amber-50 text-amber-800 ring-amber-200/60 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-700/40",
    emerald:
      "bg-emerald-50 text-emerald-800 ring-emerald-200/60 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-700/40",
  };
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1",
        tones[tone],
      )}
    >
      {icon}
      {children}
    </span>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function groupByPhase(
  rows: ProjectSummary[],
): Partial<Record<OrderWizardPhaseKey, ProjectSummary[]>> {
  const out: Partial<Record<OrderWizardPhaseKey, ProjectSummary[]>> = {};
  for (const row of rows) {
    const key = row.phase.key;
    out[key] = out[key] ?? [];
    out[key]!.push(row);
  }
  return out;
}
