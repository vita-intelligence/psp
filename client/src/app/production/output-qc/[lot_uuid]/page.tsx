import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, Microscope } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { getCompanyDefaults } from "@/lib/company/server";
import { getNpdPublicConfig } from "@/lib/npd/config";
import { getOutputQcEntry } from "@/lib/production-output-qc/entry";
import { Button } from "@/components/ui/button";
import { ProductionSubnav } from "../../production-subnav";
import { NpdValidationEmbed } from "@/components/production/npd-validation-embed";
import { SpecSheet } from "./spec-sheet";
import { QcActionsCard } from "./qc-actions-card";
import { NpdValidationCard } from "./npd-validation-card";

export const metadata = { title: "Review lot · Output QC · PSP" };
export const dynamic = "force-dynamic";

export default async function OutputQcDetailPage({
  params,
}: {
  params: Promise<{ lot_uuid: string }>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, "production.qc_output")) {
    redirect("/production");
  }

  const { lot_uuid } = await params;
  const [entry, company, npdConfig] = await Promise.all([
    getOutputQcEntry(lot_uuid),
    getCompanyDefaults(),
    getNpdPublicConfig(),
  ]);

  if (!entry) notFound();

  const { lot, mo } = entry;
  const item = lot.item ?? mo?.item ?? null;
  const itemName = item?.name ?? "Unknown item";
  const moCode = mo?.code ?? (mo ? `MO #${mo.id}` : null);
  const lotCode = lot.code ?? lot.uuid;

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-7xl space-y-6">
          <div>
            <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
              <Link href="/production/output-qc">
                <ChevronLeft className="mr-1 size-4" /> Back to Output QC
              </Link>
            </Button>
          </div>

          <PageHeader
            icon={Microscope}
            title={
              item?.uuid ? (
                <Link
                  href={`/production/items/${item.uuid}`}
                  className="underline-offset-4 hover:underline"
                >
                  {itemName}
                </Link>
              ) : (
                itemName
              )
            }
            description={
              <span className="text-xs">
                Reviewing{" "}
                <Link
                  href={`/stock/lots/${lot.uuid}`}
                  className="font-mono underline-offset-4 hover:underline"
                >
                  {lotCode}
                </Link>
                {mo && moCode && (
                  <>
                    {" · from "}
                    <Link
                      href={`/production/manufacturing-orders/${mo.uuid}`}
                      className="font-mono underline-offset-4 hover:underline"
                    >
                      {moCode}
                    </Link>
                  </>
                )}
                {mo?.project_type && mo.project_type !== "production" && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-400">
                    {mo.project_type}
                  </span>
                )}
              </span>
            }
          />

          {(mo?.project_type === "trial" || mo?.project_type === "sample") &&
            npdConfig.enabled &&
            npdConfig.frontend_url && (
              <NpdValidationCard
                entry={entry}
                npdBaseUrl={npdConfig.frontend_url}
              />
            )}

          <SpecSheet entry={entry} />

          {/* NPD product validation sheet — for R&D lots. Renders
              when the MO has EITHER its own trial batch OR just an
              npd_formulation_uuid (sample-of-approved-RTG case: the
              sample MO has no trial batch of its own, but the
              underlying formulation carries a canonical passed
              validation from the trial batch that got the FINAL
              spec approved). Backend resolves the fallback and hits
              NPD's ``latest.html?formulation=`` when the MO has no
              trial batch. Collapsed by default so the iframe request
              only fires on operator expand. */}
          {(mo?.npd_trial_batch_uuid || mo?.npd_formulation_uuid) && (
            <NpdValidationEmbed
              src={`/api/production/output-qc/${encodeURIComponent(lot_uuid)}/npd-validation.html`}
            />
          )}

          <QcActionsCard entry={entry} companyDateFormat={company} />
        </div>
      </main>
    </div>
  );
}
