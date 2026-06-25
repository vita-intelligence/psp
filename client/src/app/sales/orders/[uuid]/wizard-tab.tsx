"use client";

/**
 * Order wizard tab — single-page projection of a customer order's full
 * lifecycle. Renders five stacked blocks:
 *
 *   A. Phase strip  — 7-step horizontal stepper (or compact mobile)
 *   B. "Do this next" card — the most prominent CTA on the page
 *   C. Blockers list — only when there's something stopping motion
 *   D. Per-line table — one row per CO line with MO/booking/output state
 *   E. Timeline + open-PO side panel — chronological events on the left,
 *      PO chips on the right (stacked on mobile)
 *
 * The component is a client component so primary CTAs can do action
 * fetches inline and scroll_to CTAs can flip the tab + scroll without
 * a round-trip. State (current tab) is owned by the parent CoTabs.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertCircle,
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronRight,
  Cog,
  ExternalLink,
  Factory,
  FileText,
  Loader2,
  PackageOpen,
  PackagePlus,
  ShieldCheck,
  Truck,
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
import { cn } from "@/lib/utils";
import type {
  CompanyDefaults,
  OrderWizardBlocker,
  OrderWizardCta,
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
  markConfirmedCOAction,
  submitCOAction,
} from "@/lib/customer-orders/actions";
import { createMoForLineAction } from "@/lib/order-wizard/actions";
import {
  formatCompanyDate,
  formatCompanyMoney,
  formatCompanyNumber,
} from "@/lib/format/company";

// ---------------------------------------------------------------
// Phase-strip metadata
// ---------------------------------------------------------------

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

// ---------------------------------------------------------------
// MO status badge metadata — mirrors the MO detail page tones.
// ---------------------------------------------------------------

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

// ---------------------------------------------------------------
// Component
// ---------------------------------------------------------------

interface Props {
  wizard: OrderWizardSnapshot | null;
  prefs: CompanyDefaults;
  /** Switches the parent tab to "detail" and scrolls to the target. */
  onSwitchToDetail: (target?: string) => void;
}

