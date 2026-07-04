import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge-mini";
import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  CalendarClock,
  ChevronLeft,
  ExternalLink,
} from "lucide-react";
import {
  listCertificatesExpiring,
  listReviewsDue,
} from "@/lib/queues/server";
import type {
  CertExpiringQueueRow,
  ReviewDueQueueRow,
} from "@/lib/types";

export const metadata = { title: "Queues · PSP" };

export default async function QueuesPage() {
  const user = await requireUser();
  if (!hasPermission(user, "items.view")) {
    redirect("/settings/profile");
  }

  const [reviews, certs] = await Promise.all([
    listReviewsDue(30),
    listCertificatesExpiring(30),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-6xl space-y-6">
          <PageHeader
            title="Queues"
            description="Things needing attention in the next 30 days. Already overdue entries surface first."
            backSlot={
              <div>
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                >
                  <Link href="/settings">
                    <ChevronLeft className="mr-1 size-4" />
                    Back to Settings
                  </Link>
                </Button>
              </div>
            }
          />

          <div className="grid gap-6 lg:grid-cols-2">
            <ReviewsDueCard rows={reviews?.items ?? []} />
            <CertsExpiringCard rows={certs?.items ?? []} />
          </div>
        </div>
      </main>
    </div>
  );
}

function ReviewsDueCard({ rows }: { rows: ReviewDueQueueRow[] }) {
  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="size-4 text-muted-foreground" />
          Compliance reviews due
        </CardTitle>
        <CardDescription>
          Raw materials whose review is coming up or already overdue.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
            Nothing due in the next 30 days.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((row) => (
              <li
                key={row.item.uuid}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/40 bg-background px-3 py-2.5 text-sm"
              >
                <Link
                  href={`/settings/items/${row.item.uuid}`}
                  className="min-w-0 flex-1 hover:underline"
                >
                  <span className="block truncate font-medium">
                    {row.item.name}
                  </span>
                  {row.item.external_sku && (
                    <span className="block truncate font-mono text-[10px] text-muted-foreground">
                      {row.item.external_sku}
                    </span>
                  )}
                </Link>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    Due {row.review_due_at}
                  </span>
                  <DueBadge
                    daysUntil={row.days_until_due}
                    isOverdue={row.is_overdue}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function CertsExpiringCard({ rows }: { rows: CertExpiringQueueRow[] }) {
  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertCircle className="size-4 text-muted-foreground" />
          Certificates expiring
        </CardTitle>
        <CardDescription>
          Item certificate attachments with validity expiring soon (or
          already expired).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
            Nothing expiring in the next 30 days.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((row, i) => (
              <li
                key={`${row.item.uuid}-${row.certificate.uuid ?? i}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/40 bg-background px-3 py-2.5 text-sm"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <Link
                    href={`/settings/items/${row.item.uuid}`}
                    className="block truncate font-medium hover:underline"
                  >
                    {row.item.name}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{row.certificate.name ?? "(unlinked)"}</span>
                    {row.certificate_number && (
                      <span className="font-mono">{row.certificate_number}</span>
                    )}
                    {row.document_url && (
                      <a
                        href={row.document_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline"
                      >
                        <ExternalLink className="size-3" />
                        Document
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    Expires {row.valid_until}
                  </span>
                  <DueBadge
                    daysUntil={row.days_until_expiry}
                    isOverdue={row.is_expired}
                    overdueLabel="Expired"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DueBadge({
  daysUntil,
  isOverdue,
  overdueLabel = "Overdue",
}: {
  daysUntil: number;
  isOverdue: boolean;
  overdueLabel?: string;
}) {
  if (isOverdue) {
    return <Badge tone="destructive">{overdueLabel}</Badge>;
  }
  if (daysUntil <= 7) {
    return <Badge tone="destructive">{daysUntil}d</Badge>;
  }
  if (daysUntil <= 30) {
    return <Badge tone="amber">{daysUntil}d</Badge>;
  }
  return <Badge tone="muted">{daysUntil}d</Badge>;
}
