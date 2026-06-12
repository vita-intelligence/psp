import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ClipboardCheck,
  FileWarning,
  Microscope,
  PackageCheck,
  ShieldAlert,
  ShieldCheck,
  Truck,
} from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { Badge } from "@/components/ui/badge-mini";
import { Button } from "@/components/ui/button";
import { getCompanyDefaults } from "@/lib/company/server";
import { formatCompanyDate } from "@/lib/format/company";
import { getInspection } from "@/lib/goods-in/server";
import { getPurchaseOrder } from "@/lib/purchase-orders/server";
import { INSPECTION_SECTIONS } from "@/lib/inspections/section-checks";
import type {
  Inspection,
  InspectionItem,
  InspectionStatus,
  MaterialDecision,
  QualityDecision,
  SectionBag,
  SectionCheck,
} from "@/lib/goods-in/types";
import type { PurchaseOrder, PurchaseOrderLine } from "@/lib/types";
import { ProcurementSubnav } from "../../procurement-subnav";

export const metadata = { title: "Inspection · Procurement · PSP" };

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ uuid: string }>;
}

const STATUS_LABEL: Record<InspectionStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  hold: "On hold",
  rejected: "Rejected",
};

const STATUS_TONE: Record<
  InspectionStatus,
  "muted" | "amber" | "emerald" | "destructive" | "indigo"
> = {
  draft: "muted",
  submitted: "indigo",
  approved: "emerald",
  hold: "amber",
  rejected: "destructive",
};

const DECISION_LABEL: Record<QualityDecision, string> = {
  approved: "Approved",
  hold: "On hold",
  rejected: "Rejected",
};

const DECISION_TONE: Record<
  QualityDecision,
  "emerald" | "amber" | "destructive"
> = {
  approved: "emerald",
  hold: "amber",
  rejected: "destructive",
};

const MATERIAL_DECISION_LABEL: Record<MaterialDecision, string> = {
  accept: "Accept",
  hold: "Hold",
  reject: "Reject",
};

const MATERIAL_DECISION_TONE: Record<
  MaterialDecision,
  "emerald" | "amber" | "destructive"
> = {
  accept: "emerald",
  hold: "amber",
  reject: "destructive",
};

/**
 * Read-only desktop view of a Goods-In Inspection. The mobile wizard
 * owns the editable surface; this page is for QC + procurement
 * staffers reviewing the record after the fact (audit, sharing the
 * verdict with the buyer, etc).
 *
 * Per PSP's collab rule, read-only detail pages don't run the realtime
 * channel — no editable controls, nothing to coordinate.
 */
