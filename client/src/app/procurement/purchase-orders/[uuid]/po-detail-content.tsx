"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ComponentProps } from "react";
import { ShoppingCart } from "lucide-react";
import { Badge } from "@/components/ui/badge-mini";
import { RecordHero } from "@/components/layout/record-hero";
import { PageCursorAnchor } from "@/components/realtime/page-cursor-anchor";
import { AuditMetaSection } from "@/components/audit/audit-meta-section";
import { AuditHistoryCard } from "@/components/audit/audit-history-card";
import { CommentThread } from "@/components/comments/comment-thread";
import type { PurchaseOrder, PurchaseOrderStatus } from "@/lib/types";
import { formatCompanyMoney } from "@/lib/format/company";
import { PODocumentsToolbar } from "./po-documents-toolbar";
import { POInspectionsCard } from "./po-inspections-card";
import { POInvoicesCard } from "./po-invoices-card";
import { POLinesCard } from "./po-lines-card";
import { POPaperworkAlert } from "./po-paperwork-alert";
import { POWorkflowCard } from "./po-workflow-card";

// Borrow the exact types the child cards declare so this shell stays
// a pass-through — no risk of drifting from the real server-fetch
// return types or from a child-component API change.
type ItemsProp = ComponentProps<typeof POLinesCard>["items"];
type InvoicesProp = ComponentProps<typeof POInvoicesCard>["invoices"];
type InspectionsProp = ComponentProps<typeof POInspectionsCard>["inspections"];
type PrefsProp = ComponentProps<typeof POInspectionsCard>["prefs"];
type CommentsProp = ComponentProps<typeof CommentThread>["initial"];

const STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: "Draft",
  pending_approver: "Pending approver",
  pending_director: "Pending authoriser",
  approved: "Approved",
  ordered: "Ordered",
  partially_received: "Partially received",
  received: "Received",
  cancelled: "Cancelled",
};

type Tone = ComponentProps<typeof Badge>["tone"];
const STATUS_TONE: Record<PurchaseOrderStatus, Tone> = {
  draft: "muted",
  pending_approver: "amber",
  pending_director: "amber",
  approved: "indigo",
  ordered: "indigo",
  partially_received: "amber",
  received: "emerald",
  cancelled: "destructive",
};

export interface PODetailContentProps {
  uuid: string;
  initialPo: PurchaseOrder;
  initialItems: ItemsProp;
  prefs: PrefsProp;
  initialComments: CommentsProp;
  initialInvoices: InvoicesProp;
  initialInspections: InspectionsProp;
  currentUserId: number;
  canCreate: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  canDirectorApprove: boolean;
  canInvoiceView: boolean;
  canInvoiceManage: boolean;
  canInvoiceApprove: boolean;
}

/**
 * Client wrapper that owns the per-page ``po`` state. Lives inside
 * the server component so every initial fetch stays on the server,
 * but once the page is interactive the workflow / lines cards can
 * push the fresh PO straight into state via ``onPoChange`` — the
 * status badge + buttons update in the same frame as the backend
 * write finishes, no ``router.refresh()`` round-trip required.
 *
 * ``router.refresh()`` is kept as a background sync for data the
 * server action doesn't return (audit history, invoices, inspections,
 * item list) so eventually-consistent cards still catch up. The
 * perceived latency on sign / submit / mark-ordered is now the raw
 * backend write time; the 6-parallel re-fetch wait that followed
 * ``router.refresh()`` happens off the critical path.
 */
export function PODetailContent({
  uuid,
  initialPo,
  initialItems,
  prefs,
  initialComments,
  initialInvoices,
  initialInspections,
  currentUserId,
  canCreate,
  canSubmit,
  canApprove,
  canDirectorApprove,
  canInvoiceView,
  canInvoiceManage,
  canInvoiceApprove,
}: PODetailContentProps) {
  const router = useRouter();
  const [po, setPo] = useState<PurchaseOrder>(initialPo);

  // Re-sync from the server component when ``router.refresh()`` lands
  // with a fresher snapshot (e.g. after a peer edits, or when a
  // mutation that didn't return a PO still triggered a refresh).
  // Comparing ``updated_at`` keeps our optimistic in-place updates
  // from being clobbered by a stale initial render.
  useEffect(() => {
    const incoming = initialPo.updated_at;
    const current = po.updated_at;
    if (incoming && current && incoming <= current) return;
    setPo(initialPo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPo]);

  const onPoChange = useCallback(
    (next: PurchaseOrder) => {
      setPo(next);
      // Fire a background refresh so audit history + any cards whose
      // data doesn't come back on the mutation response still catch
      // up. The user never waits for this — ``po`` has already been
      // swapped locally, so the hero / buttons are already correct.
      router.refresh();
    },
    [router],
  );

  return (
    <PageCursorAnchor
      pageId={`/procurement/purchase-orders/${uuid}`}
      className="mx-auto w-full space-y-6"
    >
      <RecordHero
        icon={ShoppingCart}
        code={po.code ?? `#${po.id}`}
        chips={
          <Badge tone={STATUS_TONE[po.status]}>{STATUS_LABEL[po.status]}</Badge>
        }
        title={
          po.vendor?.uuid ? (
            <Link
              href={`/procurement/vendors/${po.vendor.uuid}`}
              className="underline-offset-2 hover:underline"
            >
              {po.vendor.name}
            </Link>
          ) : (
            po.vendor?.name ?? "—"
          )
        }
        actions={
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Total
            </p>
            <p className="font-mono text-xl font-semibold tracking-tight">
              {formatCompanyMoney(po.total_amount, prefs, {
                currency_code: po.currency_code,
              })}
            </p>
          </div>
        }
        backHref="/procurement/purchase-orders"
        backLabel="Back to POs"
      />

      <POPaperworkAlert
        po={po}
        invoices={initialInvoices ?? []}
        prefs={prefs}
      />

      <POWorkflowCard
        po={po}
        canSubmit={canSubmit}
        canApprove={canApprove}
        canDirectorApprove={canDirectorApprove}
        canCancel={canCreate}
        pageId={`/procurement/purchase-orders/${uuid}`}
        onPoChange={onPoChange}
      />

      <PODocumentsToolbar po={po} />

      <POLinesCard
        po={po}
        items={initialItems ?? []}
        canEdit={canCreate && po.status === "draft"}
      />

      <POInspectionsCard
        inspections={initialInspections}
        prefs={prefs}
      />

      {canInvoiceView && (
        <POInvoicesCard
          po={po}
          companyCurrency={prefs?.currency_code ?? "GBP"}
          invoices={initialInvoices}
          canView={canInvoiceView}
          canManage={canInvoiceManage}
          canApprove={canInvoiceApprove}
        />
      )}

      <CommentThread
        entityType="purchase_order"
        entityUuid={po.uuid}
        initial={initialComments ?? []}
        canComment={canCreate}
        currentUserId={currentUserId}
      />

      <AuditMetaSection
        inserted_at={po.inserted_at}
        updated_at={po.updated_at}
        created_by={po.created_by ?? null}
        updated_by={po.updated_by ?? null}
      />
      <AuditHistoryCard entityType="purchase_order" entityId={po.id} />
    </PageCursorAnchor>
  );
}
