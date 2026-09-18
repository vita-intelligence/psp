import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, PackageMinus } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { Button } from "@/components/ui/button";
import { AuditHistoryCard } from "@/components/audit/audit-history-card";
import { CommentThread } from "@/components/comments/comment-thread";
import { listCommentsForEntity } from "@/lib/comments/server";
import { getStockWriteOff } from "@/lib/stock/server";
import { StockSubnav } from "../../stock-subnav";
import { WriteOffDetail } from "./write-off-detail";

export const metadata = { title: "Write-off · Stock · PSP" };
export const dynamic = "force-dynamic";

export default async function WriteOffDetailPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, "stock.view")) {
    redirect("/settings/profile");
  }

  const { uuid } = await params;
  const [wo, comments] = await Promise.all([
    getStockWriteOff(uuid),
    listCommentsForEntity("stock_write_off", uuid),
  ]);

  if (!wo) notFound();

  const canApprove = hasPermission(user, "stock.writeoff.approve");
  const canAuthorise = hasPermission(user, "stock.writeoff.authorise");
  const canRevert = hasPermission(user, "stock.writeoff.revert");
  const canFile = hasPermission(user, "stock.writeoff.file");
  const canComment =
    canApprove || canAuthorise || canRevert || canFile || !!user.is_admin;

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <StockSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto w-full space-y-6">
          <div>
            <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
              <Link href="/stock/write-offs">
                <ChevronLeft className="mr-1 size-4" /> Back to Write-offs
              </Link>
            </Button>
          </div>

          <PageHeader
            icon={PackageMinus}
            title={wo.code ?? `Write-off #${wo.id}`}
            description={
              <span className="text-xs">
                {wo.item?.name ?? "?"} — Lot{" "}
                {wo.stock_lot ? (
                  <Link
                    href={`/stock/lots/${wo.stock_lot.uuid}`}
                    className="font-mono underline-offset-4 hover:underline"
                  >
                    {wo.stock_lot.code ?? `#${wo.stock_lot.id}`}
                  </Link>
                ) : (
                  <span className="font-mono">—</span>
                )}
              </span>
            }
          />

          <WriteOffDetail
            writeOff={wo}
            currentUserId={user.id}
            canApprove={canApprove}
            canAuthorise={canAuthorise}
            canRevert={canRevert}
          />

          <AuditHistoryCard entityType="stock_write_off" entityId={wo.id} />

          <CommentThread
            entityType="stock_write_off"
            entityUuid={wo.uuid}
            initial={comments ?? []}
            canComment={canComment}
            currentUserId={user.id}
          />
        </div>
      </main>
    </div>
  );
}