export default async function ProcurementInspectionDetailPage({
  params,
}: Props) {
  const user = await requireUser();
  if (!hasPermission(user, "goods_in.view")) {
    redirect("/settings/profile");
  }

  const { uuid } = await params;
  const inspection = await getInspection(uuid);
  if (!inspection) notFound();

  const [purchaseOrder, prefs] = await Promise.all([
    inspection.purchase_order_uuid
      ? getPurchaseOrder(inspection.purchase_order_uuid)
      : Promise.resolve(null),
    getCompanyDefaults(),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProcurementSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-4xl space-y-6">
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link href="/procurement/inspections">
              <ArrowLeft className="mr-1 size-4" />
              All inspections
            </Link>
          </Button>

          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1.5">
              <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight sm:text-3xl">
                <Microscope className="size-6 text-brand" />
                {/* The numbering format isn't always configured, so fall back
                    to the integer id. */}
                Inspection #{inspection.id}
              </h1>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={STATUS_TONE[inspection.status]}>
                  {STATUS_LABEL[inspection.status]}
                </Badge>
                {inspection.quality_decision && (
                  <Badge tone={DECISION_TONE[inspection.quality_decision]}>
                    QC · {DECISION_LABEL[inspection.quality_decision]}
                  </Badge>
                )}
              </div>
            </div>
          </header>

          <SummaryCard
            inspection={inspection}
            purchaseOrder={purchaseOrder}
            prefs={prefs}
          />

          <LinesCard
            inspection={inspection}
            purchaseOrder={purchaseOrder}
          />

          <SignaturesCard inspection={inspection} prefs={prefs} />

          {INSPECTION_SECTIONS.map((section) => (
            <SectionCard
              key={section.key}
              title={section.title}
              checks={section.checks}
              bag={inspection[section.key]}
            />
          ))}

          {inspection.quality_decision_reason && (
            <section className="rounded-lg border border-border/60 bg-card p-4">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <ClipboardCheck className="size-4" />
                Quality decision notes
              </h2>
              <p className="whitespace-pre-wrap text-sm">
                {inspection.quality_decision_reason}
              </p>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

function SummaryCard({
  inspection,
  purchaseOrder,
  prefs,
}: {
  inspection: Inspection;
  purchaseOrder: PurchaseOrder | null;
  prefs: Awaited<ReturnType<typeof getCompanyDefaults>>;
}) {
  return (
    <section className="rounded-lg border border-border/60 bg-card p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Truck className="size-4" />
        Delivery
      </h2>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Field label="Purchase order">
          {purchaseOrder ? (
            <Link
              href={`/procurement/purchase-orders/${purchaseOrder.uuid}`}
              className="font-mono font-semibold text-foreground hover:underline"
            >
              {purchaseOrder.code ?? `#${purchaseOrder.id}`}
            </Link>
          ) : (
            <span className="text-muted-foreground/60">—</span>
          )}
        </Field>
        <Field label="Vendor">
          {purchaseOrder?.vendor?.name ?? (
            <span className="text-muted-foreground/60">—</span>
          )}
        </Field>
        <Field label="Delivery date">
          {formatCompanyDate(inspection.delivery_date, prefs)}
        </Field>
        <Field label="Delivery time">
          {inspection.delivery_time ?? (
            <span className="text-muted-foreground/60">—</span>
          )}
        </Field>
        <Field label="Transport company">
          {inspection.transport_company ?? (
            <span className="text-muted-foreground/60">—</span>
          )}
        </Field>
        <Field label="Vehicle registration">
          {inspection.vehicle_registration ?? (
            <span className="text-muted-foreground/60">—</span>
          )}
        </Field>
        <Field label="Seal number">
          {inspection.seal_number ?? (
            <span className="text-muted-foreground/60">—</span>
          )}
        </Field>
      </dl>
    </section>
  );
}

function LinesCard({
  inspection,
  purchaseOrder,
}: {
  inspection: Inspection;
  purchaseOrder: PurchaseOrder | null;
}) {
  const lineByUuid = new Map<string, PurchaseOrderLine>();
  for (const line of purchaseOrder?.lines ?? []) {
    lineByUuid.set(line.uuid, line);
  }

  const items: Array<{ item: InspectionItem; line: PurchaseOrderLine | null }> =
    inspection.items.map((it) => ({
      item: it,
      line: it.purchase_order_line_uuid
        ? lineByUuid.get(it.purchase_order_line_uuid) ?? null
        : null,
    }));

  return (
    <section className="rounded-lg border border-border/60 bg-card p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <PackageCheck className="size-4" />
        Per-line decisions
      </h2>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No per-line decisions recorded yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map(({ item, line }) => (
            <li
              key={item.uuid}
              className="flex flex-wrap items-start gap-3 rounded-md border border-border/40 px-3 py-2.5"
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="truncate text-sm font-medium">
                  {line?.item?.name ?? "Unknown item"}
                </p>
                {line?.vendor_part_no && (
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {line.vendor_part_no}
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Received {item.qty_received}
                  {line?.qty_ordered ? ` of ${line.qty_ordered}` : ""}
                </p>
                {item.material_decision_reason && (
                  <p className="pt-1 text-xs text-muted-foreground">
                    {item.material_decision_reason}
                  </p>
                )}
              </div>
              <Badge tone={MATERIAL_DECISION_TONE[item.material_decision]}>
                {MATERIAL_DECISION_LABEL[item.material_decision]}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SignaturesCard({
  inspection,
  prefs,
}: {
  inspection: Inspection;
  prefs: Awaited<ReturnType<typeof getCompanyDefaults>>;
}) {
  return (
    <section className="rounded-lg border border-border/60 bg-card p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <ShieldCheck className="size-4" />
        Signatures
      </h2>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Field label="Goods-in operator">
          {inspection.goods_in_operator?.name ?? (
            <span className="text-muted-foreground/60">— not signed</span>
          )}
        </Field>
        <Field label="Operator signed at">
          {formatCompanyDate(inspection.goods_in_operator_signed_at, prefs)}
        </Field>
        <Field label="Quality approver">
          {inspection.quality_approver?.name ?? (
            <span className="text-muted-foreground/60">— not signed</span>
          )}
        </Field>
        <Field label="Approver signed at">
          {formatCompanyDate(inspection.quality_approver_signed_at, prefs)}
        </Field>
      </dl>
    </section>
  );
}

function SectionCard({
  title,
  checks,
  bag,
}: {
  title: string;
  checks: { key: string; label: string }[];
  bag: SectionBag;
}) {
  const filled = checks.filter((c) => bag[c.key] !== undefined);
  const empty = filled.length === 0;

  return (
    <section className="rounded-lg border border-border/60 bg-card p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <ShieldAlert className="size-4" />
        {title}
      </h2>
      {empty ? (
        <p className="text-xs text-muted-foreground">
          No checks recorded in this section yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {checks.map((c) => {
            const entry = bag[c.key];
            return (
              <li
                key={c.key}
                className="flex items-start justify-between gap-3 rounded-md border border-border/40 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{c.label}</p>
                  {entry?.notes && (
                    <p className="pt-1 text-[11px] text-muted-foreground">
                      {entry.notes}
                    </p>
                  )}
                </div>
                <CheckBadge entry={entry} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function CheckBadge({ entry }: { entry: SectionCheck | undefined }) {
  if (!entry) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        — not recorded
      </span>
    );
  }
  if (entry.passed) {
    return (
      <Badge tone="emerald">
        <ShieldCheck className="size-2.5" />
        Pass
      </Badge>
    );
  }
  return (
    <Badge tone="destructive">
      <FileWarning className="size-2.5" />
      Issue
    </Badge>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm sm:text-right">{children}</dd>
    </>
  );
}
