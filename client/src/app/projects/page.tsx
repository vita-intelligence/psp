import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  Beaker,
  CheckCircle2,
  ClipboardList,
  Cog,
  Factory,
  FileText,
  FlaskConical,
  PackageOpen,
  Plus,
  Send,
  ShieldCheck,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { EmptyState } from "@/components/layout/empty-state";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { listProjects } from "@/lib/projects/server";
import { Badge } from "@/components/ui/badge-mini";
import { cn } from "@/lib/utils";
import type {
  OrderWizardPhaseKey,
  ProjectSummary,
} from "@/lib/types";
import { npdFileUrl } from "@/lib/npd/file-proxy";

export const metadata = { title: "Production pipeline · PSP" };

// ============================================================================
// Phase metadata — single source of truth for the kanban column chrome.
// ============================================================================
//
// Columns always render in this order, regardless of whether they have any
// rows. An empty column still tells the operator the pipeline shape so a
// glance from across the room shows where today's bottleneck sits.

const PHASE_COLUMNS: ReadonlyArray<OrderWizardPhaseKey> = [
  "r_and_d",
  "awaiting_proposal",
  "awaiting_proposal_approval",
  "proposal_in_review",
  "proposal_ready_to_send",
  "awaiting_customer_signature",
  "awaiting_sample_selection",
  "proposal_accepted",
  "trial_batches_in_flight",
  "awaiting_final_spec",
  "setup",
  "approval",
  "production_planning",
  "awaiting_ingredients",
  "picking_ingredients",
  "in_production",
  "closeout",
  "final_release",
  "awaiting_routing",
  "ready_to_dispatch",
  "awaiting_pickup",
  "dispatched",
  "delivered",
];

const PHASE_ICON: Record<OrderWizardPhaseKey, typeof ClipboardList> = {
  r_and_d: Beaker,
  awaiting_proposal: FileText,
  awaiting_proposal_approval: FileText,
  proposal_in_review: ShieldCheck,
  proposal_ready_to_send: Send,
  awaiting_customer_signature: FileText,
  awaiting_sample_selection: FlaskConical,
  proposal_accepted: CheckCircle2,
  trial_batches_in_flight: FlaskConical,
  awaiting_final_spec: FileText,
  setup: FileText,
  approval: ShieldCheck,
  production_planning: Factory,
  awaiting_ingredients: Truck,
  picking_ingredients: Truck,
  in_production: Cog,
  closeout: PackageOpen,
  final_release: ShieldCheck,
  awaiting_routing: PackageOpen,
  ready_to_dispatch: FileText,
  awaiting_pickup: Truck,
  dispatched: Truck,
  delivered: CheckCircle2,
  cancelled: Ban,
};

