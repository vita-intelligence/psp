"use client";

/**
 * Project Control Board — the single page an operator needs to drive
 * a customer order from approval through dispatch.
 *
 * Structure:
 *
 *   - Sticky header  — customer name, code, phase, "do this next" CTA
 *   - Left lane      — phase stepper, next-action card, blockers,
 *                      per-line cards with MO state, open POs
 *   - Right lane     — customer summary, timeline, comments
 *
 * Inline modals: MO detail (status timeline, bookings, output lots,
 * action buttons), PO summary, customer summary, BOM picker (when a
 * line has multiple BOMs to choose from), send-to-device QR.
 *
 * Realtime: subscribes to `wizard:co:<co_uuid>` — the BE rebroadcasts
 * `"changed"` after any write affecting the project graph; the board
 * refetches the wizard snapshot to reproject.
 */

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import QRCode from "qrcode";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Ban,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ClipboardList,
  Cog,
  Copy,
  ExternalLink,
  Factory,
  FileText,
  Hourglass,
  Layers,
  Loader2,
  Package,
  PackageOpen,
  PackagePlus,
  Receipt,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Truck,
  User as UserIcon,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge-mini";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { CommentThread } from "@/components/comments/comment-thread";
import { createInvoiceFromCOAction } from "@/lib/customer-invoices/actions";
import {
  listMyDevicesAction,
  pushNavigateToDeviceAction,
  pushNavigateToMyDevicesAction,
} from "@/lib/devices/actions";
import type { LinkedDevice } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { Comment } from "@/lib/comments/types";
import type {
  CompanyDefaults,
  CustomerOrder,
  OrderWizardAvailableBom,
  OrderWizardBlocker,
  OrderWizardCta,
  OrderWizardInvoice,
  OrderWizardLine,
  OrderWizardMo,
  OrderWizardMoStatus,
  OrderWizardOpenPo,
  OrderWizardPhase,
  OrderWizardPhaseKey,
  OrderWizardSnapshot,
  OrderWizardTimelineEntry,
} from "@/lib/types";
import {
  formatCompanyDate,
  formatCompanyMoney,
  formatCompanyNumber,
} from "@/lib/format/company";
import {
  markConfirmedCOAction,
  signApproverCOAction,
  signDirectorCOAction,
  submitCOAction,
} from "@/lib/customer-orders/actions";
import {
  createMoForLineAction,
  transitionMOAction,
  type MOActionString,
} from "@/lib/order-wizard/actions";
import { useWizardChannel } from "@/lib/order-wizard/use-wizard-channel";

// =============================================================================
// Phase metadata
// =============================================================================

const PHASE_ORDER: OrderWizardPhaseKey[] = [
  "setup",
  "approval",
  "production_planning",
  "awaiting_ingredients",
  "in_production",
  "closeout",
  "ready_to_dispatch",
];

const PHASE_LABEL: Record<OrderWizardPhaseKey, string> = {
  setup: "Setup",
  approval: "Approval",
  production_planning: "Planning",
  awaiting_ingredients: "Ingredients",
  in_production: "Production",
  closeout: "Closeout",
  ready_to_dispatch: "Ready",
  cancelled: "Cancelled",
};

const PHASE_DESCRIPTION: Record<OrderWizardPhaseKey, string> = {
  setup: "Add lines and price the order.",
  approval: "Two-tier sign-off before production starts.",
  production_planning: "Spawn MOs, schedule, gather ingredients.",
  awaiting_ingredients: "Waiting on POs covering placeholder bookings.",
  in_production: "Lines are being made on the floor.",
  closeout: "QC the outputs and move them to the warehouse.",
  ready_to_dispatch: "Done — ship it to the customer.",
  cancelled: "Terminal — nothing else moves.",
};

const PHASE_ICON: Record<
  OrderWizardPhaseKey,
  React.ComponentType<{ className?: string }>
> = {
  setup: FileText,
  approval: ShieldCheck,
  production_planning: Factory,
  awaiting_ingredients: Truck,
  in_production: Cog,
  closeout: PackageOpen,
  ready_to_dispatch: CheckCircle2,
  cancelled: Ban,
};

