"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Camera,
  Factory,
  MapPin,
  QrCode,
  RefreshCw,
  ShieldAlert,
  Smartphone,
} from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { pushNavigateToMyDevicesAction } from "@/lib/devices/actions";
import type { FinalRelease } from "@/lib/production-final-release/types";

/**
 * The lot isn't in a finished-quarantine cell yet — the release
 * ceremony (BRCGS Issue 9 § 5.6 + § 4.4) is hard-blocked. No files,
 * no signatures, no notes editable. The only way forward is the
 * proper move procedure: warehouse worker uses /m/putaway, scans
 * the lot QR + a finished-quarantine cell QR, takes a photo. That
 * writes a Stock.Movement with photo evidence — audit-grade.
 * Attesting via a UI button would break the compliance trail.
 */
export function PlacementBlockScreen({
  release,
  lotUuid,
}: {
  release: FinalRelease;
  lotUuid: string;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [pushing, startPush] = useTransition();
  const lot = release.stock_lot;
  const placement = lot?.placement;
  const currentCellName = placement?.cell_name ?? "an unrecorded cell";
  const currentPurpose = placement?.cell_purpose ?? "unknown";

  const sendPutawayToPhone = () =>
    startPush(async () => {
      const res = await pushNavigateToMyDevicesAction("/m/putaway");
      if (!res.ok) {
        toast.error(res.detail ?? "Couldn't push to your paired devices.");
        return;
      }
      const count = res.pushed_to.length;
      if (count === 0) {
        toast.warning(
          "No paired devices. Open PSP on the warehouse phone first, then try again.",
        );
      } else {
        toast.success(
          count === 1
            ? "Put-away opened on your phone."
            : `Put-away opened on ${count} paired devices.`,
        );
      }
    });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.back()}
          aria-label="Back"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Final Product Release · BRCGS § 5.6 + § 4.4
          </p>
          <h1 className="truncate text-lg font-semibold tracking-tight">
            {lot?.item?.name ?? "Finished lot"}
          </h1>
          <p className="text-xs text-muted-foreground truncate">
            Lot {lot?.code ?? lot?.uuid.slice(0, 8) ?? "—"}
            {release.manufacturing_order?.code
              ? ` · ${release.manufacturing_order.code}`
              : null}
          </p>
        </div>
      </div>

      <Card className="border-amber-500/50 bg-amber-500/5">
        <CardContent className="space-y-4 py-6">
          <div className="flex items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300">
              <ShieldAlert className="size-5" />
            </div>
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-amber-900 dark:text-amber-100">
                Move the lot to finished-quarantine before the ceremony
              </h2>
              <p className="text-sm text-amber-900/90 dark:text-amber-100/90">
                Currently sitting in{" "}
                <span className="font-semibold">{currentCellName}</span> (purpose{" "}
                <span className="font-mono text-xs">{currentPurpose}</span>).
                BRCGS Issue 9 § 5.6 (Positive Release) and § 4.4 (physical
                segregation) require finished product to sit in a dedicated
                finished-quarantine bay during the release ceremony — separate
                from cleared stock so an auditor can tell "waiting on release"
                from "released" at the shelf.
              </p>
            </div>
          </div>

          <div className="space-y-3 rounded-md border border-amber-500/30 bg-background/60 p-4">
            <p className="text-sm font-semibold">
              Follow the standard move procedure
            </p>
            <ol className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <div className="grid size-5 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-semibold text-foreground">
                  1
                </div>
                <span>
                  Open put-away on the warehouse phone (use{" "}
                  <span className="font-medium">Send put-away to phone</span>{" "}
                  below to push it there — the move flow needs the camera, so
                  don&apos;t use the desktop tab). This lot is listed with a{" "}
                  <span className="font-medium">→ Finished quarantine</span>{" "}
                  chip.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <QrCode className="size-5 shrink-0 text-muted-foreground" />
                <span>
                  Scan the lot label at its current shelf, then scan any cell
                  QR marked <span className="font-mono text-xs">finished_quarantine</span>.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Camera className="size-5 shrink-0 text-muted-foreground" />
                <span>
                  Take the required photo of the lot in the new cell. The
                  system writes a Stock.Movement with the photo as audit
                  evidence — this is the only accepted move procedure.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <MapPin className="size-5 shrink-0 text-muted-foreground" />
                <span>
                  Once the move lands, come back to this page and hit{" "}
                  <span className="font-medium">Re-check placement</span>.
                </span>
              </li>
            </ol>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={sendPutawayToPhone}
              disabled={pushing}
            >
              <Smartphone className="mr-2 size-4" />
              {pushing ? "Pushing…" : "Send put-away to phone"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                startRefresh(() => {
                  router.refresh();
                })
              }
              disabled={refreshing}
            >
              <RefreshCw
                className={"mr-2 size-4 " + (refreshing ? "animate-spin" : "")}
              />
              Re-check placement
            </Button>
            <Button asChild variant="outline">
              <Link href="/production/final-releases">
                <Factory className="mr-2 size-4" />
                Back to release queue
              </Link>
            </Button>
          </div>

          <p className="text-[11px] text-muted-foreground">
            This screen refreshes on its own when the Stock.Movement for this
            lot lands. No attestation button — a compliant release trail needs
            the recorded move with photo, not a click.
          </p>
        </CardContent>
      </Card>

      <p className="px-2 text-[11px] text-muted-foreground">
        Debug — lot uuid <span className="font-mono">{lotUuid}</span> · release
        row uuid <span className="font-mono">{release.uuid}</span>
      </p>
    </div>
  );
}