const PHASE_LABEL: Record<OrderWizardPhaseKey, string> = {
  r_and_d: "R&D in development",
  awaiting_proposal: "Awaiting proposal",
  awaiting_proposal_approval: "Drafting proposal",
  proposal_in_review: "Proposal in review",
  proposal_ready_to_send: "Ready to send proposal",
  awaiting_customer_signature: "Sent to client",
  awaiting_sample_selection: "Choose samples",
  proposal_accepted: "Awaiting R&D payment",
  trial_batches_in_flight: "Trial batches",
  awaiting_final_spec: "Final spec",
  setup: "Order setup",
  approval: "Awaiting approval",
  production_planning: "Need MO created",
  awaiting_ingredients: "Awaiting ingredients",
  picking_ingredients: "Picking ingredients",
  in_production: "In production",
  closeout: "Awaiting closeout",
  final_release: "Awaiting release",
  awaiting_routing: "Awaiting routing",
  ready_to_dispatch: "Shipment paperwork",
  awaiting_pickup: "Awaiting pickup",
  dispatched: "In transit",
  delivered: "Delivered",
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
  r_and_d: "bg-fuchsia-500/80 dark:bg-fuchsia-400/80",
  awaiting_proposal: "bg-violet-500/80 dark:bg-violet-400/80",
  awaiting_proposal_approval: "bg-indigo-500/80 dark:bg-indigo-400/80",
  proposal_in_review: "bg-purple-500/80 dark:bg-purple-400/80",
  proposal_ready_to_send: "bg-blue-500/80 dark:bg-blue-400/80",
  awaiting_customer_signature: "bg-cyan-500/80 dark:bg-cyan-400/80",
  awaiting_sample_selection: "bg-orange-500/80 dark:bg-orange-400/80",
  proposal_accepted: "bg-teal-500/80 dark:bg-teal-400/80",
  trial_batches_in_flight: "bg-fuchsia-500/80 dark:bg-fuchsia-400/80",
  awaiting_final_spec: "bg-pink-500/80 dark:bg-pink-400/80",
  setup: "bg-slate-400/70 dark:bg-slate-500/70",
  approval: "bg-sky-500/80 dark:bg-sky-400/80",
  production_planning: "bg-sky-500/80 dark:bg-sky-400/80",
  awaiting_ingredients: "bg-amber-500/80 dark:bg-amber-400/80",
  picking_ingredients: "bg-amber-500/80 dark:bg-amber-400/80",
  in_production: "bg-amber-500/80 dark:bg-amber-400/80",
  closeout: "bg-amber-500/80 dark:bg-amber-400/80",
  final_release: "bg-sky-500/80 dark:bg-sky-400/80",
  awaiting_routing: "bg-sky-500/80 dark:bg-sky-400/80",
  ready_to_dispatch: "bg-sky-500/80 dark:bg-sky-400/80",
  awaiting_pickup: "bg-amber-500/80 dark:bg-amber-400/80",
  dispatched: "bg-amber-500/80 dark:bg-amber-400/80",
  delivered: "bg-emerald-500/80 dark:bg-emerald-400/80",
  cancelled: "bg-destructive/70",
};

const PHASE_COUNT_TONE: Record<
  OrderWizardPhaseKey,
  "muted" | "sky" | "amber" | "emerald" | "destructive"
> = {
  r_and_d: "muted",
  awaiting_proposal: "sky",
  awaiting_proposal_approval: "sky",
  proposal_in_review: "sky",
  proposal_ready_to_send: "sky",
  awaiting_customer_signature: "sky",
  awaiting_sample_selection: "amber",
  proposal_accepted: "emerald",
  trial_batches_in_flight: "amber",
  awaiting_final_spec: "amber",
  setup: "muted",
  approval: "sky",
  production_planning: "sky",
  awaiting_ingredients: "amber",
  picking_ingredients: "amber",
  in_production: "amber",
  closeout: "amber",
  final_release: "sky",
  awaiting_routing: "sky",
  ready_to_dispatch: "sky",
  awaiting_pickup: "amber",
  dispatched: "amber",
  delivered: "emerald",
  cancelled: "destructive",
};