export function WizardTab({ wizard, prefs, onSwitchToDetail }: Props) {
  if (!wizard) {
    return (
      <Card className="border-border/60">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          The wizard couldn&rsquo;t load. Switch to the Detail tab or refresh
          the page.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <PhaseStrip phase={wizard.phase} />
      <NextActionCard
        wizard={wizard}
        onSwitchToDetail={onSwitchToDetail}
      />
      {wizard.blockers.length > 0 && (
        <BlockersCard blockers={wizard.blockers} />
      )}
      <LinesCard wizard={wizard} prefs={prefs} />
      <TimelineAndPosBlock
        timeline={wizard.timeline}
        openPos={wizard.open_pos}
        prefs={prefs}
      />
    </div>
  );
}

// ===============================================================
// Block A — Phase strip
// ===============================================================

function PhaseStrip({ phase }: { phase: OrderWizardPhase }) {
  if (phase.key === "cancelled") {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="flex items-center gap-3 py-4 text-sm">
          <Ban className="size-5 text-destructive" />
          <span className="font-medium text-destructive">
            Cancelled — this order is terminal.
          </span>
        </CardContent>
      </Card>
    );
  }

  const total = phase.total > 0 ? phase.total : PHASE_ORDER.length;
  const currentIndex = phase.index;
  const progressPct = Math.min(
    100,
    Math.max(0, ((currentIndex + 1) / total) * 100),
  );

  return (
    <>
      {/* Desktop — horizontal stepper */}
      <Card className="hidden border-border/60 sm:block">
        <CardContent className="px-4 py-4">
          <ol className="flex items-center gap-1">
            {PHASE_ORDER.map((key, idx) => {
              const Icon = PHASE_ICON[key];
              const isDone = idx < currentIndex;
              const isActive = idx === currentIndex;
              const isFuture = idx > currentIndex;

              return (
                <li
                  key={key}
                  className="flex flex-1 items-center gap-1"
                  aria-current={isActive ? "step" : undefined}
                >
                  <div
                    className={cn(
                      "flex flex-1 items-center gap-2 rounded-md border px-2.5 py-1.5",
                      isActive &&
                        "border-brand/60 bg-brand/10 text-brand-foreground",
                      isDone &&
                        "border-emerald-300/60 bg-emerald-50 text-emerald-800 dark:border-emerald-700/60 dark:bg-emerald-950/30 dark:text-emerald-300",
                      isFuture &&
                        "border-border/40 bg-muted/30 text-muted-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                        isActive && "bg-brand text-white",
                        isDone && "bg-emerald-600 text-white",
                        isFuture && "bg-muted text-muted-foreground",
                      )}
                    >
                      {isDone ? (
                        <CheckCircle2 className="size-3.5" />
                      ) : (
                        <Icon className="size-3" />
                      )}
                    </span>
                    <span className="truncate text-xs font-medium">
                      {PHASE_LABEL[key]}
                    </span>
                  </div>
                  {idx < PHASE_ORDER.length - 1 && (
                    <ChevronRight className="size-3 shrink-0 text-muted-foreground/50" />
                  )}
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>

      {/* Mobile — compact summary + progress bar */}
      <Card className="border-border/60 sm:hidden">
        <CardContent className="space-y-2 px-4 py-4">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">
              Phase {Math.min(currentIndex + 1, total)} of {total}
            </span>
            <span className="text-muted-foreground">{phase.label}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-brand transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </CardContent>
      </Card>
    </>
  );
}

// ===============================================================
// Block B — Next-action card
// ===============================================================

function NextActionCard({
  wizard,
  onSwitchToDetail,
}: {
  wizard: OrderWizardSnapshot;
  onSwitchToDetail: (target?: string) => void;
}) {
  const next = wizard.next_action;
  if (!next) {
    return (
      <Card className="border-emerald-300/60 bg-emerald-50/40 dark:border-emerald-700/40 dark:bg-emerald-950/20">
        <CardContent className="flex items-center gap-3 py-6">
          <CheckCircle2 className="size-6 shrink-0 text-emerald-600" />
          <div>
            <p className="text-base font-semibold">Nothing to do right now.</p>
            <p className="text-sm text-muted-foreground">
              The order is moving on its own — sit back and watch the timeline.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-brand/40 bg-brand/5 shadow-md">
      <CardHeader className="pb-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-brand">
          Do this next
        </p>
        <CardTitle className="text-xl">{next.title}</CardTitle>
        {next.detail && (
          <CardDescription className="text-sm">{next.detail}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {next.primary_cta && (
          <CtaButton
            cta={next.primary_cta}
            coUuid={wizard.customer_order.uuid}
            onSwitchToDetail={onSwitchToDetail}
            size="lg"
            variant="default"
          />
        )}

        {next.secondary_ctas.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {next.secondary_ctas.map((cta, idx) => (
              <CtaButton
                key={`${cta.label}-${idx}`}
                cta={cta}
                coUuid={wizard.customer_order.uuid}
                onSwitchToDetail={onSwitchToDetail}
                size="sm"
                variant="outline"
              />
            ))}
          </div>
        )}

        {(next.shortages_link || next.scheduler_link) && (
          <div className="flex flex-wrap gap-3 pt-1 text-xs">
            {next.shortages_link && (
              <Link
                href={next.shortages_link.href}
                className="inline-flex items-center gap-1 text-brand underline-offset-2 hover:underline"
              >
                <ExternalLink className="size-3" />
                {next.shortages_link.label}
              </Link>
            )}
            {next.scheduler_link && (
              <Link
                href={next.scheduler_link.href}
                className="inline-flex items-center gap-1 text-brand underline-offset-2 hover:underline"
              >
                <ExternalLink className="size-3" />
                {next.scheduler_link.label}
              </Link>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CtaButton({
  cta,
  coUuid,
  onSwitchToDetail,
  size,
  variant,
}: {
  cta: OrderWizardCta;
  coUuid: string;
  onSwitchToDetail: (target?: string) => void;
  size: "lg" | "sm";
  variant: "default" | "outline";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleAction() {
    if (cta.kind === "scroll_to") {
      onSwitchToDetail(cta.target);
      return;
    }

    if (cta.kind === "link") {
      // External-style targets (mobile pages) open in a new tab so the
      // operator can keep the wizard up for context.
      return;
    }

    // kind === "action"
    startTransition(async () => {
      if (cta.action === "submit") {
        const res = await submitCOAction(coUuid);
        if (res.ok) {
          toast.success("Submitted for approval");
          router.refresh();
        } else {
          toast.error(res.detail);
        }
        return;
      }

      if (cta.action === "confirm") {
        const res = await markConfirmedCOAction(coUuid);
        if (res.ok) {
          toast.success("Order confirmed");
          router.refresh();
        } else {
          toast.error(res.detail);
        }
        return;
      }

      if (cta.action === "create_mo_for_line" && cta.line_uuid) {
        const res = await createMoForLineAction(coUuid, cta.line_uuid);
        if (res.ok) {
          toast.success("Manufacturing order created");
          router.push(
            `/production/manufacturing-orders/${res.manufacturing_order.uuid}`,
          );
        } else {
          toast.error(res.detail);
        }
        return;
      }

      // Unknown action — surface gracefully rather than silently no-op.
      toast.error(`Unknown action: ${cta.action ?? "unspecified"}`);
    });
  }

  if (cta.kind === "link" && cta.href) {
    const openExternal = cta.href.startsWith("/m/");
    return (
      <Button asChild size={size} variant={variant}>
        <Link
          href={cta.href}
          target={openExternal ? "_blank" : undefined}
          rel={openExternal ? "noopener noreferrer" : undefined}
        >
          {cta.label}
          {openExternal && <ExternalLink className="ml-1.5 size-3.5" />}
        </Link>
      </Button>
    );
  }

  return (
    <Button
      size={size}
      variant={variant}
      onClick={handleAction}
      disabled={pending}
    >
      {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
      {cta.label}
    </Button>
  );
}

// ===============================================================
// Block C — Blockers list
// ===============================================================

function BlockersCard({ blockers }: { blockers: OrderWizardBlocker[] }) {
  const count = blockers.length;
  return (
    <Card className="border-destructive/40 bg-destructive/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base text-destructive">
          <AlertCircle className="size-4" />
          {count} issue{count === 1 ? "" : "s"} blocking forward motion
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

function BlockerRow({ blocker }: { blocker: OrderWizardBlocker }) {
  const Icon = blocker.severity === "error" ? AlertCircle : AlertTriangle;
  const iconClass =
    blocker.severity === "error" ? "text-destructive" : "text-amber-600";
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-md border border-border/40 bg-card px-3 py-2 text-sm">
      <Icon className={cn("mt-0.5 size-4 shrink-0", iconClass)} />
      <p className="flex-1 leading-snug">{blocker.message}</p>
      {blocker.link && (
        <Button asChild size="sm" variant="outline">
          <Link href={blocker.link.href}>{blocker.link.label}</Link>
        </Button>
      )}
    </div>
  );
}

// ===============================================================
// Block D — Per-line table
// ===============================================================

function LinesCard({
  wizard,
  prefs,
}: {
  wizard: OrderWizardSnapshot;
  prefs: CompanyDefaults;
}) {
  const { lines, customer_order } = wizard;
  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Line items</CardTitle>
        <CardDescription>
          Production state per line — manufacturing orders, bookings, and
          finished output.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {lines.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-muted-foreground">
            No lines on this order yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-border/60 bg-muted/30 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 text-left font-medium">Line</th>
                  <th className="px-4 py-2 text-right font-medium">Qty</th>
                  <th className="px-4 py-2 text-left font-medium">MO</th>
                  <th className="px-4 py-2 text-left font-medium">Bookings</th>
                  <th className="px-4 py-2 text-left font-medium">Output</th>
                  <th className="px-4 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <LineRow
                    key={line.uuid}
                    line={line}
                    prefs={prefs}
                    coUuid={customer_order.uuid}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LineRow({
  line,
  prefs,
  coUuid,
}: {
  line: OrderWizardLine;
  prefs: CompanyDefaults;
  coUuid: string;
}) {
  const mo = line.primary_mo;
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function spawnMo() {
    startTransition(async () => {
      const res = await createMoForLineAction(coUuid, line.uuid);
      if (res.ok) {
        toast.success("Manufacturing order created");
        router.push(
          `/production/manufacturing-orders/${res.manufacturing_order.uuid}`,
        );
      } else {
        toast.error(res.detail);
      }
    });
  }

  return (
    <tr className="border-b border-border/40 last:border-0">
      <td className="px-4 py-3 align-top">
        <p className="font-medium">{line.item_name ?? `Line #${line.id}`}</p>
      </td>
      <td className="px-4 py-3 text-right align-top font-mono text-xs">
        {formatCompanyNumber(line.qty_ordered, prefs)}
      </td>
      <td className="px-4 py-3 align-top">
        {mo ? (
          <MoCell mo={mo} />
        ) : line.needs_mo ? (
          <span className="text-xs text-muted-foreground">Not created</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-3 align-top text-xs">
        <BookingsCell mo={mo} />
      </td>
      <td className="px-4 py-3 align-top text-xs">
        <OutputCell mo={mo} />
      </td>
      <td className="px-4 py-3 text-right align-top">
        {mo ? (
          <Button asChild size="sm" variant="outline">
            <Link href={`/production/manufacturing-orders/${mo.uuid}`}>
              Open MO
            </Link>
          </Button>
        ) : line.needs_mo ? (
          <Button size="sm" onClick={spawnMo} disabled={pending}>
            {pending ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            ) : (
              <PackagePlus className="mr-1.5 size-3.5" />
            )}
            Create MO
          </Button>
        ) : null}
      </td>
    </tr>
  );
}

function MoCell({ mo }: { mo: OrderWizardMo }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-xs">{mo.code ?? `#${mo.id}`}</span>
        <Badge tone={MO_STATUS_TONE[mo.status]}>
          {MO_STATUS_LABEL[mo.status]}
        </Badge>
      </div>
      {mo.broken_booking_count > 0 && (
        <p className="text-[10px] text-destructive">
          {mo.broken_booking_count} broken booking
          {mo.broken_booking_count === 1 ? "" : "s"}
        </p>
      )}
    </div>
  );
}

function BookingsCell({ mo }: { mo: OrderWizardMo | null }) {
  if (!mo) return <span className="text-muted-foreground">—</span>;
  const total = mo.bookings_total;
  if (total === 0) return <span className="text-muted-foreground">None</span>;

  const placeholders = mo.placeholder_count;
  const real = total - placeholders;

  if (placeholders === 0) {
    return (
      <span className="text-emerald-700 dark:text-emerald-400">
        {real}/{total} real
      </span>
    );
  }

  return (
    <span className="text-amber-700 dark:text-amber-400">
      {real}/{total} — {placeholders} placeholder
      {placeholders === 1 ? "" : "s"}
    </span>
  );
}

function OutputCell({ mo }: { mo: OrderWizardMo | null }) {
  if (!mo) return <span className="text-muted-foreground">—</span>;

  const made = mo.output_lot_count;
  if (made === 0) {
    return <span className="text-muted-foreground">Not made yet</span>;
  }

  const atFeed = mo.output_at_feed_count;
  const inWarehouse = mo.output_in_warehouse_count;

  if (atFeed > 0 && inWarehouse === 0) {
    return (
      <span className="text-amber-700 dark:text-amber-400">
        Made: {made} lot{made === 1 ? "" : "s"} at production feed
      </span>
    );
  }
  if (inWarehouse > 0 && atFeed === 0) {
    return (
      <span className="text-emerald-700 dark:text-emerald-400">
        Made + in warehouse ({inWarehouse} lot
        {inWarehouse === 1 ? "" : "s"})
      </span>
    );
  }
  return (
    <span className="text-emerald-700 dark:text-emerald-400">
      Made + in warehouse ({inWarehouse}); {atFeed} at feed
    </span>
  );
}

// ===============================================================
// Block E — Timeline + open POs side panel
// ===============================================================

function TimelineAndPosBlock({
  timeline,
  openPos,
  prefs,
}: {
  timeline: OrderWizardTimelineEntry[];
  openPos: OrderWizardOpenPo[];
  prefs: CompanyDefaults;
}) {
  const showPos = openPos.length > 0;
  return (
    <div
      className={cn(
        "grid gap-4",
        showPos ? "lg:grid-cols-[1fr_320px]" : "grid-cols-1",
      )}
    >
      <TimelineCard timeline={timeline} prefs={prefs} />
      {showPos && <OpenPosCard openPos={openPos} prefs={prefs} />}
    </div>
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
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Timeline</CardTitle>
        <CardDescription>
          Chronological events across the order and its manufacturing orders.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events yet.</p>
        ) : (
          <ol className="space-y-3">
            {timeline.map((entry, idx) => (
              <li
                key={`${entry.at}-${idx}`}
                className="flex gap-3 text-sm"
              >
                <div className="flex flex-col items-center">
                  <span className="mt-1 size-2 rounded-full bg-brand" />
                  {idx < timeline.length - 1 && (
                    <span className="my-1 flex-1 w-px bg-border" />
                  )}
                </div>
                <div className="flex-1 pb-1">
                  <p className="font-medium leading-snug">{entry.label}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatCompanyDate(entry.at, prefs)} ·{" "}
                    {entry.scope === "co" ? "Order" : "Manufacturing"}
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
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function OpenPosCard({
  openPos,
  prefs,
}: {
  openPos: OrderWizardOpenPo[];
  prefs: CompanyDefaults;
}) {
  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Open purchase orders</CardTitle>
        <CardDescription>
          Covering placeholder bookings for this order&rsquo;s MOs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {openPos.map((po) => (
          <Link
            key={po.uuid}
            href={`/procurement/purchase-orders/${po.uuid}`}
            className="flex items-center justify-between gap-3 rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-xs transition-colors hover:bg-muted/40"
          >
            <div className="min-w-0">
              <p className="truncate font-mono font-medium">
                PO #{po.id}
              </p>
              <p className="text-[10px] text-muted-foreground">
                ETA {formatCompanyDate(po.expected_delivery_date, prefs)} ·{" "}
                {po.status}
              </p>
            </div>
            <span className="font-mono text-[11px]">
              {formatCompanyMoney(po.grand_total, prefs, {
                currency_code: po.currency_code,
              })}
            </span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
