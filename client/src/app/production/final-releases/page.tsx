import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { getSessionToken } from "@/lib/auth/server";
import { getFinalReleaseQueue } from "@/lib/production-final-release/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Final Product Release · PSP" };
export const dynamic = "force-dynamic";

export default async function FinalReleaseQueuePage() {
  const session = await getSessionToken();
  if (!session) redirect("/login?next=%2Fproduction%2Ffinal-releases");

  const queue = await getFinalReleaseQueue();
  const items = queue?.items ?? [];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6">
      <div>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Final Product Release · BRCGS Issue 9 § 5.6 Positive Release
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Awaiting QA sign-off
        </h1>
        <p className="text-sm text-muted-foreground">
          Finished batches sit here after output-QC pass. Attach evidence,
          collect two signatures, then Release / Hold / Reject.
        </p>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <CheckCircle2 className="size-8 text-emerald-500/70" />
            <p className="text-sm font-semibold">Nothing awaiting release</p>
            <p className="text-xs text-muted-foreground">
              Once a top-of-tree MO's output passes QC, its lot lands here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((r) => {
            const lot = r.stock_lot;
            const filesReady = r.files.length >= r.required_file_kinds.length;
            const bothSigned = !!r.releaser_id && !!r.approver_id;
            return (
              <Link
                key={r.uuid}
                href={`/production/final-releases/${encodeURIComponent(lot?.uuid ?? "")}`}
                className="block"
              >
                <Card className="transition hover:border-brand/60 hover:shadow-md">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <ShieldCheck className="size-4 text-sky-600" />
                      {lot?.item?.name ?? "Finished lot"}
                    </CardTitle>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {lot?.code ?? "—"} ·{" "}
                      {r.manufacturing_order?.code ?? "—"}
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-1 text-xs">
                    <p className="text-muted-foreground">
                      {lot?.placement
                        ? `${lot.placement.warehouse?.name ?? "?"} · ${lot.placement.cell_name ?? "?"}`
                        : "Not on shelf"}
                    </p>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <Chip
                        ok={filesReady}
                        label={`${r.files.length}/${r.required_file_kinds.length} files`}
                      />
                      <Chip
                        ok={!!r.releaser_id}
                        label="Releaser"
                      />
                      <Chip
                        ok={!!r.approver_id}
                        label="Approver"
                      />
                      {bothSigned && filesReady && (
                        <Chip ok label="Ready to release" strong />
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Chip({
  ok,
  label,
  strong,
}: {
  ok: boolean;
  label: string;
  strong?: boolean;
}) {
  return (
    <span
      className={
        ok
          ? strong
            ? "inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-200"
            : "inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300"
          : "inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
      }
    >
      {label}
    </span>
  );
}
