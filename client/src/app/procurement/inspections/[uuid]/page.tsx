import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import {
  ClipboardCheck,
  FileText,
  FileWarning,
  ImageIcon,
  Info,
  Microscope,
  PackageCheck,
  Paperclip,
  Printer,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Truck,
} from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge-mini";
import { getCompanyDefaults } from "@/lib/company/server";
import { formatCompanyDate } from "@/lib/format/company";
import { getInspection } from "@/lib/goods-in/server";
import { getPurchaseOrder } from "@/lib/purchase-orders/server";
import { INSPECTION_SECTIONS } from "@/lib/inspections/section-checks";
import type {
  Inspection,
  InspectionFile,
  InspectionItem,
  InspectionStatus,
  MaterialDecision,
  PackagingCondition,
  QualityDecision,
  SectionBag,
  SectionCheck,
} from "@/lib/goods-in/types";
import type { PurchaseOrder, PurchaseOrderLine } from "@/lib/types";
import { ProcurementSubnav } from "../../procurement-subnav";
import { SendToDeviceButton } from "@/components/realtime/send-to-device-button";

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

const PACKAGING_CONDITION_LABEL: Record<PackagingCondition, string> = {
  good: "Good",
  damaged: "Damaged",
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
          <PageHeader
            size="detail"
            icon={Microscope}
            // The numbering format isn't always configured, so fall back
            // to the integer id.
            title={`Inspection #${inspection.id}`}
            description={
              <span className="flex flex-wrap items-center gap-1.5">
                <Badge tone={STATUS_TONE[inspection.status]}>
                  {STATUS_LABEL[inspection.status]}
                </Badge>
                {inspection.quality_decision && (
                  <Badge tone={DECISION_TONE[inspection.quality_decision]}>
                    QC · {DECISION_LABEL[inspection.quality_decision]}
                  </Badge>
                )}
              </span>
            }
            backHref="/procurement/inspections"
            backLabel="All inspections"
          />

          <StatusActionBanner
            inspection={inspection}
            viewerId={user.id}
            viewerCanApprove={hasPermission(user, "goods_in.approve")}
            viewerCanInspect={hasPermission(user, "goods_in.inspect")}
          />

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

          <FilesCard inspection={inspection} prefs={prefs} />

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

/**
 * Tells the viewer what's actually possible / blocking on this page.
 * The desktop detail view is read-only — the operator + approver
 * sign-off panels live on /m/inspections — so a fresh visitor used to
 * arrive here, see no buttons, and assume something was broken (or in
 * the operator's case, that the segregation-of-duties rule was
 * silently blocking them). The banner spells it out and routes them
 * to the right place.
 */
function StatusActionBanner({
  inspection,
  viewerId,
  viewerCanApprove,
  viewerCanInspect,
}: {
  inspection: Inspection;
  viewerId: number;
  viewerCanApprove: boolean;
  viewerCanInspect: boolean;
}) {
  const status = inspection.status;
  if (status === "approved" || status === "hold" || status === "rejected") {
    // Terminal — nothing to act on. The Quality decision notes section
    // below already surfaces the verdict + reason.
    return null;
  }

  const wasOperator = inspection.goods_in_operator?.id === viewerId;
  const mobileHref = `/m/inspections/${inspection.uuid}`;

  if (status === "draft") {
    return (
      <Banner
        tone="muted"
        title="Inspection still in draft."
        body={
          viewerCanInspect
            ? "The goods-in operator hasn't signed off yet. Continue filling it in on your phone — once signed, it moves to QC review."
            : "The goods-in operator hasn't signed off yet. Once they sign, this row will appear under QC review for a user with goods_in.approve."
        }
        sendPath={viewerCanInspect ? mobileHref : null}
        sendLabel="Send to my phone"
      />
    );
  }

  // status === "submitted" — awaiting QC sign-off.
  if (viewerCanApprove && wasOperator) {
    return (
      <Banner
        tone="amber"
        title="Awaiting QC sign-off — you were the goods-in operator."
        body={
          "Best practice is for a different reviewer to approve, but your role lets you sign as quality approver too. Push this to your phone to record the decision."
        }
        sendPath={mobileHref}
        sendLabel="Send to my phone"
      />
    );
  }

  if (viewerCanApprove) {
    return (
      <Banner
        tone="indigo"
        title="Awaiting your QC sign-off."
        body="The goods-in operator has signed and the lots are sitting in quarantine. Push this to your phone to approve, put on hold, or reject."
        sendPath={mobileHref}
        sendLabel="Send to my phone"
      />
    );
  }

  return (
    <Banner
      tone="muted"
      title="Awaiting QC sign-off."
      body="Only a user with the goods_in.approve permission can sign this off. Ask the quality team to review."
      sendPath={null}
      sendLabel="Send to my phone"
    />
  );
}

function Banner({
  tone,
  title,
  body,
  sendPath,
  sendLabel,
}: {
  tone: "muted" | "amber" | "indigo";
  title: string;
  body: string;
  /** When set, renders a SendToDeviceButton that pushes this path to
   *  the user's paired phone. The desktop never opens /m/* directly —
   *  mobile flows always run on the mobile device they were designed
   *  for. */
  sendPath: string | null;
  sendLabel: string;
}) {
  const toneClasses = {
    muted: "border-border/60 bg-muted/40",
    amber:
      "border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-500/40",
    indigo:
      "border-indigo-500/40 bg-indigo-50 dark:bg-indigo-950/30 dark:border-indigo-500/40",
  }[tone];

  const Icon = tone === "indigo" ? Smartphone : Info;

  return (
    <section
      className={`flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between ${toneClasses}`}
    >
      <div className="flex gap-3">
        <Icon className="mt-0.5 size-5 shrink-0 text-foreground/70" />
        <div className="space-y-1">
          <p className="text-sm font-semibold leading-tight">{title}</p>
          <p className="text-sm text-muted-foreground">{body}</p>
        </div>
      </div>
      {sendPath && (
        <SendToDeviceButton
          path={sendPath}
          buttonLabel={sendLabel}
          title="Send inspection to your phone"
          description="Push this page to a paired phone — it jumps there instantly. Or scan the QR with an unpaired device."
          buttonProps={{
            size: "sm",
            className: "shrink-0 gap-2 self-start sm:self-auto",
          }}
        />
      )}
    </section>
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
          {purchaseOrder?.vendor?.uuid ? (
            <Link
              href={`/procurement/vendors/${purchaseOrder.vendor.uuid}`}
              className="hover:underline underline-offset-2"
            >
              {purchaseOrder.vendor.name}
            </Link>
          ) : (
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
              className="space-y-2 rounded-md border border-border/40 px-3 py-2.5"
            >
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1 space-y-0.5">
                  {line?.item?.uuid ? (
                    <Link
                      href={`/production/items/${line.item.uuid}`}
                      className="block truncate text-sm font-medium underline-offset-2 hover:underline"
                    >
                      {line.item.name}
                    </Link>
                  ) : (
                    <p className="truncate text-sm font-medium">
                      {line?.item?.name ?? "Unknown item"}
                    </p>
                  )}
                  {line?.vendor_part_no && (
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {line.vendor_part_no}
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    Received {item.qty_received}
                    {line?.qty_ordered ? ` of ${line.qty_ordered}` : ""}
                  </p>
                  {item.packaging_condition && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      <Badge
                        tone={
                          item.packaging_condition === "good"
                            ? "emerald"
                            : "amber"
                        }
                      >
                        Packaging:{" "}
                        {PACKAGING_CONDITION_LABEL[item.packaging_condition]}
                      </Badge>
                      {item.packaging_condition_notes && (
                        <span className="text-[11px] text-muted-foreground">
                          {item.packaging_condition_notes}
                        </span>
                      )}
                    </div>
                  )}
                  {item.material_decision_reason && (
                    <p className="pt-1 text-xs text-muted-foreground">
                      {item.material_decision_reason}
                    </p>
                  )}
                </div>
                <Badge tone={MATERIAL_DECISION_TONE[item.material_decision]}>
                  {MATERIAL_DECISION_LABEL[item.material_decision]}
                </Badge>
              </div>

              {item.packs && item.packs.length > 0 && line && (
                <PacksTable
                  inspectionUuid={inspection.uuid}
                  lineUuid={line.uuid}
                  packs={item.packs}
                  uomSymbol={
                    line.item?.stock_uom?.symbol ??
                    line.item?.stock_uom?.code ??
                    null
                  }
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Per-pack rollup with a direct print link. Operators sometimes miss
// the wizard's quarantine-label step on the dock tablet and need to
// re-print from their desk — this surfaces the same PDF endpoint the
// mobile bridge fires, just without the realtime hop (the laptop is
// already the print target).
function PacksTable({
  inspectionUuid,
  lineUuid,
  packs,
  uomSymbol,
}: {
  inspectionUuid: string;
  lineUuid: string;
  packs: NonNullable<InspectionItem["packs"]>;
  uomSymbol: string | null;
}) {
  return (
    <div className="rounded-md border border-border/30 bg-muted/20 px-2.5 py-2">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Packs · {packs.length}
        </p>
        <p className="text-[10px] text-muted-foreground">
          Quarantine label per pack
        </p>
      </div>
      <ul className="divide-y divide-border/30">
        {packs.map((pack, idx) => {
          const href =
            `/api/m/inspections/${encodeURIComponent(inspectionUuid)}` +
            `/quarantine-label.pdf?line_uuid=${encodeURIComponent(lineUuid)}` +
            `&pack_index=${idx}&copies=1`;
          return (
            <li
              key={idx}
              className="flex items-center justify-between gap-3 py-1.5 text-xs"
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="font-medium">
                  Pack {idx + 1} ·{" "}
                  <span className="font-mono">{String(pack.qty ?? "")}</span>
                  {uomSymbol ? ` ${uomSymbol}` : ""}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  <span className="font-mono">
                    {pack.package_length_mm}×{pack.package_width_mm}×
                    {pack.package_height_mm}
                  </span>{" "}
                  mm · {String(pack.package_weight_kg ?? "")} kg
                  {pack.units_per_package
                    ? ` · ${pack.units_per_package}/pack`
                    : ""}
                  {pack.supplier_batch_no
                    ? ` · Batch ${pack.supplier_batch_no}`
                    : ""}
                </p>
                {(pack.manufactured_at ||
                  pack.expiry_at ||
                  pack.country_of_origin ||
                  pack.revision) && (
                  <p className="text-[11px] text-muted-foreground">
                    {pack.manufactured_at ? (
                      <>
                        Mfd <span className="font-mono">{pack.manufactured_at}</span>
                      </>
                    ) : null}
                    {pack.expiry_at ? (
                      <>
                        {pack.manufactured_at ? " · " : ""}
                        Exp <span className="font-mono">{pack.expiry_at}</span>
                      </>
                    ) : null}
                    {pack.country_of_origin ? (
                      <>
                        {pack.manufactured_at || pack.expiry_at ? " · " : ""}
                        Origin{" "}
                        <span className="font-mono">{pack.country_of_origin}</span>
                      </>
                    ) : null}
                    {pack.revision ? (
                      <>
                        {pack.manufactured_at ||
                        pack.expiry_at ||
                        pack.country_of_origin
                          ? " · "
                          : ""}
                        Rev <span className="font-mono">{pack.revision}</span>
                      </>
                    ) : null}
                  </p>
                )}
              </div>
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background px-2 py-1 text-[11px] font-medium hover:bg-muted"
                title="Print quarantine label for this pack"
              >
                <Printer className="size-3" />
                Print
              </a>
            </li>
          );
        })}
      </ul>
    </div>
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
      <div className="grid gap-4 sm:grid-cols-2">
        <SignatureBlock
          label="Goods-in operator"
          actorName={inspection.goods_in_operator?.name ?? null}
          signedAtIso={inspection.goods_in_operator_signed_at}
          signedAtFormatted={formatCompanyDate(
            inspection.goods_in_operator_signed_at,
            prefs,
          )}
          image={inspection.goods_in_operator_signature_image}
        />
        <SignatureBlock
          label="Quality approver"
          actorName={inspection.quality_approver?.name ?? null}
          signedAtIso={inspection.quality_approver_signed_at}
          signedAtFormatted={formatCompanyDate(
            inspection.quality_approver_signed_at,
            prefs,
          )}
          image={inspection.quality_approver_signature_image}
        />
      </div>
    </section>
  );
}

function SignatureBlock({
  label,
  actorName,
  signedAtIso,
  signedAtFormatted,
  image,
}: {
  label: string;
  actorName: string | null;
  /** Raw signed-at — drives the "is this signed at all?" check.
   *  We can't read off `signedAtFormatted` because that string is
   *  always non-empty (formatter returns "—" for null). */
  signedAtIso: string | null;
  signedAtFormatted: string;
  image: string | null;
}) {
  const signed = Boolean(signedAtIso);

  return (
    <div className="space-y-1.5">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {image ? (
        <div className="overflow-hidden rounded-md border border-border/40 bg-background">
          {/* Base64 data URL — direct <img> is fine, no Next/Image
              optimisation needed (and would cost a route trip). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image}
            alt={`${label} signature`}
            className="block h-24 w-full object-contain bg-white p-2"
          />
        </div>
      ) : signed ? (
        // ESIGN'd but the bitmap wasn't captured (legacy row, or the
        // signature pad didn't flush). Make the signed state clear so
        // the auditor doesn't read this as "unsigned".
        <div className="flex items-center justify-center gap-2 rounded-md border border-border/40 bg-emerald-500/5 px-3 py-6 text-xs font-medium text-emerald-700 dark:text-emerald-300">
          <ShieldCheck className="size-4" />
          Signed — image not captured
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border/40 px-3 py-6 text-center text-xs text-muted-foreground">
          — not signed
        </div>
      )}
      <div className="flex justify-between text-xs">
        <span className="font-medium">
          {actorName ?? (
            <span className="text-muted-foreground/60">— not signed</span>
          )}
        </span>
        <span className="text-muted-foreground">{signedAtFormatted}</span>
      </div>
    </div>
  );
}

// Files attached to the inspection — photos of the truck, the lot,
// damaged packaging; uploaded CoAs; whatever the operator captured on
// the dock. Photos render inline; PDFs / other docs render as
// download links. URLs come from the BE serve proxy so the cookie /
// device token attaches transparently when the desktop user opens
// them in a new tab.
function FilesCard({
  inspection,
  prefs,
}: {
  inspection: Inspection;
  prefs: Awaited<ReturnType<typeof getCompanyDefaults>>;
}) {
  const files = inspection.files ?? [];
  const photos = files.filter((f) => f.kind === "photo");
  const others = files.filter((f) => f.kind !== "photo");

  return (
    <section className="rounded-lg border border-border/60 bg-card p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Paperclip className="size-4" />
        Photos &amp; attachments
        <span className="ml-1 text-xs text-muted-foreground/70">
          · {files.length}
        </span>
      </h2>

      {files.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No photos or attachments uploaded.
        </p>
      ) : (
        <div className="space-y-3">
          {photos.length > 0 && (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {photos.map((f) => (
                <li
                  key={f.uuid}
                  className="group overflow-hidden rounded-md border border-border/40 bg-muted/20"
                >
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={f.url}
                      alt={f.filename}
                      className="block aspect-square w-full object-cover transition-opacity group-hover:opacity-90"
                    />
                  </a>
                  <FileFooter file={f} prefs={prefs} />
                </li>
              ))}
            </ul>
          )}

          {others.length > 0 && (
            <ul className="space-y-1.5">
              {others.map((f) => (
                <li
                  key={f.uuid}
                  className="flex items-center gap-3 rounded-md border border-border/40 px-3 py-2 text-sm"
                >
                  <FileIcon file={f} />
                  <div className="min-w-0 flex-1">
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate font-medium hover:underline"
                    >
                      {f.filename}
                    </a>
                    <p className="text-[11px] text-muted-foreground">
                      {formatKind(f.kind)} ·{" "}
                      {formatFileSize(f.byte_size)} ·{" "}
                      {formatCompanyDate(f.uploaded_at, prefs)}
                      {f.uploaded_by?.name
                        ? ` · by ${f.uploaded_by.name}`
                        : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function FileFooter({
  file,
  prefs,
}: {
  file: InspectionFile;
  prefs: Awaited<ReturnType<typeof getCompanyDefaults>>;
}) {
  return (
    <div className="space-y-0.5 px-2 py-1.5 text-[10px] text-muted-foreground">
      <p className="truncate font-medium text-foreground/80" title={file.filename}>
        {file.filename}
      </p>
      <p>
        {formatFileSize(file.byte_size)} ·{" "}
        {formatCompanyDate(file.uploaded_at, prefs)}
      </p>
    </div>
  );
}

function FileIcon({ file }: { file: InspectionFile }) {
  if (file.mime.startsWith("image/")) {
    return <ImageIcon className="size-4 shrink-0 text-muted-foreground" />;
  }
  if (file.mime === "application/pdf" || file.kind === "coa") {
    return <FileText className="size-4 shrink-0 text-muted-foreground" />;
  }
  return <Paperclip className="size-4 shrink-0 text-muted-foreground" />;
}

function formatKind(kind: InspectionFile["kind"]): string {
  switch (kind) {
    case "photo":
      return "Photo";
    case "coa":
      return "CoA";
    default:
      return "Attachment";
  }
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
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
  if (entry.na) {
    return (
      <Badge tone="muted">
        N/A
      </Badge>
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
