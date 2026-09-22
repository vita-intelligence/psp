import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge-mini";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { getFormSubmission } from "@/lib/sessions/server";
import { ACTIVITY_KIND_LABELS } from "@/lib/sessions/types";
import type { FormField } from "@/lib/forms/types";
import { TRIGGER_LABELS } from "@/lib/forms/types";
import { ProductionSubnav } from "../../production-subnav";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ uuid: string }>;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function formatAnswer(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toString();
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(formatAnswer).join(", ");
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "[object]";
    }
  }
  return String(value);
}

export default async function SubmissionDetailPage({ params }: PageProps) {
  const user = await requireUser();
  if (!hasPermission(user, "production.workstation_view")) {
    redirect("/settings/profile");
  }

  const { uuid } = await params;
  const submission = await getFormSubmission(uuid);
  if (!submission) notFound();

  const activityLabel =
    (submission.activity_kind &&
      ACTIVITY_KIND_LABELS[submission.activity_kind]) ||
    null;

  const fields = (submission.schema_snapshot?.fields ?? []) as FormField[];
  const perEquipment = submission.schema_snapshot?.per_equipment_fields ?? [];

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto w-full space-y-6">
          <div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/production/sessions">
                <ArrowLeft className="mr-1.5 size-4" />
                Back to session history
              </Link>
            </Button>
          </div>

          <PageHeader
            icon={ClipboardList}
            title={submission.form_name}
            description={`${
              TRIGGER_LABELS[submission.form_trigger] ??
              submission.form_trigger
            } · v${submission.schema_version ?? "?"}`}
          />

          <div className="flex flex-wrap gap-2 text-sm">
            {submission.workstation ? (
              <Badge tone="muted" className="font-normal">
                Workstation ·{" "}
                <Link
                  className="ml-1 underline-offset-2 hover:underline"
                  href={`/production/workstations/${submission.workstation.uuid}`}
                >
                  {submission.workstation.name}
                </Link>
              </Badge>
            ) : null}
            {submission.equipment ? (
              <Badge tone="muted" className="font-normal">
                Machine ·{" "}
                <Link
                  className="ml-1 underline-offset-2 hover:underline"
                  href={`/equipment/${submission.equipment.uuid}`}
                >
                  {submission.equipment.serial_number ||
                    submission.equipment.uuid.slice(0, 8)}
                </Link>
              </Badge>
            ) : null}
            {activityLabel ? (
              <Badge tone="brand" className="font-normal">
                {activityLabel}
              </Badge>
            ) : null}
            {submission.submitted_by.name ? (
              <Badge tone="brand" className="font-normal">
                Submitted by {submission.submitted_by.name}
              </Badge>
            ) : null}
            <Badge tone="brand" className="font-normal">
              {formatDateTime(submission.submitted_at)}
            </Badge>
          </div>

          <Card className="border-border/60">
            <CardHeader>
              <CardTitle>Answers</CardTitle>
              <CardDescription>
                Rendered from the schema captured at submission time — later
                edits to the template don&apos;t change what the auditor sees
                here.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {fields.length === 0 && perEquipment.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No fields on this form&apos;s schema snapshot.
                </p>
              ) : (
                <dl className="grid gap-3 sm:grid-cols-2">
                  {fields.map((field) => (
                    <div
                      key={field.id}
                      className="flex flex-col gap-1 rounded-md border border-border/50 bg-muted/20 p-3"
                    >
                      <dt className="text-xs font-medium text-muted-foreground">
                        {field.label}
                        {field.required ? (
                          <span className="ml-1 text-destructive">*</span>
                        ) : null}
                      </dt>
                      <dd className="text-sm">
                        {formatAnswer(submission.answers?.[field.id])}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}

              {perEquipment.length > 0 ? (
                <div className="mt-6">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Per-equipment answers
                  </div>
                  <dl className="mt-2 grid gap-3 sm:grid-cols-2">
                    {perEquipment.map((field) => (
                      <div
                        key={field.id}
                        className="flex flex-col gap-1 rounded-md border border-border/50 bg-muted/20 p-3"
                      >
                        <dt className="text-xs font-medium text-muted-foreground">
                          {field.label}
                        </dt>
                        <dd className="text-sm">
                          {formatAnswer(submission.answers?.[field.id])}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {submission.session ? (
            <Card className="border-border/60">
              <CardHeader>
                <CardTitle>Parent session</CardTitle>
                <CardDescription>
                  The workstation session this submission belongs to.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <div className="text-xs text-muted-foreground">Started</div>
                  <div>{formatDateTime(submission.session.started_at)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Finished</div>
                  <div>{formatDateTime(submission.session.finished_at)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Activity</div>
                  <div>
                    {ACTIVITY_KIND_LABELS[submission.session.activity_kind]}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">
                    Same-session submissions
                  </div>
                  <div>
                    <Link
                      className="underline-offset-2 hover:underline"
                      href={`/production/sessions?workstation_session_uuid=${submission.session.uuid}`}
                    >
                      View all submissions from this session →
                    </Link>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </main>
    </div>
  );
}
