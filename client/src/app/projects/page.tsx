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
  ShieldCheck,
  Truck,
} from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { listProjects } from "@/lib/projects/server";
import { getCompanyDefaults } from "@/lib/company/server";
import { Badge } from "@/components/ui/badge-mini";
import type {
  OrderWizardPhaseKey,
  ProjectSummary,
} from "@/lib/types";
import { formatCompanyDate } from "@/lib/format/company";

export const metadata = { title: "Projects · PSP" };

const PHASE_ICON: Record<OrderWizardPhaseKey, typeof ClipboardList> = {
  setup: FileText,
  approval: ShieldCheck,
  production_planning: Factory,
  awaiting_ingredients: Truck,
  in_production: Cog,
  closeout: PackageOpen,
  ready_to_dispatch: CheckCircle2,
  cancelled: Ban,
};

const PHASE_TONE: Record<
  OrderWizardPhaseKey,
  "muted" | "sky" | "amber" | "emerald" | "destructive"
> = {
  setup: "muted",
  approval: "sky",
  production_planning: "sky",
  awaiting_ingredients: "amber",
  in_production: "amber",
  closeout: "amber",
  ready_to_dispatch: "emerald",
  cancelled: "destructive",
};

export default async function ProjectsPage() {
  const user = await requireUser();
  if (!hasPermission(user, "customer_orders.view")) {
    redirect("/settings/profile");
  }

  const [projects, company] = await Promise.all([
    listProjects(),
    getCompanyDefaults(),
  ]);

  const total = projects?.length ?? 0;
  const grouped = groupByPhase(projects ?? []);
  const phaseOrder: OrderWizardPhaseKey[] = [
    "setup",
    "approval",
    "production_planning",
    "awaiting_ingredients",
    "in_production",
    "closeout",
    "ready_to_dispatch",
  ];

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-7xl space-y-6">
          <header className="space-y-1.5">
            <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              <ClipboardList className="size-7 text-brand sm:size-8" />
              Projects
            </h1>
            <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">
              Every customer order currently in flight, sorted by where
              it sits in the lifecycle. Click a card to open the wizard
              for that order — it tells you exactly what to do next.
              {total > 0 && (
                <>
                  {" "}
                  <strong className="text-foreground">{total}</strong>{" "}
                  active project{total === 1 ? "" : "s"}.
                </>
              )}
            </p>
          </header>

          {total === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-8">
              {phaseOrder.map((phaseKey) => {
                const rows = grouped[phaseKey] ?? [];
                if (rows.length === 0) return null;

                const Icon = PHASE_ICON[phaseKey];

                return (
                  <section key={phaseKey} className="space-y-3">
                    <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                      <Icon className="size-3.5" />
                      {phaseLabel(phaseKey)}
                      <Badge tone={PHASE_TONE[phaseKey]}>{rows.length}</Badge>
                    </h2>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {rows.map((p) => (
                        <ProjectCard
                          key={p.customer_order.id}
                          project={p}
                          prefs={company}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-border/60 bg-card/40 px-6 py-16 text-center">
      <ClipboardList className="mx-auto size-10 text-muted-foreground" />
      <h2 className="mt-3 text-sm font-semibold">No active projects</h2>
      <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
        Once a customer order is submitted for approval, it shows up
        here with its current phase + the next action you need to
        take. Drafts don&rsquo;t appear until they&rsquo;re submitted.
      </p>
      <Link
        href="/sales/orders/new"
        className="mt-4 inline-flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
      >
        Start a new customer order
        <ArrowRight className="size-3.5" />
      </Link>
    </div>
  );
}

function ProjectCard({
  project,
  prefs,
}: {
  project: ProjectSummary;
  prefs: Awaited<ReturnType<typeof getCompanyDefaults>>;
}) {
  const co = project.customer_order;
  const phase = project.phase;
  const Icon = PHASE_ICON[phase.key];
  const tone = PHASE_TONE[phase.key];

  return (
    <Link
      href={`/sales/orders/${co.uuid}?tab=wizard`}
      className="group flex flex-col gap-3 rounded-lg border border-border/60 bg-card p-4 shadow-sm transition hover:border-brand/60 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="truncate text-sm font-semibold tracking-tight">
            {co.customer?.name ?? "—"}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            <span className="font-mono">{co.code ?? `CO #${co.id}`}</span>
            {co.expected_ship_date && prefs && (
              <>
                {" "}
                · ship{" "}
                {formatCompanyDate(co.expected_ship_date, prefs)}
              </>
            )}
          </p>
        </div>
        <Badge tone={tone} className="shrink-0">
          <Icon className="mr-1 inline size-3" />
          {phase.label}
        </Badge>
      </div>

      <div className="rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-xs">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Do this next
        </p>
        <p className="mt-0.5 font-medium leading-snug">
          {project.next_action_title || "—"}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        {project.blocker_count > 0 && (
          <span className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-0.5 font-medium text-destructive">
            <AlertTriangle className="size-3" />
            {project.blocker_count} blocker
            {project.blocker_count === 1 ? "" : "s"}
          </span>
        )}
        {project.lines_awaiting_mo > 0 && (
          <span className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-2 py-0.5 font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
            {project.lines_awaiting_mo} line
            {project.lines_awaiting_mo === 1 ? "" : "s"} need MO
          </span>
        )}
        {project.mos_with_placeholders > 0 && (
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            {project.mos_with_placeholders} MO
            {project.mos_with_placeholders === 1 ? "" : "s"} on POs
          </span>
        )}
        {project.mos_in_production > 0 && (
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            {project.mos_in_production} MO
            {project.mos_in_production === 1 ? "" : "s"} in production
          </span>
        )}
        {project.mos_awaiting_closeout > 0 && (
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
            {project.mos_awaiting_closeout} MO
            {project.mos_awaiting_closeout === 1 ? "" : "s"} need closeout
          </span>
        )}
      </div>

      <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-brand opacity-0 transition group-hover:opacity-100">
        Open wizard <ArrowRight className="size-3" />
      </span>
    </Link>
  );
}

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

function phaseLabel(key: OrderWizardPhaseKey): string {
  switch (key) {
    case "setup":
      return "Order setup";
    case "approval":
      return "Awaiting approval";
    case "production_planning":
      return "Need MO created";
    case "awaiting_ingredients":
      return "Awaiting ingredients";
    case "in_production":
      return "In production";
    case "closeout":
      return "Awaiting closeout";
    case "ready_to_dispatch":
      return "Ready to dispatch";
    case "cancelled":
      return "Cancelled";
  }
}