export default async function ProjectsPage() {
  const user = await requireUser();
  if (!hasPermission(user, "customer_orders.view")) {
    redirect("/settings/profile");
  }

  // Customer-order pipeline is the primary payload. Every project on
  // NPD (vita-cff) is mirrored here as a CustomerOrder keyed by the
  // NPD formulation UUID, so R&D-in-development cards flow into the
  // ``r_and_d`` phase column of the standard kanban — no ad-hoc
  // sidechannel fetch to a foreign backend.
  const projects = await listProjects();
  const rows = projects ?? [];
  const total = rows.length;
  const grouped = groupByPhase(rows);
  const canCreate = hasPermission(user, "customer_orders.create");

  // Fullscreen kanban — same shell as /production/schedule. The
  // outer flex column pins to viewport height; ``overflow-hidden``
  // there prevents any page-level scroll. Kanban section takes
  // ``flex-1 min-h-0`` and owns the horizontal scroll; each column
  // gets its own vertical scroll so a phase overflowing with rows
  // doesn't push the header off screen for the other columns.
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar user={user} />
      <PresenceMount />

      <main className="flex min-h-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border/60 bg-card px-4 py-2.5 sm:px-6">
          <ClipboardList className="size-5 shrink-0 text-brand" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold tracking-tight">
              Production pipeline
            </h1>
            <p className="truncate text-[11px] text-muted-foreground">
              Every customer order in flight, by phase.
              {total > 0 && (
                <>
                  {" "}
                  <span className="font-medium text-foreground">
                    {total} project{total === 1 ? "" : "s"} live.
                  </span>
                </>
              )}
            </p>
          </div>
          {canCreate && (
            <Button asChild size="sm" className="shrink-0">
              <Link href="/sales/orders/new">
                <Plus className="mr-1.5 size-4" />
                Start new project
              </Link>
            </Button>
          )}
        </header>

        {total === 0 ? (
          <div className="flex flex-1 items-center justify-center p-6">
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
          </div>
        ) : (
          <KanbanBoard grouped={grouped} />
        )}
      </main>
    </div>
  );
}

// ============================================================================
// Kanban board — 19 phase columns. Fills remaining viewport height, owns
// the ONLY horizontal scroll on the page (columns overflow right); each
// column body owns its own vertical scroll so a phase with 40 rows
// doesn't push its header off screen or force the sibling columns to
// grow. Container uses ``min-h-0`` so ``flex-1`` inside a flex parent
// actually shrinks instead of expanding to content height.
// ============================================================================

