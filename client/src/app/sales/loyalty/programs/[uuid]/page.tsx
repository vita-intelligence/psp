import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, Gift } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { Badge } from "@/components/ui/badge-mini";
import { AuditMetaSection } from "@/components/audit/audit-meta-section";
import { AuditHistoryCard } from "@/components/audit/audit-history-card";
import { CommentThread } from "@/components/comments/comment-thread";
import { listCommentsForEntity } from "@/lib/comments/server";
import { getCompanyDefaults } from "@/lib/company/server";
import { getLoyaltyProgram } from "@/lib/loyalty/server";
import { EditModeToggle } from "@/components/forms/edit-mode-toggle";
import { SalesSubnav } from "../../../sales-subnav";
import { LoyaltyProgramForm } from "./loyalty-program-form";
import { LoyaltyTierEditorCard } from "./loyalty-tier-editor-card";
import { LoyaltyLifecycleCard } from "./loyalty-lifecycle-card";

export const metadata = { title: "Loyalty program · Sales · PSP" };

export default async function LoyaltyProgramDetailPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, "loyalty.view")) {
    redirect("/settings/profile");
  }

  const { uuid } = await params;
  const [program, company, initialComments] = await Promise.all([
    getLoyaltyProgram(uuid),
    getCompanyDefaults(),
    listCommentsForEntity("loyalty_program", uuid),
  ]);
  if (!program || !company) notFound();

  const canManage = hasPermission(user, "loyalty.programs_manage");

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <SalesSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-5xl space-y-6">
          <div>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
            >
              <Link href="/sales/loyalty">
                <ChevronLeft className="mr-1 size-4" />
                Back to loyalty
              </Link>
            </Button>
          </div>

          <header className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Gift className="size-4 text-muted-foreground" />
                  <span className="font-mono text-xs font-semibold text-muted-foreground">
                    {program.code ?? `#${program.id}`}
                  </span>
                  {program.is_default && <Badge tone="indigo">Default</Badge>}
                  <Badge tone={program.is_active ? "emerald" : "muted"}>
                    {program.is_active ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <h1 className="truncate text-2xl font-semibold tracking-tight">
                  {program.name}
                </h1>
                {program.description && (
                  <p className="text-sm text-muted-foreground">
                    {program.description}
                  </p>
                )}
              </div>
            </div>
          </header>

          <EditModeToggle canEdit={canManage}>
            <LoyaltyProgramForm program={program} canEdit={canManage} />
          </EditModeToggle>

          <LoyaltyTierEditorCard
            program={program}
            prefs={company}
            baseCurrency={company.currency_code}
            canEdit={canManage}
          />

          <LoyaltyLifecycleCard
            program={program}
            prefs={company}
            canManage={canManage}
          />

          <CommentThread
            entityType="loyalty_program"
            entityUuid={program.uuid}
            initial={initialComments ?? []}
            canComment={canManage}
            currentUserId={user.id}
          />

          <AuditMetaSection
            inserted_at={program.inserted_at}
            updated_at={program.updated_at}
            created_by={program.created_by ?? null}
            updated_by={program.updated_by ?? null}
          />
          <AuditHistoryCard
            entityType="loyalty_program"
            entityId={program.id}
          />
        </div>
      </main>
    </div>
  );
}
