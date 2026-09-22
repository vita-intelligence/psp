import { redirect } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
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
import {
  listFormSubmissions,
  resolveSubmissionLookup,
} from "@/lib/sessions/server";
import type {
  SubmissionFilters,
  SubmissionLookupItem,
  SubmissionLookupType,
} from "@/lib/sessions/types";
import type { FormTrigger } from "@/lib/forms/types";
import { ProductionSubnav } from "../production-subnav";
import { FilterBar } from "./_components/filter-bar";
import { SubmissionsFeed } from "./_components/submissions-feed";

export const metadata = { title: "Session history · Production · PSP" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function pick(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const v = params[key];
  if (Array.isArray(v)) return v[0];
  return v;
}

export default async function SessionsPage({ searchParams }: PageProps) {
  const user = await requireUser();
  if (!hasPermission(user, "production.workstation_view")) {
    redirect("/settings/profile");
  }

  const rawParams = (await searchParams) ?? {};
  const filters: SubmissionFilters = {
    workstation_uuid: pick(rawParams, "workstation_uuid"),
    equipment_uuid: pick(rawParams, "equipment_uuid"),
    form_template_uuid: pick(rawParams, "form_template_uuid"),
    workstation_session_uuid: pick(rawParams, "workstation_session_uuid"),
    submitted_by_id: pick(rawParams, "submitted_by_id"),
    submitted_by_uuid: pick(rawParams, "submitted_by_uuid"),
    trigger: pick(rawParams, "trigger") as FormTrigger | undefined,
    activity_kind: pick(rawParams, "activity_kind") as
      | SubmissionFilters["activity_kind"]
      | undefined,
    from: pick(rawParams, "from"),
    to: pick(rawParams, "to"),
    search: pick(rawParams, "search"),
    limit: PAGE_SIZE,
  };

  // Resolve each currently-selected filter uuid to a friendly label
  // so the picker triggers render "Blending #1" instead of the raw
  // uuid on first paint. Kept parallel with the initial page fetch —
  // each call is a single-row lookup, cheap even at scale.
  const submitterKey = filters.submitted_by_id
    ? `u:${filters.submitted_by_id}`
    : filters.submitted_by_uuid
      ? `w:${filters.submitted_by_uuid}`
      : null;

  const [page, wsLabel, eqLabel, formLabel, submitterLabel] = await Promise.all(
    [
      listFormSubmissions(filters),
      filters.workstation_uuid
        ? resolveSubmissionLookup("workstation", filters.workstation_uuid)
        : Promise.resolve(null),
      filters.equipment_uuid
        ? resolveSubmissionLookup("equipment", filters.equipment_uuid)
        : Promise.resolve(null),
      filters.form_template_uuid
        ? resolveSubmissionLookup("form", filters.form_template_uuid)
        : Promise.resolve(null),
      submitterKey ? resolveSubmitter(submitterKey) : Promise.resolve(null),
    ],
  );

  const initialLabels: Partial<
    Record<SubmissionLookupType, SubmissionLookupItem>
  > = {};
  if (wsLabel) initialLabels.workstation = wsLabel;
  if (eqLabel) initialLabels.equipment = eqLabel;
  if (formLabel) initialLabels.form = formLabel;
  if (submitterLabel) initialLabels.submitter = submitterLabel;

  const lockedFilters = {
    workstation_uuid: !!filters.workstation_uuid,
    equipment_uuid: !!filters.equipment_uuid,
    form_template_uuid: !!filters.form_template_uuid,
    submitted_by_id: !!filters.submitted_by_id,
    submitted_by_uuid: !!filters.submitted_by_uuid,
  };

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto w-full space-y-6">
          <PageHeader
            icon={ClipboardList}
            title="Session history"
            description="Every form filled on the vita-performance kiosk. Filter by workstation, machine, worker, form, date range, or activity — click through for the full response and its parent session."
          />

          <FilterBar
            initialLabels={initialLabels}
            lockedFilters={lockedFilters}
          />

          <Card className="border-border/60">
            <CardHeader>
              <CardTitle>Submissions</CardTitle>
              <CardDescription>
                Newest first. Scroll (or click Load more) to walk further back
                in the audit trail.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SubmissionsFeed
                initialItems={page.items}
                initialNextCursor={page.next_cursor}
                pageSize={PAGE_SIZE}
              />
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

/** Submitter picker uses the composite ``u:<id>`` / ``w:<uuid>`` key.
 *  The lookup endpoint accepts either flavour on ``uuid=`` and returns
 *  the same composite key back, so a single call reliably hydrates
 *  the trigger label. */
async function resolveSubmitter(
  key: string,
): Promise<SubmissionLookupItem | null> {
  return resolveSubmissionLookup("submitter", key);
}