function KanbanBoard({
  grouped,
}: {
  grouped: Partial<Record<OrderWizardPhaseKey, ProjectSummary[]>>;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
      <div className="flex h-full min-w-min gap-3 px-3 py-3 sm:gap-4 sm:px-4 sm:py-4">
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
      className="flex h-full w-[280px] shrink-0 flex-col rounded-xl border border-border/60 bg-muted/20 sm:w-[300px]"
    >
      {/* ---------- Column header (sticky at the top of the column
          because the header sits above the scrollable body, not
          inside it — no ``sticky`` needed) ---------- */}
      <header className="shrink-0 space-y-2 px-3 pt-3">
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

      {/* ---------- Cards — independently scrollable body ---------- */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
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
  // NPD-mirrored drafts (R&D, Awaiting proposal, and any downstream
  // phase before Sales links a real customer via the proposal flow)
  // all point at the same auto-created stub called "NPD Placeholder".
  // That name reads as plumbing junk on the kanban — swap in the
  // formulation title (stashed in ``customer_reference`` by the
  // sync) whenever the placeholder is what we've got. The real
  // customer name takes over on the very next sync once linked.
  const isPlaceholderCustomer = co.customer?.name === "NPD Placeholder";
  // Preference order when the placeholder is still attached:
  //   1. NPD's linked-customer display name (real client, mirrored
  //      via Formulation.customer)
  //   2. NPD's formulation title stashed in customer_reference
  //   3. Whatever we've got.
  const title =
    (isPlaceholderCustomer &&
      (co.npd_customer_display_name || co.customer_reference)) ||
    customerName ||
    co.customer_reference ||
    "—";

  //: Header image is the strongest identity cue on the card.
  //: Rendered as a wide banner above the code so the operator can
  //: eyeball whose product is whose when 30+ cards are on screen.
  //: vita-cff picks the URL (approved label preview → first product
  //: photo → empty), we just render whatever it hands over. Routed
  //: through the file proxy so the cross-origin fetch is authorised.
  //: Nothing renders when the URL is empty — matches the historical
  //: behaviour ("no LabelDesign row" now also captures "no product
  //: image either").
  const headerImage = npdFileUrl(co.npd_header_image_url);
  const labelApproved = co.npd_label_status === "label_approved";
  const hasLabelWorkflow = !!co.npd_label_design_uuid;
  const labelStatusPillCopy: Record<string, string> = {
    payment_pending: "Label · awaiting payment",
    label_path_pending: "Label · path pending",
    design_fee_pending: "Label · fee pending",
    design_preferences_pending: "Label · brief pending",
    design_in_progress: "Label · in design",
    scientist_review: "Label · sci review",
    director_review: "Label · dir review",
    customer_approval: "Label · customer review",
    label_approved: "Label approved",
    on_hold: "Label · on hold",
  };
  const labelPillText =
    labelStatusPillCopy[co.npd_label_status || ""] || "Label pending";

  return (
    <Link
      href={`/projects/${co.uuid}`}
      data-collab-id={`project:${co.uuid}`}
      className="group block rounded-lg border border-border/60 bg-card p-3 shadow-sm transition hover:border-brand/60 hover:shadow-md"
    >
      {/* Header banner. vita-cff picked the URL (approved label PNG
          → first product photo → empty); we render whatever's there.
          The violet ring stays for approved-label variants so the
          "signed off" state is visually distinct from a product-photo
          fallback. */}
      {headerImage ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={headerImage}
          alt={labelApproved ? "Approved label preview" : "Product image"}
          className={cn(
            "mb-2 h-14 w-full rounded border object-contain",
            labelApproved
              ? "border-violet-200/60 dark:border-violet-900/50"
              : "border-border/50",
          )}
        />
      ) : null}

      {/* CO code + optional Sample chip. Sample sits inline with the
          code (not in the phase-gated chips row below) because it's
          an identity marker of the project, not a status. Trial-slot
          badge stacks below on cycle-child sample MOs so scientists
          can eyeball which sample cards are siblings of the same
          custom-formulation CO. */}
      <div className="flex items-center gap-1.5">
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {co.code ?? `CO #${co.id}`}
        </p>
        {co.sample_kind ? (
          <span
            title="NPD sample fulfilment — customer-paid sample run, not a commercial order."
            className="inline-flex items-center rounded-md bg-violet-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-violet-700 ring-1 ring-violet-200/60 dark:bg-violet-950/30 dark:text-violet-300 dark:ring-violet-700/40"
          >
            Sample
          </span>
        ) : null}
        {/* Label progress pill — surfaces workflow state for the pre-
            approved states. Suppressed once approved (the banner
            carries the signal). */}
        {hasLabelWorkflow && !labelApproved ? (
          <span
            title={`Label workflow: ${labelPillText}`}
            className="ml-auto inline-flex items-center rounded-md bg-violet-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-violet-700 ring-1 ring-violet-200/60 dark:bg-violet-950/30 dark:text-violet-300 dark:ring-violet-700/40"
          >
            {labelPillText}
          </span>
        ) : null}
      </div>

      {/* Trial-slot badge — only on cycle-child sample MOs. Links
          to the parent custom-formulation CO so scientists can jump
          between siblings. */}
      {co.parent_customer_order_uuid ? (
        <p className="mt-0.5">
          <span
            title="Sample slot in a custom-formulation trial-batch cycle. Open the parent project from its own kanban card."
            className="inline-flex items-center rounded-md bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-700 ring-1 ring-amber-200/60 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-700/40"
          >
            {co.npd_trial_slot_sequence_no != null && co.npd_trial_slot_total != null
              ? `↳ Trial ${co.npd_trial_slot_sequence_no}/${co.npd_trial_slot_total}`
              : "↳ Trial"}
            {co.parent_customer_order_reference
              ? ` · ${co.parent_customer_order_reference}`
              : ""}
          </span>
        </p>
      ) : null}

      {/* Project title — NPD formulation name for R&D, customer name
          otherwise. */}
      <h3 className="mt-0.5 truncate text-sm font-semibold tracking-tight">
        {title}
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
      phase === "picking_ingredients" ||
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
    phase === "picking_ingredients" ||
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
