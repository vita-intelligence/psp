"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Loader2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/forms/error-banner";
import type { ErrorResult } from "@/lib/errors/server";
import { createShipmentAction } from "@/lib/shipments/actions";
import { UuidScanStep } from "../pickup/[mo_uuid]/uuid-scan-step";

/**
 * Mobile scan-to-create for shipments. Operator lands here from
 * either the /m tile OR a push-to-device from /shipments/new on the
 * desktop. Scan the lot QR, POST /api/shipments, redirect to the
 * mobile shipment detail (same route as desktop — the form renders
 * fine on narrow viewports too).
 */
export function ShipmentScanShell() {
  const router = useRouter();
  const [error, setError] = useState<ErrorResult | null>(null);
  const [creating, startCreate] = useTransition();
  const [createdShipmentUuid, setCreatedShipmentUuid] = useState<string | null>(
    null,
  );

  const onScanned = (lotUuid: string) => {
    setError(null);
    startCreate(async () => {
      const res = await createShipmentAction(lotUuid);
      if (!res.ok) {
        setError(res);
        return;
      }
      setCreatedShipmentUuid(res.shipment.uuid);
      router.push(`/shipments/${res.shipment.uuid}`);
    });
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-2 border-b border-border/60 px-3 py-3">
        <Link
          href="/m"
          className="rounded-md p-1.5 text-muted-foreground active:bg-muted"
          aria-label="Back to home"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0">
          <p className="truncate text-xs uppercase tracking-wider text-muted-foreground">
            Shipment scan
          </p>
          <p className="truncate text-sm font-semibold">
            Scan the lot QR at the dispatch cell
          </p>
        </div>
      </header>

      <main className="flex-1 space-y-3 px-3 py-4">
        {error && <ErrorBanner detail={error.detail} code={error.code} />}

        {creating && (
          <div className="flex items-center gap-2 rounded-md border border-sky-500/40 bg-sky-500/5 px-3 py-2 text-xs text-sky-900 dark:text-sky-100">
            <Loader2 className="size-3.5 animate-spin" />
            Creating shipment draft…
          </div>
        )}

        {createdShipmentUuid && !creating && (
          <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-900 dark:text-emerald-100">
            <CheckCircle2 className="size-3.5" />
            Shipment created — redirecting…
          </div>
        )}

        {!creating && !createdShipmentUuid && (
          <>
            <div className="rounded-md border border-sky-500/40 bg-sky-500/5 p-3 text-xs">
              <p className="font-medium text-sky-900 dark:text-sky-100">
                <Truck className="mr-1 inline size-3.5" />
                What happens next
              </p>
              <p className="mt-1 text-sky-800/90 dark:text-sky-200/90">
                Point the camera at the lot label on the pallet. Once we read
                it, we&apos;ll create a draft shipment and open it — you can
                fill the rest of the paperwork on your device or the desktop.
              </p>
            </div>

            <UuidScanStep
              expectedUuid="*"
              kind="lot"
              expectedLabel="Any lot currently in a dispatch cell"
              onConfirmed={() => {
                /* onScanned handles the actual work */
              }}
              onCancel={() => router.push("/m")}
              onScanned={onScanned}
            />
          </>
        )}
      </main>
    </div>
  );
}
