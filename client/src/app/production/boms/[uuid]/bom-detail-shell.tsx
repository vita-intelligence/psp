"use client";

import { useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ListChecks, Pencil, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge-mini";
import { ErrorBanner } from "@/components/forms/error-banner";
import { CommentThread } from "@/components/comments/comment-thread";
import { PageCursors } from "@/components/realtime/page-cursors";
import { PageLockBanner } from "@/components/realtime/page-lock-banner";
import { usePageLeadership } from "@/components/realtime/page-lock-guard";
import { formatCompanyMoney, formatCompanyNumber } from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";
import { invalidateAudit } from "@/lib/audit/invalidator";
import { setBOMPrimaryAction } from "@/lib/production/actions";
import type { BOM, BOMLine } from "@/lib/production/types";
import type { Comment } from "@/lib/comments/types";
import type { ErrorDebug } from "@/lib/errors/types";
import { BOMEditor } from "../bom-editor";

interface Props {
  bom: BOM;
  canEdit: boolean;
  canDelete: boolean;
  canComment: boolean;
  currentUserId: number;
  initialComments: Comment[];
}

/**
 * BOM detail surface: read-only by default, Edit button flips into
 * the existing `BOMEditor`. Pulls Comments + Version history below
 * the parts table — the MRPEasy layout the reference screenshot
 * showed.
 *
 * Save / cancel inside the editor exits back to view mode. The
 * router refreshes after edits so the new version row, updated
 * lines, and any cost changes flow back through the server fetch.
 */
export function BOMDetailShell({
  bom,
  canEdit,
  canDelete,
  canComment,
  currentUserId,
  initialComments,
}: Props) {
  const router = useRouter();
  const prefs = useFormatPrefs();
  const pathname = usePathname() ?? "";
  const anchorRef = useRef<HTMLDivElement>(null);
  const { isLeader, leader } = usePageLeadership(pathname);
  const locked = !isLeader && !!leader;
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{
    detail: string;
    code?: string;
    debug?: ErrorDebug;
  } | null>(null);

  function onSetPrimary() {
    if (locked) return;
    if (!canEdit || pending || bom.is_primary) return;
    startTransition(async () => {
      const res = await setBOMPrimaryAction(bom.uuid);
      if (res.ok) {
        toast.success("Primary BOM updated");
        invalidateAudit("bom", bom.id);
        router.refresh();
      } else {
        setError({ detail: res.detail, code: res.code, debug: res.debug });
      }
    });
  }

  const printHref = `/api/production/boms/${encodeURIComponent(bom.uuid)}/print.pdf`;

  return (
    <div ref={anchorRef} className="relative space-y-6">
      <PageCursors pageId={pathname} anchorRef={anchorRef} />
      {locked && mode === "view" && <PageLockBanner leader={leader} />}
      {error && (
        <ErrorBanner
          detail={error.detail}
          code={error.code}
          debug={error.debug}
        />
      )}

      {mode === "view" ? (
        <ReadOnlyView
          bom={bom}
          canEdit={canEdit && !locked}
          pending={pending}
          onEdit={() => setMode("edit")}
          onSetPrimary={onSetPrimary}
          printHref={printHref}
          prefs={prefs}
        />
      ) : (
        <BOMEditor
          bom={bom}
          outputItem={bom.item}
          canEdit={canEdit}
          canDelete={canDelete}
        />
      )}

      <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
        <header className="mb-3 flex items-center gap-2">
          <ListChecks className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold tracking-tight">Discussion</h2>
        </header>
        <CommentThread
          entityType="bom"
          entityUuid={bom.uuid}
          initial={initialComments}
          canComment={canComment}
          currentUserId={currentUserId}
        />
      </section>
    </div>
  );
}

function ReadOnlyView({
  bom,
  canEdit,
  pending,
  onEdit,
  onSetPrimary,
  printHref,
  prefs,
}: {
  bom: BOM;
  canEdit: boolean;
  pending: boolean;
  onEdit: () => void;
  onSetPrimary: () => void;
  printHref: string;
  prefs: ReturnType<typeof useFormatPrefs>;
}) {
  // Sum of (qty × average_unit_cost) per line. Fixed-qty lines still
  // contribute (they're consumed once per batch, the operator sees
  // the absolute cost). Lines without a cost yet contribute zero —
  // those land in the column with a — so it's obvious which rows
  // are missing pricing.
  const lineCosts = bom.lines.map((l) => computeLineCost(l));
  const total = lineCosts.reduce<number>((acc, c) => acc + (c ?? 0), 0);

  return (
    <>
      <section className="space-y-4 rounded-lg border border-border/60 bg-card p-5 shadow-sm">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-0.5">
            <h2 className="text-sm font-semibold tracking-tight">Header</h2>
            {bom.item && (
              <p className="text-xs text-muted-foreground">
                Output:{" "}
                <span className="font-medium">{bom.item.name}</span>
                {bom.item.code && (
                  <span className="ml-1.5 font-mono text-[11px]">
                    ({bom.item.code})
                  </span>
                )}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {bom.is_primary && (
              <Badge tone="emerald">
                <Star className="size-2.5" />
                Primary
              </Badge>
            )}
            {!bom.is_active && <Badge tone="muted">Archived</Badge>}
          </div>
        </header>

        <div className="grid gap-3 sm:grid-cols-2 text-sm">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Name
            </p>
            <p className="font-medium">{bom.name}</p>
          </div>
          {bom.code && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Number
              </p>
              <p className="font-mono">{bom.code}</p>
            </div>
          )}
        </div>

        {bom.notes && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Notes
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm">{bom.notes}</p>
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-border/60 bg-card p-5 shadow-sm">
        <header className="flex items-start justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-tight">Parts</h2>
        </header>

        {bom.lines.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No parts on this BOM yet — click Edit to add some.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border/60">
            <table className="min-w-[820px] text-xs">
              <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="w-8 px-2 py-1.5 text-left">#</th>
                  <th className="px-2 py-1.5 text-left">Part</th>
                  <th className="px-2 py-1.5 text-left">Notes</th>
                  <th className="w-16 px-2 py-1.5 text-left">UoM</th>
                  <th className="w-24 px-2 py-1.5 text-right">Quantity</th>
                  <th
                    className="w-16 px-2 py-1.5 text-center"
                    title="Fixed = per-batch overhead, independent of output qty"
                  >
                    Fixed
                  </th>
                  <th
                    className="w-28 px-2 py-1.5 text-right"
                    title="Most recent unit cost × qty"
                  >
                    Average cost
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {bom.lines.map((line, idx) => {
                  const cost = lineCosts[idx];
                  return (
                    <tr key={line.id}>
                      <td className="px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
                        {idx + 1}
                      </td>
                      <td className="px-2 py-1.5">
                        <p className="text-sm">
                          {line.part?.name ?? `Item #${line.part_id}`}
                        </p>
                        {line.part?.code && (
                          <p className="font-mono text-[10px] text-muted-foreground">
                            {line.part.code}
                          </p>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-[11px] text-muted-foreground">
                        {line.notes ?? ""}
                      </td>
                      <td className="px-2 py-1.5 text-[11px] text-muted-foreground">
                        {line.unit_of_measurement?.symbol ??
                          line.part?.stock_uom?.symbol ??
                          "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        {formatCompanyNumber(line.qty, prefs)}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        {line.is_fixed ? (
                          <span className="text-[11px]">Yes</span>
                        ) : (
                          <span className="text-[11px] text-muted-foreground/50">
                            —
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        {cost != null
                          ? formatCompanyMoney(String(cost), prefs)
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-muted/30 font-semibold">
                  <td className="px-2 py-1.5" colSpan={6}>
                    Total
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">
                    {total > 0
                      ? formatCompanyMoney(String(total), prefs)
                      : "—"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="flex flex-wrap items-center justify-end gap-2">
        <Button asChild size="sm" variant="outline">
          <a href={printHref} target="_blank" rel="noopener noreferrer">
            Print BOM
          </a>
        </Button>
        {canEdit && !bom.is_primary && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onSetPrimary}
            disabled={pending}
          >
            <Star className="mr-1.5 size-3.5" />
            Make primary
          </Button>
        )}
        {canEdit && (
          <Button type="button" size="sm" onClick={onEdit} disabled={pending}>
            <Pencil className="mr-1.5 size-3.5" />
            Edit
          </Button>
        )}
      </footer>
    </>
  );
}

function computeLineCost(line: BOMLine): number | null {
  const cost = line.average_unit_cost;
  if (cost == null) return null;
  const qty = Number(line.qty);
  const unit = Number(cost);
  if (!Number.isFinite(qty) || !Number.isFinite(unit)) return null;
  return qty * unit;
}
