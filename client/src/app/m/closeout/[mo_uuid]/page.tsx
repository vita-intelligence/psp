import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ClipboardCheck, Info } from "lucide-react";
import { getSessionToken } from "@/lib/auth/server";
import { getDeviceToken } from "@/lib/devices/server";
import {
  getCloseoutDetail,
  getDispatchCellsForMo,
} from "@/lib/production-closeout/server";
import { getCompanyDefaults } from "@/lib/company/server";
import { CloseoutFlow } from "./closeout-flow";

export const metadata = { title: "Closeout · PSP Mobile" };

export const dynamic = "force-dynamic";

interface Params {
  mo_uuid: string;
}

export default async function MobileCloseoutDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const [deviceToken, sessionToken] = await Promise.all([
    getDeviceToken(),
    getSessionToken(),
  ]);
  const { mo_uuid } = await params;
  if (!deviceToken && !sessionToken)
    redirect(`/login?next=%2Fm%2Fcloseout%2F${mo_uuid}`);

  const [detailResult, dispatchCells, company] = await Promise.all([
    getCloseoutDetail(mo_uuid),
    getDispatchCellsForMo(mo_uuid),
    getCompanyDefaults(),
  ]);

  // "Awaiting Output QC" is the #1 reason a mobile operator lands
  // here and gets stuck. Instead of a hard 404, tell them what the
  // system's waiting for + point them at the fix.
  if (detailResult.kind === "awaiting_output_qc") {
    return <BlockedScreen tone="qc" detail={detailResult.detail} />;
  }
  if (detailResult.kind === "not_completed") {
    return <BlockedScreen tone="not_completed" detail={detailResult.detail} />;
  }
  if (detailResult.kind === "not_found") {
    notFound();
  }

  return (
    <CloseoutFlow
      initialMo={detailResult.detail.mo}
      initialBookings={detailResult.detail.bookings}
      initialOutputLots={detailResult.detail.output_lots}
      dispatchCells={dispatchCells?.items ?? []}
      companyDateFormat={company}
    />
  );
}

function BlockedScreen({
  tone,
  detail,
}: {
  tone: "qc" | "not_completed";
  detail: string;
}) {
  const title =
    tone === "qc" ? "Output QC pending" : "MO not ready for closeout";

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 py-6">
      <Link
        href="/m/closeout"
        className="inline-flex w-fit items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to Closeout queue
      </Link>

      <div className="flex flex-col items-center gap-3 rounded-3xl border border-amber-500/40 bg-amber-500/5 p-6 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
          {tone === "qc" ? (
            <ClipboardCheck className="size-6" />
          ) : (
            <Info className="size-6" />
          )}
        </div>
        <p className="text-base font-semibold">{title}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{detail}</p>
        {tone === "qc" && (
          <Link
            href="/production/output-qc"
            className="mt-2 inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Go to Output QC
          </Link>
        )}
      </div>
    </div>
  );
}