// MO status badge tones — mirror the MO detail page palette.
const MO_STATUS_LABEL: Record<OrderWizardMoStatus, string> = {
  draft: "Draft",
  prepared: "Prepared",
  approved: "Approved",
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

const MO_STATUS_TONE: Record<
  OrderWizardMoStatus,
  "muted" | "sky" | "amber" | "emerald" | "destructive"
> = {
  draft: "muted",
  prepared: "muted",
  approved: "sky",
  scheduled: "sky",
  in_progress: "amber",
  completed: "emerald",
  cancelled: "destructive",
};

// Live sub-stage for an MO. `status` alone is too coarse — "scheduled"
// covers three distinct moments (awaiting pickup, picking, awaiting
// preflight) that each need their own label + handoff button. Without
// this, planners look at a "Scheduled" badge and can't tell whether
// the picker has even started.
type MoLiveStage =
  | "approved"
  | "awaiting_pickup"
  | "picking"
  | "awaiting_preflight"
  | "ready_to_run"
  | "running"
  | "awaiting_output_qc"
  | "awaiting_closeout"
  | "awaiting_warehouse_return"
  | "completed";

interface MoStageView {
  key: MoLiveStage;
  label: string;
  hint: string;
  tone: "muted" | "sky" | "amber" | "emerald";
}

function deriveMoLiveStage(mo: OrderWizardMo): MoStageView | null {
  switch (mo.status) {
    case "approved":
      return {
        key: "approved",
        label: "Approved — not yet released",
        hint: "Release to warehouse from the MO page to unlock pickup.",
        tone: "sky",
      };
    case "scheduled":
      if (!mo.pickup_started_at && !mo.pickup_completed_at) {
        return {
          key: "awaiting_pickup",
          label: "Awaiting pickup",
          hint: "A warehouse picker needs to claim this MO and fetch the booked lots.",
          tone: "amber",
        };
      }
      if (mo.pickup_started_at && !mo.pickup_completed_at) {
        return {
          key: "picking",
          label: mo.pickup_started_by_name
            ? `Picking — ${mo.pickup_started_by_name} on the floor`
            : "Picking in progress",
          hint: "Picker is on the floor with the trolley. Wait for hand-off before preflight.",
          tone: "amber",
        };
      }
      if (mo.preflight_complete) {
        return {
          key: "ready_to_run",
          label: "Ready to start run",
          hint: "Every booking signed off at the production-feed cell. Production operator opens the run on device to flip the MO to In progress.",
          tone: "emerald",
        };
      }
      return {
        key: "awaiting_preflight",
        label: "Awaiting preflight sign-off",
        hint: "Picker has dropped the lots at the production-feed cell. Production operator weighs + confirms each one.",
        tone: "amber",
      };
    case "in_progress":
      return {
        key: "running",
        label: "Run in progress",
        hint: "Operator is executing the routing steps on the shop floor.",
        tone: "amber",
      };
    case "completed":
      // Production run is over but the closeout chain has several
      // gates left before the MO is truly done. STRICT ORDER:
      //   1. Output QC — the manufactured product must be cleared.
      //   2. Booking closeout — record what was consumed of each
      //      ingredient + route any leftover material to a dispatch
      //      cell. Has to happen BEFORE the return-pickup, otherwise
      //      the warehouse picker fetches only the outputs and
      //      leaves the dispatch pile orphaned on the floor.
      //   3. Warehouse return — picker walks outputs + dispatched
      //      leftovers back to storage.
      // The wizard renders exactly ONE active step at a time so the
      // operator can't pick the wrong one out of sequence.
      if (mo.output_qc_pending_count > 0) {
        return {
          key: "awaiting_output_qc",
          label: `Awaiting output QC (${mo.output_qc_pending_count})`,
          hint: "Production finished. Output lots are at the production-feed cell with status received — a QC operator needs to pass or fail each before the rest of the closeout chain can move.",
          tone: "amber",
        };
      }
      if (mo.bookings_closeout_pending_count > 0) {
        return {
          key: "awaiting_closeout",
          label: `Awaiting booking closeout (${mo.bookings_closeout_pending_count})`,
          hint: "QC cleared the outputs. Production operator now records consumed quantity per booked ingredient and routes any leftover material to a dispatch cell. The warehouse return-pickup is gated on this finishing first.",
          tone: "amber",
        };
      }
      if (mo.output_at_feed_count > 0) {
        return {
          key: "awaiting_warehouse_return",
          label: `Awaiting warehouse return (${mo.output_at_feed_count})`,
          hint: "Closeout's done; outputs + dispatched leftovers are staged for pickup. Warehouse picker walks them back to storage.",
          tone: "amber",
        };
      }
      return {
        key: "completed",
        label: "Closeout",
        hint: "Outputs have been returned to warehouse storage. MO is done from production's side.",
        tone: "emerald",
      };
    default:
      return null;
  }
}

// =============================================================================
// Permissions + props
// =============================================================================

export interface ProjectBoardPermissions {
  canEdit: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  canDirectorApprove: boolean;
  canConfirm: boolean;
  canManageMOs: boolean;
  canCreateInvoice: boolean;
  /** `warehouse.pick` — gates the "Send pickup to phone" CTA on MOs
   *  waiting for the warehouse picker to fetch + drop bookings. */
  canPick: boolean;
}

interface Props {
  co: CustomerOrder;
  wizard: OrderWizardSnapshot | null;
  prefs: CompanyDefaults;
  initialComments: Comment[];
  currentUserId: number;
  permissions: ProjectBoardPermissions;
}

// =============================================================================
// Main board
// =============================================================================

export function ProjectControlBoard({
  co,
  wizard,
  prefs,
  initialComments,
  currentUserId,
  permissions,
}: Props) {
  const router = useRouter();
  // Mirror the wizard prop into state so realtime "changed" events can
  // refetch and update without remounting the whole tree.
  const [snapshot, setSnapshot] = useState<OrderWizardSnapshot | null>(wizard);
  const [refreshing, setRefreshing] = useState(false);

  // Refetch the wizard snapshot when a peer (or our own action) pushes
  // a `"changed"` event onto the wizard channel. Goes through the
  // local proxy (`/api/wizard/<uuid>`) — the existing /api/* proxy
  // route handles auth.
  const refreshSnapshot = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(
        `/api/customer-orders/${encodeURIComponent(co.uuid)}/wizard`,
        { cache: "no-store" },
      );
      if (res.ok) {
        const { wizard: next } = (await res.json()) as {
          wizard: OrderWizardSnapshot;
        };
        setSnapshot(next);
      }
    } finally {
      setRefreshing(false);
    }
  }, [co.uuid]);

  useWizardChannel({
    coUuid: co.uuid,
    onChanged: () => {
      // Defer to React's transition machinery so a rapid burst of
      // BE writes (e.g. cascading MO status changes) only triggers
      // one refetch.
      startTransition(() => {
        void refreshSnapshot();
      });
    },
  });

  // Modal state — each modal owns one piece of data; only one is open
  // at a time. Lifted here so the action handlers can close + open
  // others (e.g. BOM picker → after success → close + toast).
  const [moModalUuid, setMoModalUuid] = useState<string | null>(null);
  const [poModalUuid, setPoModalUuid] = useState<string | null>(null);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [bomPickerLine, setBomPickerLine] = useState<OrderWizardLine | null>(
    null,
  );
  const [qrModalCta, setQrModalCta] = useState<OrderWizardCta | null>(null);

  const openMoModal = useCallback((moUuid: string) => {
    setMoModalUuid(moUuid);
  }, []);
  const openPoModal = useCallback((poUuid: string) => {
    setPoModalUuid(poUuid);
  }, []);

  // Build a map of MO UUID → MO once per snapshot so the modal can
  // resolve in O(1) without scanning lines.
  const moByUuid = useMemo(() => {
    const map = new Map<string, OrderWizardMo>();
    const seed = (mo: OrderWizardMo) => map.set(mo.uuid, mo);
    snapshot?.mos?.forEach(seed);
    snapshot?.lines.forEach((line) => {
      line.mos.forEach(seed);
      if (line.primary_mo) seed(line.primary_mo);
    });
    return map;
  }, [snapshot]);

  const poByUuid = useMemo(() => {
    const map = new Map<string, OrderWizardOpenPo>();
    snapshot?.open_pos.forEach((po) => map.set(po.uuid, po));
    return map;
  }, [snapshot]);

  // Phase stepper scroll targets — anchored to `data-phase` divs in
  // the layout below so clicking a step jumps the viewport.
  const scrollToPhase = useCallback((key: OrderWizardPhaseKey) => {
    const el = document.querySelector(`[data-phase="${key}"]`);
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  if (!snapshot) {
    return <BoardSkeleton co={co} />;
  }

  const {
    phase,
    next_action,
    blockers,
    lines,
    open_pos,
    invoices,
    timeline,
  } = snapshot;

  return (
    <main className="flex-1 bg-muted/20">
      {/* ---------- Sticky header ---------- */}
      <StickyHeader
        co={co}
        phase={phase}
        nextAction={next_action}
        permissions={permissions}
        onCtaClick={(cta) =>
          handleCta(cta, {
            coUuid: co.uuid,
            router,
            setBomPickerLine,
            setQrModalCta,
            scrollToPhase,
            lines,
            refresh: refreshSnapshot,
          })
        }
        refreshing={refreshing}
      />

      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-8 sm:py-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          {/* ===================== LEFT — control lane ===================== */}
          <div className="space-y-6">
            {/* Phase stepper */}
            <section data-phase="setup">
              <PhaseStepper phase={phase} onClick={scrollToPhase} />
            </section>

            {/* What this phase means + what to do */}
            <PhaseExplainerCard phase={phase} />

            {/* Do-this-next card */}
            <NextActionCard
              nextAction={next_action}
              phase={phase}
              co={co}
              permissions={permissions}
              lines={lines}
              onCtaClick={(cta) =>
                handleCta(cta, {
                  coUuid: co.uuid,
                  router,
                  setBomPickerLine,
                  setQrModalCta,
                  scrollToPhase,
                  lines,
                  refresh: refreshSnapshot,
                })
              }
              coStatus={co.status}
            />

            {/* Blockers */}
            {blockers.length > 0 && <BlockersCard blockers={blockers} />}

            {/* Invoice reminder — advisory, never a blocker. */}
            <InvoiceReminderCard
              coUuid={co.uuid}
              coStatus={co.status}
              invoices={invoices ?? []}
              canCreateInvoice={permissions.canCreateInvoice}
            />

            {/* Lines & MOs */}
            <section data-phase="production_planning">
              <LinesSection
                lines={lines}
                coStatus={co.status}
                prefs={prefs}
                permissions={permissions}
                onOpenMo={openMoModal}
                onSpawnMo={(line) => {
                  if (line.available_boms.length > 1) {
                    setBomPickerLine(line);
                  } else {
                    void runCreateMo(
                      co.uuid,
                      line.uuid,
                      undefined,
                      refreshSnapshot,
                    );
                  }
                }}
                onMoAction={(moUuid, action) =>
                  runMoTransition(
                    co.uuid,
                    moUuid,
                    action,
                    refreshSnapshot,
                  )
                }
                onSendToDevice={(cta) => setQrModalCta(cta)}
              />
            </section>

            {/* Open POs */}
            {open_pos.length > 0 && (
              <section data-phase="awaiting_ingredients">
                <OpenPosCard
                  openPos={open_pos}
                  prefs={prefs}
                  onOpenPo={openPoModal}
                />
              </section>
            )}
          </div>

          {/* ===================== RIGHT — context lane ===================== */}
          <div className="flex flex-col gap-6">
            <CustomerCard
              co={co}
              prefs={prefs}
              onClick={() => setCustomerModalOpen(true)}
            />
            <TimelineCard timeline={timeline} prefs={prefs} />
          </div>
        </div>

        {/* ===================== Full-width Discussion ===================== */}
        {/* Workers will spend real time here when something needs
           coordinating — give the thread its own row, generous height,
           and a single source of card chrome (CommentThread provides
           its own). */}
        <section
          aria-label="Project discussion"
          className="min-h-[400px]"
        >
          <CommentThread
            entityType="customer_order"
            entityUuid={co.uuid}
            initial={initialComments}
            canComment={permissions.canEdit}
            currentUserId={currentUserId}
          />
        </section>
      </div>

      {/* ============== Modals ============== */}
      <MoModal
        uuid={moModalUuid}
        mo={moModalUuid ? moByUuid.get(moModalUuid) ?? null : null}
        coUuid={co.uuid}
        prefs={prefs}
        permissions={permissions}
        onClose={() => setMoModalUuid(null)}
        onSendToDevice={(cta) => {
          setMoModalUuid(null);
          setQrModalCta(cta);
        }}
      />
      <PoModal
        po={poModalUuid ? poByUuid.get(poModalUuid) ?? null : null}
        prefs={prefs}
        onClose={() => setPoModalUuid(null)}
      />
      <CustomerModal
        co={co}
        open={customerModalOpen}
        onClose={() => setCustomerModalOpen(false)}
      />
      <BomPickerModal
        line={bomPickerLine}
        coUuid={co.uuid}
        onClose={() => setBomPickerLine(null)}
        onPicked={() => {
          setBomPickerLine(null);
          void refreshSnapshot();
        }}
      />
      <SendToDeviceModal
        cta={qrModalCta}
        onClose={() => setQrModalCta(null)}
      />
    </main>
  );
}

// =============================================================================
// Sticky header
// =============================================================================

function StickyHeader({
  co,
  phase,
  nextAction,
  permissions,
  onCtaClick,
  refreshing,
}: {
  co: CustomerOrder;
  phase: OrderWizardPhase;
  nextAction: OrderWizardSnapshot["next_action"];
  permissions: ProjectBoardPermissions;
  onCtaClick: (cta: OrderWizardCta) => void;
  refreshing: boolean;
}) {
  const Icon = PHASE_ICON[phase.key];

  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto max-w-7xl px-4 py-3 sm:px-8 sm:py-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Link
                href="/projects"
                aria-label="Back to projects"
                className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <ChevronLeft className="size-4" />
              </Link>
              <ShoppingBag className="size-3.5" />
              <span className="font-mono font-semibold">
                {co.code ?? `CO #${co.id}`}
              </span>
              {refreshing && (
                <span
                  className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider"
                  aria-live="polite"
                >
                  <Loader2 className="size-3 animate-spin" />
                  Syncing
                </span>
              )}
            </div>
            <h1 className="mt-0.5 truncate text-lg font-semibold tracking-tight sm:text-xl">
              {co.customer?.name ?? "—"}
            </h1>
          </div>

          <Badge tone={phaseBadgeTone(phase.key)} className="shrink-0 px-3 py-1 text-sm">
            <Icon className="mr-1.5 inline size-3.5" />
            {phase.label}
          </Badge>

          {nextAction?.primary_cta && (
            <div className="ml-auto w-full sm:w-auto">
              <PrimaryCtaButton
                cta={nextAction.primary_cta}
                onClick={onCtaClick}
                disabled={!ctaAllowed(nextAction.primary_cta, permissions)}
                className="w-full sm:w-auto"
              />
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

// =============================================================================
// Phase stepper
// =============================================================================

function PhaseStepper({
  phase,
  onClick,
}: {
  phase: OrderWizardPhase;
  onClick: (key: OrderWizardPhaseKey) => void;
}) {
  if (phase.key === "cancelled") {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="flex items-center gap-3 py-4 text-sm">
          <Ban className="size-5 text-destructive" />
          <span className="font-medium text-destructive">
            Cancelled — this project is terminal.
          </span>
        </CardContent>
      </Card>
    );
  }

  const current = phase.index;

  return (
    <Card className="border-border/60">
      <CardContent className="px-2 py-3 sm:px-4 sm:py-4">
        <ol className="grid grid-cols-7 gap-0.5 sm:gap-1">
          {PHASE_ORDER.map((key, idx) => {
            const Icon = PHASE_ICON[key];
            const isDone = idx < current;
            const isActive = idx === current;
            return (
              <li key={key} className="flex flex-col items-stretch">
                <button
                  type="button"
                  onClick={() => onClick(key)}
                  aria-current={isActive ? "step" : undefined}
                  className={cn(
                    "group flex flex-col items-center gap-1 rounded-md border px-0.5 py-1.5 text-center text-[9px] font-medium transition sm:px-1 sm:py-2 sm:text-[11px]",
                    isActive &&
                      "border-brand/70 bg-brand/15 text-foreground shadow-sm ring-1 ring-brand/30",
                    isDone &&
                      "border-emerald-300/50 bg-emerald-50/50 text-emerald-800/80 hover:bg-emerald-100/70 dark:border-emerald-700/40 dark:bg-emerald-950/20 dark:text-emerald-300/80",
                    !isActive &&
                      !isDone &&
                      "border-border/40 bg-muted/30 text-muted-foreground hover:bg-muted/60",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full sm:size-7",
                      isActive && "bg-brand text-white shadow-sm",
                      isDone && "bg-emerald-600/90 text-white",
                      !isActive && !isDone && "bg-muted text-muted-foreground",
                    )}
                  >
                    {isDone ? (
                      <CheckCircle2 className="size-3.5 sm:size-4" />
                    ) : (
                      <Icon className="size-3 sm:size-3.5" />
                    )}
                  </span>
                  <span className="truncate leading-tight">
                    {PHASE_LABEL[key]}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">
          {PHASE_DESCRIPTION[phase.key]}
        </p>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Next-action card (the giant "do this next" block)
// =============================================================================

function NextActionCard({
  nextAction,
  phase,
  co,
  permissions,
  lines,
  onCtaClick,
  coStatus,
}: {
  nextAction: OrderWizardSnapshot["next_action"];
  phase: OrderWizardPhase;
  co: CustomerOrder;
  permissions: ProjectBoardPermissions;
  lines: OrderWizardLine[];
  onCtaClick: (cta: OrderWizardCta) => void;
  coStatus: CustomerOrder["status"];
}) {
  if (!nextAction) {
    if (phase.key === "ready_to_dispatch") {
      return <ReadyToDispatchEmpty co={co} />;
    }
    return (
      <Card className="border-emerald-300/60 bg-emerald-50/40 dark:border-emerald-700/40 dark:bg-emerald-950/20">
        <CardContent className="flex items-center gap-3 py-6">
          <CheckCircle2 className="size-6 shrink-0 text-emerald-600" />
          <div>
            <p className="text-base font-semibold">Nothing to do right now.</p>
            <p className="text-sm text-muted-foreground">
              Something else in the workflow is doing the work — sit back
              and watch the timeline.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Defensive guard: the BE only surfaces `create_mo` once the CO is
  // confirmed, but if the FE ever receives one out-of-order we render
  // a disabled state rather than letting the worker hit a CTA that
  // will 422 — MOs cannot be created before the order is confirmed.
  const coConfirmed = coStatus === "confirmed";
  const isCreateMoBeforeConfirm =
    nextAction.code === "create_mo" && !coConfirmed;

  // CTAs that spawn MOs are also hidden / disabled before confirmation —
  // belt-and-braces for both the primary and the per-line secondaries.
  const filterCta = (cta: OrderWizardCta) => {
    if (cta.kind !== "action") return true;
    if (cta.action === "create_mo_for_line" && !coConfirmed) return false;
    return true;
  };

  // Inline BOM picker when create-mo lands and there are multiple
  // BOMs to choose from — surface the picker without a click.
  const inlineBomPicker =
    nextAction.code === "create_mo" &&
    coConfirmed &&
    lines.some((l) => l.available_boms.length > 1);

  if (isCreateMoBeforeConfirm) {
    return (
      <Card className="border-2 border-amber-300/60 bg-gradient-to-br from-amber-50/60 via-background to-background shadow-sm dark:border-amber-700/60 dark:from-amber-950/30">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Hourglass className="size-4 text-amber-700 dark:text-amber-400" />
            <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300">
              Do this next
            </p>
          </div>
          <CardTitle className="text-xl sm:text-2xl">
            Confirm the order first
          </CardTitle>
          <CardDescription className="text-sm">
            Manufacturing orders can only be created once this customer
            order is confirmed. Finish the approval &amp; confirmation
            step above before spawning MOs.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const primaryCta = nextAction.primary_cta;
  const primaryHidden =
    primaryCta?.kind === "action" &&
    primaryCta.action === "create_mo_for_line" &&
    !coConfirmed;

  return (
    <Card className="border-2 border-brand/40 bg-gradient-to-br from-brand/5 via-background to-background shadow-md">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <ArrowRight className="size-4 text-brand" />
          <p className="text-[11px] font-semibold uppercase tracking-wider text-brand">
            Do this next
          </p>
        </div>
        <CardTitle className="text-xl sm:text-2xl">{nextAction.title}</CardTitle>
        {nextAction.detail && (
          <CardDescription className="text-sm">
            {nextAction.detail}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {primaryCta && !primaryHidden && (
          <PrimaryCtaButton
            cta={primaryCta}
            onClick={onCtaClick}
            disabled={!ctaAllowed(primaryCta, permissions)}
            size="lg"
          />
        )}

        {/* Every other pending step in the project. Renders as a
            full-width row per CTA so the room can see the whole
            punch-list at a glance instead of one primary + a strip
            of small chips. Disabled buttons mean "the BE will
            refuse" — typically a permission the current user
            doesn't carry. The hint row underneath says so. */}
        {nextAction.secondary_ctas.filter(filterCta).length > 0 && (
          <div className="space-y-2 pt-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Other steps in this project
            </p>
            <ul className="space-y-1.5">
              {nextAction.secondary_ctas.filter(filterCta).map((cta, idx) => {
                const allowed = ctaAllowed(cta, permissions);
                const rowTitle = cta.description ?? cta.label;
                return (
                  <li
                    key={`${cta.label}-${idx}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-background/60 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="text-sm font-medium leading-snug">
                        {rowTitle}
                      </p>
                      {!allowed && (
                        <p className="text-[11px] text-muted-foreground">
                          You don&apos;t have the permission for this — ask
                          a teammate who does.
                        </p>
                      )}
                    </div>
                    <SecondaryCtaButton
                      cta={cta}
                      onClick={onCtaClick}
                      disabled={!allowed}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {inlineBomPicker && (
          <div className="rounded-md border border-amber-300/50 bg-amber-50/50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-200">
            <span className="font-medium">Multiple BOMs available.</span>{" "}
            Click <em>Create MO</em> on the relevant line to pick which BOM to use.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReadyToDispatchEmpty({ co }: { co: CustomerOrder }) {
  return (
    <Card className="border-2 border-emerald-300/60 bg-gradient-to-br from-emerald-50 via-background to-background shadow-md dark:border-emerald-700/60 dark:from-emerald-950/30">
      <CardContent className="py-8 text-center">
        <CheckCircle2 className="mx-auto size-10 text-emerald-600" />
        <h2 className="mt-3 text-lg font-semibold">All done — go grab a coffee.</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          The lines are made, QC&apos;d, and sitting in the warehouse waiting
          for {co.customer?.name ?? "the customer"}. Hand over to dispatch
          when they&apos;re ready to pick.
        </p>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// CTA buttons
// =============================================================================

function PrimaryCtaButton({
  cta,
  onClick,
  disabled,
  size = "lg",
  className,
}: {
  cta: OrderWizardCta;
  onClick: (cta: OrderWizardCta) => void;
  disabled?: boolean;
  size?: "lg" | "default";
  className?: string;
}) {
  const Icon = ctaIcon(cta);
  return (
    <Button
      size={size}
      className={cn("font-semibold", className)}
      onClick={() => onClick(cta)}
      disabled={disabled}
    >
      <Icon className="mr-2 size-4" />
      {cta.label}
      {(cta.kind === "link" || cta.kind === "send_to_device") && (
        <ExternalLink className="ml-2 size-3.5 opacity-70" />
      )}
    </Button>
  );
}

function SecondaryCtaButton({
  cta,
  onClick,
  disabled,
}: {
  cta: OrderWizardCta;
  onClick: (cta: OrderWizardCta) => void;
  disabled?: boolean;
}) {
  const Icon = ctaIcon(cta);
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => onClick(cta)}
      disabled={disabled}
    >
      <Icon className="mr-1.5 size-3.5" />
      {cta.label}
    </Button>
  );
}

function ctaIcon(cta: OrderWizardCta) {
  if (cta.kind === "link") return ExternalLink;
  if (cta.kind === "send_to_device") return Smartphone;
  if (cta.kind === "scroll_to") return ArrowRight;
  switch (cta.action) {
    case "submit":
      return ShieldCheck;
    case "sign_approver":
    case "sign_director":
      return ShieldCheck;
    case "confirm":
      return CheckCircle2;
    case "create_mo_for_line":
      return PackagePlus;
    case "prepare_mo":
      return Factory;
    case "approve_mo":
      return ShieldCheck;
    case "request_purchases":
      return ShoppingBag;
    default:
      return ArrowRight;
  }
}

function ctaAllowed(
  cta: OrderWizardCta,
  permissions: ProjectBoardPermissions,
): boolean {
  // Links + scrolls + device handoffs aren't permission-gated client-side;
  // BE handles auth on follow-up requests. Action CTAs are.
  if (cta.kind !== "action") return true;
  switch (cta.action) {
    case "submit":
      return permissions.canSubmit;
    case "sign_approver":
      return permissions.canApprove;
    case "sign_director":
      return permissions.canDirectorApprove;
    case "confirm":
      return permissions.canConfirm;
    case "create_mo_for_line":
    case "prepare_mo":
    case "approve_mo":
    case "request_purchases":
      return permissions.canManageMOs;
    default:
      return true;
  }
}

// =============================================================================
// Blockers
// =============================================================================

function BlockersCard({ blockers }: { blockers: OrderWizardBlocker[] }) {
  return (
    <Card className="border-destructive/40 bg-destructive/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base text-destructive">
          <AlertCircle className="size-4" />
          {blockers.length} issue{blockers.length === 1 ? "" : "s"} blocking forward motion
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {blockers.map((b) => (
          <BlockerRow key={b.code} blocker={b} />
        ))}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Phase explainer — plain-language "what's happening, what to do".
// =============================================================================

const PHASE_EXPLAINER: Record<
  OrderWizardPhaseKey,
  { title: string; body: string } | null
> = {
  setup: {
    title: "You're building the order.",
    body: "Pick the customer, add the lines they want, set ship date and address. Nothing is locked yet — edit freely. When you're done, submit for approval.",
  },
  approval: {
    title: "Two signatures needed.",
    body: "Approver signs first (commercial check), then director signs second (segregation of duties — must be a different person). Once both signatures are in, hit Mark confirmed to release the order into production.",
  },
  production_planning: {
    title: "Plan every MO, then we move on.",
    body: "Open each MO, pick the BOM if there's a choice, then on the MO page allocate lots for what's in stock and Request purchases for what isn't. Once every MO is signed off AND every shortage has a PO behind it, the order rolls into Ingredients.",
  },
  awaiting_ingredients: {
    title: "Waiting on POs to land.",
    body: "Procurement is engaged. As each PO arrives and clears QC, its lot replaces the placeholder booking on the MO automatically. When all bookings are real, you can schedule the runs.",
  },
  in_production: {
    title: "On the floor.",
    body: "MOs are scheduled or running. Operators pick from booked lots, run the routing on a device, and produce output lots that land in the production-feed cell.",
  },
  closeout: {
    title: "Move output to warehouse storage.",
    body: "Runs are finished but output lots are still in production-feed. Send the closeout flow to a device so the warehouse team can transfer the goods to a regular / dispatch cell.",
  },
  ready_to_dispatch: {
    title: "Order is ready to ship.",
    body: "All output is in warehouse cells. Generate the invoice (if needed) and arrange a courier. Dispatch module isn't built yet — for now this is the terminal state.",
  },
  cancelled: null,
};

function PhaseExplainerCard({ phase }: { phase: OrderWizardPhase }) {
  const entry = PHASE_EXPLAINER[phase.key];
  if (!entry) return null;
  return (
    <Card className="border-border/40 bg-card">
      <CardContent className="space-y-1 py-3">
        <p className="text-sm font-medium text-foreground">{entry.title}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {entry.body}
        </p>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Invoice reminder — advisory only, decoupled from production state.
// =============================================================================

function InvoiceReminderCard({
  coUuid,
  coStatus,
  invoices,
  canCreateInvoice,
}: {
  coUuid: string;
  coStatus: string;
  invoices: OrderWizardInvoice[];
  canCreateInvoice: boolean;
}) {
  const router = useRouter();
  const [generating, startGenerate] = useTransition();

  // No reminder before the CO is confirmed — too early to invoice.
  // No reminder when terminal-cancelled — moot.
  if (coStatus !== "confirmed") return null;

  if (invoices.length > 0) {
    const total = invoices.length;
    const first = invoices[0];
    const targetHref = first
      ? `/sales/invoices/${first.uuid}`
      : `/sales/invoices`;
    return (
      <Card className="border-emerald-300/50 bg-emerald-50/40 dark:border-emerald-800/40 dark:bg-emerald-950/20">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
          <div className="flex items-center gap-2 text-emerald-900 dark:text-emerald-200">
            <Receipt className="size-4 shrink-0" />
            <span>
              {total} invoice{total === 1 ? "" : "s"} attached
              {first?.code ? ` (${first.code}${total > 1 ? ` +${total - 1}` : ""})` : ""}
            </span>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href={targetHref}>
              {total === 1 ? "Open invoice" : "View invoices"}
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  function generate() {
    startGenerate(async () => {
      const res = await createInvoiceFromCOAction(coUuid, {});
      if (res.ok) {
        toast.success("Invoice generated");
        router.push(`/sales/invoices/${res.customer_invoice.uuid}`);
      } else {
        toast.error(res.detail);
      }
    });
  }

  return (
    <Card className="border-amber-300/50 bg-amber-50/50 dark:border-amber-800/40 dark:bg-amber-950/20">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
        <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200">
          <Receipt className="size-4 shrink-0" />
          <span>
            No invoice attached. Some orders ship without one — raise it if this one needs billing.
          </span>
        </div>
        {canCreateInvoice && (
          <Button size="sm" variant="outline" onClick={generate} disabled={generating}>
            {generating ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            ) : null}
            Generate invoice
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function BlockerRow({ blocker }: { blocker: OrderWizardBlocker }) {
  const Icon = blocker.severity === "error" ? AlertCircle : AlertTriangle;
  const tone =
    blocker.severity === "error" ? "text-destructive" : "text-amber-600";
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-md border border-border/40 bg-card px-3 py-2 text-sm">
      <Icon className={cn("mt-0.5 size-4 shrink-0", tone)} />
      <p className="flex-1 leading-snug">{blocker.message}</p>
      {blocker.link && (
        <Button asChild size="sm" variant="outline">
          <Link href={blocker.link.href}>{blocker.link.label}</Link>
        </Button>
      )}
    </div>
  );
}

// =============================================================================
// Lines & MOs section
// =============================================================================

function LinesSection({
  lines,
  coStatus,
  prefs,
  permissions,
  onOpenMo,
  onSpawnMo,
  onMoAction,
  onSendToDevice,
}: {
  lines: OrderWizardLine[];
  coStatus: CustomerOrder["status"];
  prefs: CompanyDefaults;
  permissions: ProjectBoardPermissions;
  onOpenMo: (uuid: string) => void;
  onSpawnMo: (line: OrderWizardLine) => void;
  onMoAction: (moUuid: string, action: MOActionString) => Promise<void>;
  onSendToDevice: (cta: OrderWizardCta) => void;
}) {
  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="size-4 text-muted-foreground" />
          Lines &amp; manufacturing orders
        </CardTitle>
        <CardDescription>
          What we&apos;re making for this order — one card per line, with
          its linked MO state.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {lines.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/40 bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
            No lines on this order yet.
          </p>
        ) : (
          lines.map((line) => (
            <LineCard
              key={line.uuid}
              line={line}
              coStatus={coStatus}
              prefs={prefs}
              permissions={permissions}
              onOpenMo={onOpenMo}
              onSpawnMo={onSpawnMo}
              onMoAction={onMoAction}
              onSendToDevice={onSendToDevice}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function LineCard({
  line,
  coStatus,
  prefs,
  permissions,
  onOpenMo,
  onSpawnMo,
  onMoAction,
  onSendToDevice,
}: {
  line: OrderWizardLine;
  coStatus: CustomerOrder["status"];
  prefs: CompanyDefaults;
  permissions: ProjectBoardPermissions;
  onOpenMo: (uuid: string) => void;
  onSpawnMo: (line: OrderWizardLine) => void;
  onMoAction: (moUuid: string, action: MOActionString) => Promise<void>;
  onSendToDevice: (cta: OrderWizardCta) => void;
}) {
  const hasMo = line.mos.length > 0;
  const canSpawn = permissions.canManageMOs;
  // MO creation is gated on the CO being fully confirmed —
  // chronologically the production phase only starts after the
  // approver + director have signed AND the order has been
  // marked confirmed. Anything earlier and we hide the trigger.
  const coConfirmed = coStatus === "confirmed";

  // Roll-up over descendants so the line header can show at-a-glance
  // "3 MOs · 1 completed" without the planner expanding every leaf.
  const flatMoTree = flattenMoTree(line.mos);
  const totalMos = flatMoTree.length;
  const completedMos = flatMoTree.filter((m) => m.status === "completed").length;
  const inFlightMos = flatMoTree.filter((m) =>
    ["scheduled", "in_progress"].includes(m.status),
  ).length;

  return (
    <section className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/40 bg-muted/30 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="grid size-7 shrink-0 place-items-center rounded-md bg-background text-muted-foreground shadow-inner">
              <Package className="size-3.5" />
            </div>
            <p className="min-w-0 truncate text-sm font-semibold tracking-tight">
              {line.item_name ?? `Line #${line.id}`}
            </p>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-9 text-[11px] text-muted-foreground">
            <span>
              Qty ordered{" "}
              <span className="font-mono font-medium text-foreground">
                {formatCompanyNumber(line.qty_ordered, prefs)}
              </span>
            </span>
            {totalMos > 0 && (
              <>
                <span className="text-border">·</span>
                <span>
                  {totalMos} MO{totalMos === 1 ? "" : "s"}
                  {completedMos > 0 && (
                    <span className="ml-1 text-emerald-700 dark:text-emerald-400">
                      · {completedMos} done
                    </span>
                  )}
                  {inFlightMos > 0 && (
                    <span className="ml-1 text-amber-700 dark:text-amber-400">
                      · {inFlightMos} live
                    </span>
                  )}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="shrink-0">
          {!hasMo && line.needs_mo && !coConfirmed && (
            <Badge tone="muted">
              <Hourglass className="mr-1 inline size-3" />
              Awaiting confirmation
            </Badge>
          )}
          {!hasMo && line.needs_mo && coConfirmed && canSpawn && (
            <SpawnMoButton line={line} onClick={() => onSpawnMo(line)} />
          )}
          {!hasMo && line.needs_mo && coConfirmed && !canSpawn && (
            <Badge tone="muted">MO required</Badge>
          )}
        </div>
      </header>

      {hasMo && (
        <div className="space-y-2 px-4 py-3">
          {line.mos.map((mo) => (
            <MiniMoCard
              key={mo.uuid}
              mo={mo}
              prefs={prefs}
              permissions={permissions}
              onOpenMo={onOpenMo}
              onSendToDevice={onSendToDevice}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function flattenMoTree(mos: OrderWizardMo[]): OrderWizardMo[] {
  return mos.flatMap((mo) => [mo, ...flattenMoTree(mo.children ?? [])]);
}

// Left-rail accent per status — thin colored bar signals the MO's
// state at a glance without a badge scan. Matches MO_STATUS_TONE.
const MO_STATUS_RAIL: Record<OrderWizardMoStatus, string> = {
  draft: "bg-muted-foreground/30",
  prepared: "bg-muted-foreground/40",
  approved: "bg-sky-500/70",
  scheduled: "bg-sky-500/70",
  in_progress: "bg-amber-500/80",
  completed: "bg-emerald-500/80",
  cancelled: "bg-destructive/70",
};

function SpawnMoButton({
  line,
  onClick,
}: {
  line: OrderWizardLine;
  onClick: () => void;
}) {
  const multi = line.available_boms.length > 1;
  const noBom = line.available_boms.length === 0;

  if (noBom) {
    return (
      <Badge tone="destructive" className="shrink-0">
        <AlertCircle className="mr-1 inline size-3" />
        No BOM published
      </Badge>
    );
  }

  return (
    <Button size="sm" onClick={onClick}>
      <PackagePlus className="mr-1.5 size-3.5" />
      {multi ? "Pick BOM & create MO" : "Create MO"}
    </Button>
  );
}

function MiniMoCard({
  mo,
  prefs,
  permissions,
  onOpenMo,
  onSendToDevice,
  depth = 0,
}: {
  mo: OrderWizardMo;
  prefs: CompanyDefaults;
  permissions: ProjectBoardPermissions;
  onOpenMo: (uuid: string) => void;
  onSendToDevice: (cta: OrderWizardCta) => void;
  /** Nesting level — children get indented + a "Sub-MO" tag. */
  depth?: number;
}) {
  const onOpen = () => onOpenMo(mo.uuid);
  const stage = deriveMoLiveStage(mo);
  const isChild = depth > 0;
  return (
    <div
      className={cn(
        "relative flex overflow-hidden rounded-lg border border-border/60 bg-background shadow-sm transition-colors hover:border-border",
        isChild && "ml-4",
      )}
    >
      {/* Status-tinted left rail — at-a-glance signal without the
          operator having to read the badge in the header row. Slight
          shift on hover for tactile feedback. */}
      <div className={cn("w-1 shrink-0", MO_STATUS_RAIL[mo.status])} />
      {isChild && (
        <span
          aria-hidden
          className="absolute -left-4 top-1/2 h-px w-4 -translate-y-px bg-border/60"
        />
      )}

      <div className="min-w-0 flex-1 space-y-2.5 px-3.5 py-3">
        {/* Header row: MO code (mono, prominent), item + qty inline,
            status badge pinned to the right. */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={onOpen}
              className="font-mono text-xs font-semibold tracking-tight text-foreground underline-offset-4 hover:underline"
            >
              {mo.code ?? `MO #${mo.id}`}
            </button>
            {isChild && (
              <Badge tone="muted" className="text-[10px]">
                Sub-MO
              </Badge>
            )}
            <span className="truncate text-[12px] text-muted-foreground">
              <span className="text-foreground/80">{mo.item_name ?? "Item"}</span>
              <span className="mx-1 text-border">·</span>
              Qty{" "}
              <span className="font-mono text-foreground/80">
                {formatCompanyNumber(mo.quantity, prefs)}
              </span>
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {mo.due_date && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Calendar className="size-3" />
                {formatCompanyDate(mo.due_date, prefs)}
              </span>
            )}
            <Badge tone={MO_STATUS_TONE[mo.status]}>
              {MO_STATUS_LABEL[mo.status]}
            </Badge>
          </div>
        </div>

        {/* Live sub-stage. The MO status alone is too coarse — a
            "Scheduled" MO can be awaiting pickup, picking, or awaiting
            preflight, and each needs its own handoff button. Showing
            the stage explicitly stops planners from guessing where in
            the workflow the order actually is. */}
        {stage && (
          <div className="flex items-start gap-2 rounded-md bg-muted/40 px-2.5 py-1.5">
            <Badge tone={stage.tone} className="shrink-0">
              {stage.label}
            </Badge>
            <p className="text-[11px] leading-snug text-muted-foreground">
              {stage.hint}
            </p>
          </div>
        )}

        {/* Stat strip — each metric in its own pill so the eye can
            skim booking status ↔ output status ↔ warnings without
            them running together as one comma-separated line. */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="inline-flex items-center gap-1 rounded-md border border-border/40 bg-muted/30 px-1.5 py-0.5">
            <BookingsSummary mo={mo} />
          </span>
          <span className="inline-flex items-center gap-1 rounded-md border border-border/40 bg-muted/30 px-1.5 py-0.5">
            <OutputSummary mo={mo} />
          </span>
          {mo.broken_booking_count > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-destructive">
              <AlertCircle className="size-3" />
              {mo.broken_booking_count} broken
            </span>
          )}
        </div>

        {/* Stage-driven actions: each sub-stage gets the single
            handoff that moves the work forward. Picker / preflight /
            run / closeout all route to mobile pages, gated on the
            matching permission so a non-picker doesn't see
            "Send to picker". */}
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {permissions.canManageMOs ? (
          <Button asChild size="sm" variant="outline">
            <Link href={`/production/manufacturing-orders/${mo.uuid}`}>
              <ExternalLink className="mr-1 size-3" />
              Open MO
            </Link>
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={onOpen}>
            View details
          </Button>
        )}

        {stage?.key === "awaiting_pickup" && permissions.canPick && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onSendToDevice({
                label: "Send pickup to device",
                kind: "send_to_device",
                href: `/m/pickup/${mo.uuid}`,
                mo_uuid: mo.uuid,
              })
            }
          >
            <Smartphone className="mr-1 size-3" />
            Send pickup
          </Button>
        )}

        {stage?.key === "picking" && permissions.canPick && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onSendToDevice({
                label: "Open pickup on device",
                kind: "send_to_device",
                href: `/m/pickup/${mo.uuid}`,
                mo_uuid: mo.uuid,
              })
            }
          >
            <Smartphone className="mr-1 size-3" />
            Open pickup
          </Button>
        )}

        {stage?.key === "awaiting_preflight" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onSendToDevice({
                label: "Send preflight to device",
                kind: "send_to_device",
                href: `/m/preflight/${mo.uuid}`,
                mo_uuid: mo.uuid,
              })
            }
          >
            <Smartphone className="mr-1 size-3" />
            Send preflight
          </Button>
        )}

        {stage?.key === "ready_to_run" && (
          <Button asChild size="sm" variant="outline">
            <Link href={`/production/runs/${mo.uuid}`}>
              <ExternalLink className="mr-1 size-3" />
              Open run
            </Link>
          </Button>
        )}

        {stage?.key === "running" && (
          <Button asChild size="sm" variant="outline">
            <Link href={`/production/runs/${mo.uuid}`}>
              <ExternalLink className="mr-1 size-3" />
              Open run
            </Link>
          </Button>
        )}

        {stage?.key === "awaiting_output_qc" && (
          <Button asChild size="sm" variant="outline">
            <Link href="/production/output-qc">
              <ExternalLink className="mr-1 size-3" />
              Open output QC
            </Link>
          </Button>
        )}

        {stage?.key === "awaiting_warehouse_return" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onSendToDevice({
                label: "Send return-pickup to device",
                kind: "send_to_device",
                href: `/m/return-pickup`,
                mo_uuid: mo.uuid,
              })
            }
          >
            <Smartphone className="mr-1 size-3" />
            Send return pickup
          </Button>
        )}

        {/* Booking closeout — only available AFTER output QC clears
            and BEFORE the warehouse fetches anything back. The stage
            machinery enforces the order; we just check the stage. */}
        {stage?.key === "awaiting_closeout" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onSendToDevice({
                label: "Send closeout to device",
                kind: "send_to_device",
                href: `/m/closeout/${mo.uuid}`,
                mo_uuid: mo.uuid,
              })
            }
          >
            <Smartphone className="mr-1 size-3" />
            Send closeout
          </Button>
        )}
      </div>

        {/* Auto-spawned sub-assembly MOs render nested under the
            parent. Each child renders its own connector + rail, so
            no wrapper border needed here — just a tight stack. */}
        {mo.children && mo.children.length > 0 && (
          <div className="space-y-2 pt-0.5">
            {mo.children.map((child) => (
              <MiniMoCard
                key={child.uuid}
                mo={child}
                prefs={prefs}
                permissions={permissions}
                onOpenMo={onOpenMo}
                onSendToDevice={onSendToDevice}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BookingsSummary({ mo }: { mo: OrderWizardMo }) {
  const total = mo.bookings_total;
  if (total === 0) {
    return <span className="text-muted-foreground">No bookings</span>;
  }
  const placeholders = mo.placeholder_count;
  const real = total - placeholders;
  if (placeholders === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
        <Package className="size-3" />
        {real}/{total} real
      </span>
    );
  }
  // Per-placeholder breakdown — the project board splits the chip so a
  // planner can see "X awaiting QC" separately from "X awaiting
  // delivery" without opening the MO. Fall back to the legacy "need PO
  // / awaiting delivery" split when the BE didn't surface a breakdown
  // (older snapshots / mid-deploy).
  const awaitingQc = mo.placeholder_awaiting_qc_count ?? 0;
  const inTransit = mo.placeholder_in_transit_count ?? 0;
  const notSent = mo.placeholder_not_sent_count ?? 0;
  const breakdownKnown = awaitingQc + inTransit + notSent === placeholders;

  const parts: string[] = breakdownKnown
    ? [
        notSent > 0 ? `${notSent} need PO` : null,
        inTransit > 0 ? `${inTransit} awaiting delivery` : null,
        awaitingQc > 0 ? `${awaitingQc} awaiting QC` : null,
      ].filter((s): s is string => !!s)
    : [
        !!mo.purchasing_requested_at
          ? `${placeholders} awaiting delivery`
          : `${placeholders} need PO`,
      ];

  // Icon priority follows the chip ordering: not_sent (Hourglass — the
  // immediate blocker) wins over in_transit (ShoppingBag) wins over
  // awaiting_qc (Package).
  const Icon =
    notSent > 0 ? Hourglass : inTransit > 0 ? ShoppingBag : Package;

  // Soften the tone when EVERY placeholder is just awaiting QC —
  // procurement is fully done, only QA is left, so amber overstates
  // the urgency. Sky reads as "passive wait" per the kanban palette.
  const tone =
    breakdownKnown && notSent === 0 && inTransit === 0 && awaitingQc > 0
      ? "text-sky-700 dark:text-sky-400"
      : "text-amber-700 dark:text-amber-400";

  return (
    <span className={cn("inline-flex items-center gap-1", tone)}>
      <Icon className="size-3" />
      {real}/{total} real · {parts.join(" · ")}
    </span>
  );
}

function OutputSummary({ mo }: { mo: OrderWizardMo }) {
  const made = mo.output_lot_count;
  if (made === 0) {
    return <span className="text-muted-foreground">Not made yet</span>;
  }
  const feed = mo.output_at_feed_count;
  const wh = mo.output_in_warehouse_count;
  if (feed > 0 && wh === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
        <PackageOpen className="size-3" />
        Made: {made} at feed
      </span>
    );
  }
  if (wh > 0 && feed === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
        <PackageOpen className="size-3" />
        In warehouse ({wh})
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
      <PackageOpen className="size-3" />
      {wh} in WH; {feed} at feed
    </span>
  );
}

// =============================================================================
// Open POs card
// =============================================================================

function OpenPosCard({
  openPos,
  prefs,
  onOpenPo,
}: {
  openPos: OrderWizardOpenPo[];
  prefs: CompanyDefaults;
  onOpenPo: (uuid: string) => void;
}) {
  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShoppingBag className="size-4 text-muted-foreground" />
          Open purchase orders
        </CardTitle>
        <CardDescription>
          POs covering placeholder bookings for this project&apos;s MOs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {openPos.map((po) => (
          <button
            key={po.uuid}
            type="button"
            onClick={() => onOpenPo(po.uuid)}
            className="flex w-full items-center justify-between gap-3 rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-left text-xs transition-colors hover:bg-muted/40"
          >
            <div className="min-w-0">
              <p className="truncate font-mono font-medium">
                {po.code ?? `PO #${po.id}`}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {po.vendor_name ?? "—"} · ETA{" "}
                {formatCompanyDate(po.expected_delivery_date, prefs)} ·{" "}
                {po.status}
              </p>
            </div>
            <span className="shrink-0 font-mono text-[11px]">
              {formatCompanyMoney(po.grand_total, prefs, {
                currency_code: po.currency_code,
              })}
            </span>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Right-lane cards
// =============================================================================

function CustomerCard({
  co,
  prefs,
  onClick,
}: {
  co: CustomerOrder;
  prefs: CompanyDefaults;
  onClick: () => void;
}) {
  const c = co.customer;
  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <UserIcon className="size-4 text-muted-foreground" />
          Customer
        </CardTitle>
      </CardHeader>
      <CardContent>
        <button
          type="button"
          onClick={onClick}
          className="w-full rounded-md border border-border/40 bg-muted/20 px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
        >
          <p className="text-sm font-semibold tracking-tight">
            {c?.name ?? "—"}
          </p>
          <p className="mt-0.5 text-[11px] font-mono text-muted-foreground">
            {c?.code ?? "—"}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
            {c?.payment_terms_days != null && (
              <Badge tone="muted">
                Terms: {c.payment_terms_days}d {c.payment_terms_basis}
              </Badge>
            )}
            {c?.effective_approval_status && (
              <Badge
                tone={
                  c.effective_approval_status === "approved"
                    ? "emerald"
                    : c.effective_approval_status === "suspended"
                      ? "destructive"
                      : "amber"
                }
              >
                {c.effective_approval_status}
              </Badge>
            )}
          </div>
          {co.expected_ship_date && (
            <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Truck className="size-3" />
              Ship by {formatCompanyDate(co.expected_ship_date, prefs)}
            </p>
          )}
        </button>
      </CardContent>
    </Card>
  );
}

function TimelineCard({
  timeline,
  prefs,
}: {
  timeline: OrderWizardTimelineEntry[];
  prefs: CompanyDefaults;
}) {
  return (
    <Card className="flex grow flex-col border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="size-4 text-muted-foreground" />
          Timeline
        </CardTitle>
      </CardHeader>
      <CardContent className="grow overflow-y-auto">
        {timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events yet.</p>
        ) : (
          <ol className="space-y-3">
            {timeline.map((entry, idx) => {
              const Icon = entry.scope === "mo" ? Factory : ShoppingBag;
              return (
                <li
                  key={`${entry.at}-${idx}`}
                  className="flex gap-3 text-sm"
                >
                  <div className="flex flex-col items-center">
                    <span
                      className={cn(
                        "mt-1 flex size-5 items-center justify-center rounded-full",
                        entry.scope === "mo"
                          ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                          : "bg-brand/15 text-brand",
                      )}
                    >
                      <Icon className="size-2.5" />
                    </span>
                    {idx < timeline.length - 1 && (
                      <span className="my-1 w-px flex-1 bg-border" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 pb-1">
                    <p className="leading-snug">{entry.label}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {formatCompanyDate(entry.at, prefs)}
                      {entry.actor ? ` · ${entry.actor}` : ""}
                      {entry.mo_uuid && (
                        <>
                          {" · "}
                          <Link
                            href={`/production/manufacturing-orders/${entry.mo_uuid}`}
                            className="text-brand underline-offset-2 hover:underline"
                          >
                            open MO
                          </Link>
                        </>
                      )}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// MO modal
// =============================================================================

function MoModal({
  uuid,
  mo,
  coUuid,
  prefs,
  permissions,
  onClose,
  onSendToDevice,
}: {
  uuid: string | null;
  mo: OrderWizardMo | null;
  coUuid: string;
  prefs: CompanyDefaults;
  permissions: ProjectBoardPermissions;
  onClose: () => void;
  onSendToDevice: (cta: OrderWizardCta) => void;
}) {
  // Defensive guard: parent re-renders may briefly have uuid set
  // before the snapshot map has the row.
  if (!uuid) return null;
  const open = !!uuid;

  if (!mo) {
    return (
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Manufacturing order</DialogTitle>
            <DialogDescription>Loading…</DialogDescription>
          </DialogHeader>
          <Skeleton className="h-32 w-full" />
        </DialogContent>
      </Dialog>
    );
  }

  const stage = deriveMoLiveStage(mo);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Factory className="size-4 text-muted-foreground" />
            <span className="font-mono">{mo.code ?? `MO #${mo.id}`}</span>
            <Badge tone={MO_STATUS_TONE[mo.status]}>
              {MO_STATUS_LABEL[mo.status]}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            {mo.item_name ?? "—"} · Qty{" "}
            <span className="font-mono">{formatCompanyNumber(mo.quantity, prefs)}</span>
            {mo.due_date && (
              <>
                {" · "}Due {formatCompanyDate(mo.due_date, prefs)}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {stage && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Current stage
              </h3>
              <div className="flex items-start gap-2 rounded-md border border-border/40 bg-muted/10 px-3 py-2 text-sm">
                <Badge tone={stage.tone} className="shrink-0">
                  {stage.label}
                </Badge>
                <p className="text-[12px] leading-snug text-muted-foreground">
                  {stage.hint}
                </p>
              </div>
            </section>
          )}

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Bookings
            </h3>
            {mo.bookings_total === 0 ? (
              <p className="rounded-md border border-dashed border-border/40 px-3 py-2 text-sm text-muted-foreground">
                No bookings yet — the parts list hasn&apos;t been materialised.
              </p>
            ) : (
              <div className="rounded-md border border-border/40 bg-muted/10 p-3 text-sm">
                <p>
                  <span className="font-mono font-medium">
                    {mo.bookings_total - mo.placeholder_count}
                  </span>{" "}
                  / {mo.bookings_total} real ·{" "}
                  <span className="font-mono font-medium">
                    {mo.placeholder_count}
                  </span>{" "}
                  placeholder
                  {mo.placeholder_count === 1 ? "" : "s"}
                </p>
                {mo.broken_booking_count > 0 && (
                  <p className="mt-1 text-xs text-destructive">
                    {mo.broken_booking_count} booking
                    {mo.broken_booking_count === 1 ? "" : "s"} broken — re-plan needed.
                  </p>
                )}
              </div>
            )}
          </section>

          {mo.output_lots.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Output lots
              </h3>
              <ul className="space-y-1.5">
                {mo.output_lots.map((lot) => (
                  <li
                    key={lot.uuid}
                    className="flex items-center justify-between gap-3 rounded-md border border-border/40 bg-muted/10 px-3 py-1.5 text-xs"
                  >
                    <Link
                      href={`/stock/lots/${lot.uuid}`}
                      className="font-mono text-brand underline-offset-2 hover:underline"
                    >
                      {lot.uuid.slice(0, 8)}
                    </Link>
                    <span className="font-mono">
                      {formatCompanyNumber(lot.qty, prefs)}
                    </span>
                    <Badge tone={lot.at_production_feed ? "amber" : "emerald"}>
                      {lot.at_production_feed ? "At feed" : lot.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* The modal is a peek — no inline signing or action buttons.
            The MO page is where the planner sees BOM + bookings +
            routing and decides. Send-to-device shortcuts (preflight,
            run, closeout) stay because they're physical-floor entry
            points, not state-changing signatures. */}
        <DialogFooter className="flex flex-wrap items-center gap-2 sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {stage?.key === "awaiting_pickup" && permissions.canPick && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  onSendToDevice({
                    label: "Send pickup to device",
                    kind: "send_to_device",
                    href: `/m/pickup/${mo.uuid}`,
                    mo_uuid: mo.uuid,
                  })
                }
              >
                <Smartphone className="mr-1 size-3" />
                Pickup on device
              </Button>
            )}
            {stage?.key === "picking" && permissions.canPick && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  onSendToDevice({
                    label: "Open pickup on device",
                    kind: "send_to_device",
                    href: `/m/pickup/${mo.uuid}`,
                    mo_uuid: mo.uuid,
                  })
                }
              >
                <Smartphone className="mr-1 size-3" />
                Open pickup on device
              </Button>
            )}
            {stage?.key === "awaiting_preflight" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  onSendToDevice({
                    label: "Send preflight to device",
                    kind: "send_to_device",
                    href: `/m/preflight/${mo.uuid}`,
                    mo_uuid: mo.uuid,
                  })
                }
              >
                <Smartphone className="mr-1 size-3" />
                Preflight on device
              </Button>
            )}
            {stage?.key === "ready_to_run" && (
              <Button asChild size="sm" variant="outline">
                <Link href={`/production/runs/${mo.uuid}`}>
                  <ExternalLink className="mr-1 size-3" />
                  Open run
                </Link>
              </Button>
            )}
            {stage?.key === "running" && (
              <Button asChild size="sm" variant="outline">
                <Link href={`/production/runs/${mo.uuid}`}>
                  <ExternalLink className="mr-1 size-3" />
                  Open run
                </Link>
              </Button>
            )}
            {stage?.key === "awaiting_output_qc" && (
              <Button asChild size="sm" variant="outline">
                <Link href="/production/output-qc">
                  <ExternalLink className="mr-1 size-3" />
                  Open output QC
                </Link>
              </Button>
            )}
            {stage?.key === "awaiting_warehouse_return" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  onSendToDevice({
                    label: "Send return-pickup to device",
                    kind: "send_to_device",
                    href: `/m/return-pickup`,
                    mo_uuid: mo.uuid,
                  })
                }
              >
                <Smartphone className="mr-1 size-3" />
                Return pickup on device
              </Button>
            )}
            {stage?.key === "awaiting_closeout" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  onSendToDevice({
                    label: "Send closeout to device",
                    kind: "send_to_device",
                    href: `/m/closeout/${mo.uuid}`,
                    mo_uuid: mo.uuid,
                  })
                }
              >
                <Smartphone className="mr-1 size-3" />
                Closeout on device
              </Button>
            )}
          </div>

          <Button asChild size="sm">
            <Link href={`/production/manufacturing-orders/${mo.uuid}`}>
              Open MO page
              <ExternalLink className="ml-1 size-3" />
            </Link>
          </Button>
        </DialogFooter>

        {/* coUuid passed in so a future "view CO line" link from the
            modal can reference back without an extra prop. Read-only,
            so we just void the dep here to silence eslint. */}
        <span hidden data-co={coUuid} />
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// PO modal
// =============================================================================

function PoModal({
  po,
  prefs,
  onClose,
}: {
  po: OrderWizardOpenPo | null;
  prefs: CompanyDefaults;
  onClose: () => void;
}) {
  const open = !!po;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        {po && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 font-mono">
                <ShoppingBag className="size-4 text-muted-foreground" />
                {po.code ?? `PO #${po.id}`}
              </DialogTitle>
              <DialogDescription>
                {po.vendor_name ?? "Vendor"}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 text-sm">
              <Row label="Status">
                <Badge tone="sky">{po.status}</Badge>
              </Row>
              <Row label="Expected delivery">
                {formatCompanyDate(po.expected_delivery_date, prefs)}
              </Row>
              <Row label="Total">
                <span className="font-mono">
                  {formatCompanyMoney(po.grand_total, prefs, {
                    currency_code: po.currency_code,
                  })}
                </span>
              </Row>
            </div>
            <DialogFooter>
              <Button asChild>
                <Link href={`/procurement/purchase-orders/${po.uuid}`}>
                  Open full PO
                  <ExternalLink className="ml-1.5 size-3.5" />
                </Link>
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/40 py-1.5 last:border-0">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span>{children}</span>
    </div>
  );
}

// =============================================================================
// Customer modal
// =============================================================================

function CustomerModal({
  co,
  open,
  onClose,
}: {
  co: CustomerOrder;
  open: boolean;
  onClose: () => void;
}) {
  const c = co.customer;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserIcon className="size-4 text-muted-foreground" />
            {c?.name ?? "—"}
          </DialogTitle>
          <DialogDescription>
            <span className="font-mono">{c?.code ?? "—"}</span>
          </DialogDescription>
        </DialogHeader>
        {c ? (
          <div className="space-y-2 text-sm">
            <Row label="Currency">{c.currency_code}</Row>
            <Row label="Payment terms">
              {c.payment_terms_days}d {c.payment_terms_basis}
            </Row>
            <Row label="Approval">
              <Badge
                tone={
                  c.effective_approval_status === "approved"
                    ? "emerald"
                    : c.effective_approval_status === "suspended"
                      ? "destructive"
                      : "amber"
                }
              >
                {c.effective_approval_status}
              </Badge>
            </Row>
            {c.trade_credit_limit && (
              <Row label="Trade credit limit">{c.trade_credit_limit}</Row>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No customer attached to this order.
          </p>
        )}
        <DialogFooter>
          {c && (
            <Button asChild>
              <Link href={`/sales/customers/${c.uuid}`}>
                Open customer page
                <ExternalLink className="ml-1.5 size-3.5" />
              </Link>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// BOM picker modal
// =============================================================================

function BomPickerModal({
  line,
  coUuid,
  onClose,
  onPicked,
}: {
  line: OrderWizardLine | null;
  coUuid: string;
  onClose: () => void;
  onPicked: () => void;
}) {
  const router = useRouter();
  const [pickingId, setPickingId] = useState<number | null>(null);

  const open = !!line;
  if (!line) {
    return (
      <Dialog open={open} onOpenChange={(o) => !o && onClose()} />
    );
  }

  async function pick(bom: OrderWizardAvailableBom) {
    setPickingId(bom.id);
    const res = await createMoForLineAction(coUuid, line!.uuid, bom.id);
    setPickingId(null);
    if (res.ok) {
      toast.success("Manufacturing order created");
      onPicked();
      router.push(
        `/production/manufacturing-orders/${res.manufacturing_order.uuid}`,
      );
    } else {
      toast.error(res.detail);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Pick a BOM</DialogTitle>
          <DialogDescription>
            This item has multiple published BOMs. Choose the one to use
            for this manufacturing order.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2">
          {line.available_boms.map((bom) => (
            <li
              key={bom.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border/40 bg-muted/10 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {bom.name}
                  {bom.is_primary && (
                    <Badge tone="sky" className="ml-2">
                      Primary
                    </Badge>
                  )}
                </p>
                {bom.code && (
                  <p className="text-[10px] font-mono text-muted-foreground">
                    {bom.code}
                  </p>
                )}
              </div>
              <Button
                size="sm"
                onClick={() => void pick(bom)}
                disabled={pickingId !== null}
              >
                {pickingId === bom.id ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <PackagePlus className="mr-1.5 size-3.5" />
                )}
                Use this BOM
              </Button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// Send-to-device QR modal
// =============================================================================

// A phone counts as "online" when its socket touched `last_seen_at`
// within the channel-presence window. The mobile shell ticks every
// time the device socket opens, so 90 s is enough headroom for a
// phone with the screen briefly off but the page still open.
const DEVICE_ONLINE_WINDOW_MS = 90_000;

function deviceOnline(d: LinkedDevice): boolean {
  if (!d.last_seen_at) return false;
  const seen = Date.parse(d.last_seen_at);
  if (Number.isNaN(seen)) return false;
  return Date.now() - seen < DEVICE_ONLINE_WINDOW_MS;
}

function SendToDeviceModal({
  cta,
  onClose,
}: {
  cta: OrderWizardCta | null;
  onClose: () => void;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [devices, setDevices] = useState<LinkedDevice[] | null>(null);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [pushingUuid, setPushingUuid] = useState<string | null>(null);
  const [pushingAll, setPushingAll] = useState(false);

  const open = !!cta;
  const href = cta?.href ?? "";
  const url = useMemo(() => {
    if (!href) return "";
    if (typeof window === "undefined") return href;
    // Mobile flows expect an absolute URL with the dev/prod hostname so
    // a scanned QR can reach the same origin.
    return `${window.location.protocol}//${window.location.host}${href}`;
  }, [href]);

  useEffect(() => {
    if (!open || !url) {
      setDataUrl(null);
      return;
    }
    void QRCode.toDataURL(url, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 256,
    }).then(setDataUrl);
  }, [open, url]);

  useEffect(() => {
    if (!open) {
      setDevices(null);
      setPushingUuid(null);
      setPushingAll(false);
      return;
    }
    setDevicesLoading(true);
    void listMyDevicesAction().then((res) => {
      setDevicesLoading(false);
      if (res.ok) setDevices(res.devices);
      else setDevices([]);
    });
  }, [open]);

  function copy() {
    if (!url) return;
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  async function pushOne(device: LinkedDevice) {
    if (!href) return;
    setPushingUuid(device.uuid);
    const res = await pushNavigateToDeviceAction(device.uuid, href);
    setPushingUuid(null);
    if (res.ok) {
      toast.success(`Opened on ${device.label || "your device"}`);
      onClose();
    } else {
      toast.error(res.detail || "Couldn't push to that device.");
    }
  }

  async function pushAll() {
    if (!href) return;
    setPushingAll(true);
    const res = await pushNavigateToMyDevicesAction(href);
    setPushingAll(false);
    if (res.ok) {
      const count = res.pushed_to.length;
      if (count === 0) {
        toast.error(
          "No paired devices. Scan the QR with your phone instead.",
        );
        return;
      }
      const label =
        count === 1
          ? `Opened on ${res.pushed_to[0]?.label || "your device"}`
          : `Opened on ${count} devices`;
      toast.success(label);
      onClose();
    } else {
      toast.error(res.detail || "Couldn't push to your devices.");
    }
  }

  const onlineDevices = (devices ?? []).filter(deviceOnline);
  const offlineDevices = (devices ?? []).filter((d) => !deviceOnline(d));
  const hasPaired = (devices?.length ?? 0) > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="size-4 text-muted-foreground" />
            {cta?.label ?? "Send to device"}
          </DialogTitle>
          <DialogDescription>
            Push this page to a paired phone — it jumps there
            instantly. Or scan the QR with an unpaired device.
          </DialogDescription>
        </DialogHeader>

        {/* Paired-device list (one-tap push). */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <span>Your devices</span>
            {onlineDevices.length > 1 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[11px]"
                onClick={pushAll}
                disabled={pushingAll || !!pushingUuid}
              >
                {pushingAll ? (
                  <Loader2 className="mr-1 size-3 animate-spin" />
                ) : (
                  <ArrowRight className="mr-1 size-3" />
                )}
                Send to all {onlineDevices.length}
              </Button>
            )}
          </div>
          {devicesLoading ? (
            <Skeleton className="h-12 w-full rounded-md" />
          ) : hasPaired ? (
            <div className="space-y-1.5">
              {onlineDevices.map((d) => (
                <DeviceRow
                  key={d.uuid}
                  device={d}
                  online
                  busy={pushingUuid === d.uuid}
                  disabled={pushingAll || (!!pushingUuid && pushingUuid !== d.uuid)}
                  onPush={() => pushOne(d)}
                />
              ))}
              {offlineDevices.map((d) => (
                <DeviceRow
                  key={d.uuid}
                  device={d}
                  online={false}
                  busy={pushingUuid === d.uuid}
                  disabled={pushingAll || !!pushingUuid}
                  onPush={() => pushOne(d)}
                />
              ))}
            </div>
          ) : (
            <p className="rounded-md bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground">
              No paired devices yet. Pair a phone from{" "}
              <Link
                href="/settings/devices"
                className="text-brand underline-offset-2 hover:underline"
              >
                Settings → Devices
              </Link>{" "}
              for one-tap handoff next time.
            </p>
          )}
        </div>

        {/* QR fallback for unpaired phones. */}
        <div className="space-y-2 border-t border-border/60 pt-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Or scan with another phone
          </div>
          <div className="flex flex-col items-center gap-3">
            {dataUrl ? (
              <img
                src={dataUrl}
                alt="QR code"
                className="size-44 rounded-md border border-border/40 bg-white p-2"
              />
            ) : (
              <Skeleton className="size-44 rounded-md" />
            )}
            <code className="w-full break-all rounded-md bg-muted/40 px-2 py-1.5 text-center text-[10px]">
              {url}
            </code>
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button size="sm" variant="outline" onClick={copy}>
            <Copy className="mr-1.5 size-3.5" />
            {copied ? "Copied" : "Copy link"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeviceRow({
  device,
  online,
  busy,
  disabled,
  onPush,
}: {
  device: LinkedDevice;
  online: boolean;
  busy: boolean;
  disabled: boolean;
  onPush: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "inline-block size-2 shrink-0 rounded-full",
            online ? "bg-emerald-500" : "bg-muted-foreground/40",
          )}
          aria-hidden
        />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium leading-tight">
            {device.label || "Unnamed device"}
          </div>
          <div className="truncate text-[10px] text-muted-foreground">
            {device.platform ?? "device"} ·{" "}
            {online ? "online" : "offline"}
          </div>
        </div>
      </div>
      <Button
        size="sm"
        variant={online ? "default" : "outline"}
        onClick={onPush}
        disabled={busy || disabled}
        className="h-8 shrink-0"
      >
        {busy ? (
          <Loader2 className="mr-1 size-3.5 animate-spin" />
        ) : (
          <ArrowRight className="mr-1 size-3.5" />
        )}
        Send
      </Button>
    </div>
  );
}

// =============================================================================
// Empty / loading skeleton
// =============================================================================

function BoardSkeleton({ co }: { co: CustomerOrder }) {
  return (
    <main className="flex-1 bg-muted/20">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/95">
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-8 sm:py-4">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
              <Link href="/projects">
                <ChevronLeft className="mr-1 size-4" />
                Projects
              </Link>
            </Button>
            <Skeleton className="h-6 w-40" />
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-8 sm:py-8">
        <Card className="border-border/60">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Couldn&apos;t load the project. Refresh, or open the customer
            order directly:{" "}
            <Link
              href={`/sales/orders/${co.uuid}`}
              className="text-brand underline-offset-2 hover:underline"
            >
              {co.code ?? `CO #${co.id}`}
            </Link>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

// =============================================================================
// Helpers — phase tone + action dispatcher
// =============================================================================

function phaseBadgeTone(
  key: OrderWizardPhaseKey,
): "muted" | "sky" | "amber" | "emerald" | "destructive" {
  switch (key) {
    case "setup":
      return "muted";
    case "approval":
      return "sky";
    case "production_planning":
      return "sky";
    case "awaiting_ingredients":
    case "in_production":
    case "closeout":
      return "amber";
    case "ready_to_dispatch":
      return "emerald";
    case "cancelled":
      return "destructive";
  }
}

interface CtaDispatchContext {
  coUuid: string;
  router: ReturnType<typeof useRouter>;
  setBomPickerLine: (line: OrderWizardLine | null) => void;
  setQrModalCta: (cta: OrderWizardCta | null) => void;
  scrollToPhase: (key: OrderWizardPhaseKey) => void;
  lines: OrderWizardLine[];
  refresh: () => Promise<void>;
}

/**
 * Central dispatcher for every wizard CTA kind. Kept outside the
 * component so render churn doesn't recreate a fat callback every
 * frame — the context bag carries the only thing each branch needs.
 */
function handleCta(cta: OrderWizardCta, ctx: CtaDispatchContext) {
  if (cta.kind === "scroll_to" && cta.target) {
    const el = document.querySelector(cta.target);
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    return;
  }

  if (cta.kind === "link" && cta.href) {
    if (cta.href.startsWith("/m/")) {
      window.open(cta.href, "_blank", "noopener,noreferrer");
    } else if (cta.href.startsWith("http")) {
      window.open(cta.href, "_blank", "noopener,noreferrer");
    } else {
      ctx.router.push(cta.href);
    }
    return;
  }

  if (cta.kind === "send_to_device") {
    ctx.setQrModalCta(cta);
    return;
  }

  // kind === "action"
  void runAction(cta, ctx);
}

async function runAction(cta: OrderWizardCta, ctx: CtaDispatchContext) {
  switch (cta.action) {
    case "submit": {
      const res = await submitCOAction(ctx.coUuid);
      surfaceResult(res, "Submitted for approval", ctx.refresh);
      return;
    }
    case "sign_approver": {
      const res = await signApproverCOAction(ctx.coUuid, "");
      surfaceResult(res, "Signed as approver", ctx.refresh);
      return;
    }
    case "sign_director": {
      const res = await signDirectorCOAction(ctx.coUuid, "");
      surfaceResult(res, "Signed as director", ctx.refresh);
      return;
    }
    case "confirm": {
      const res = await markConfirmedCOAction(ctx.coUuid);
      surfaceResult(res, "Order confirmed", ctx.refresh);
      return;
    }
    case "create_mo_for_line": {
      if (!cta.line_uuid) return;
      const line = ctx.lines.find((l) => l.uuid === cta.line_uuid);
      // If the BE has surfaced a CTA for a specific line and BOM,
      // honour it. Otherwise: surface the picker when ambiguous.
      if (cta.bom_id) {
        await runCreateMo(
          ctx.coUuid,
          cta.line_uuid,
          cta.bom_id,
          ctx.refresh,
        );
        return;
      }
      if (line && line.available_boms.length > 1) {
        ctx.setBomPickerLine(line);
        return;
      }
      await runCreateMo(
        ctx.coUuid,
        cta.line_uuid,
        undefined,
        ctx.refresh,
      );
      return;
    }
    case "request_purchases":
    case "prepare_mo":
    case "approve_mo": {
      if (!cta.mo_uuid) return;
      const action: MOActionString =
        cta.action === "prepare_mo"
          ? "prepare"
          : cta.action === "approve_mo"
            ? "approve"
            : "request_purchases";
      await runMoTransition(ctx.coUuid, cta.mo_uuid, action, ctx.refresh);
      return;
    }
    default:
      toast.error(`Unknown action: ${cta.action ?? "unspecified"}`);
  }
}

async function runCreateMo(
  coUuid: string,
  lineUuid: string,
  bomId: number | undefined,
  refresh: () => Promise<void>,
) {
  const res = await createMoForLineAction(coUuid, lineUuid, bomId);
  if (res.ok) {
    toast.success("Manufacturing order created");
    await refresh();
    // Don't router.push — keep them on the board. The new MO will
    // surface in the lines section automatically.
  } else {
    toast.error(res.detail);
  }
}

async function runMoTransition(
  coUuid: string,
  moUuid: string,
  action: MOActionString,
  refresh: () => Promise<void>,
) {
  const res = await transitionMOAction(coUuid, moUuid, action);
  if (res.ok) {
    toast.success(`MO ${action.replace(/_/g, " ")} — done`);
    await refresh();
  } else {
    toast.error(res.detail);
  }
}

function surfaceResult(
  res: { ok: true } | { ok: false; detail: string },
  successMsg: string,
  refresh: () => Promise<void>,
) {
  if (res.ok) {
    toast.success(successMsg);
    void refresh();
  } else {
    toast.error(res.detail);
  }
}
