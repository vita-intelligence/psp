"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, Loader2, Smartphone } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/forms/error-banner";
import { pushNavigateToMyDevicesAction } from "@/lib/devices/actions";
import { createShipmentAction } from "@/lib/shipments/actions";

interface Props {
  initialError?: { code: string; detail: string } | null;
}

/**
 * Two entry points into a shipment: push the scan to a paired phone,
 * or type the lot uuid manually (dev / desktop-only workflows). Once
 * the lot uuid resolves we hit createShipmentAction and jump to the
 * detail page.
 */
export function NewShipmentShell({ initialError }: Props) {
  const router = useRouter();
  const [manualUuid, setManualUuid] = useState("");
  const [pushingToDevice, setPushingToDevice] = useState(false);
  const [awaitingScan, setAwaitingScan] = useState(false);
  const [error, setError] = useState<{ code: string; detail: string } | null>(
    initialError ?? null,
  );
  const [creating, startCreate] = useTransition();

  const sendToDevice = async () => {
    setPushingToDevice(true);
    setError(null);
    try {
      const res = await pushNavigateToMyDevicesAction("/m/shipment-scan");
      if (!res.ok) {
        setError({ code: res.code, detail: res.detail });
        return;
      }
      if (res.pushed_to.length === 0) {
        toast.warning(
          "No paired devices — open PSP on the warehouse phone first, then try again.",
        );
        return;
      }
      toast.success(
        res.pushed_to.length === 1
          ? "Scan flow opened on your phone."
          : `Scan flow opened on ${res.pushed_to.length} paired devices.`,
      );
      setAwaitingScan(true);
    } finally {
      setPushingToDevice(false);
    }
  };

  const submitManual = () => {
    const uuid = manualUuid.trim().toLowerCase();
    if (!uuid.match(/^[0-9a-f-]{36}$/)) {
      setError({
        code: "bad_uuid",
        detail: "That doesn't look like a lot uuid. Copy it from the lot page.",
      });
      return;
    }
    setError(null);
    startCreate(async () => {
      const res = await createShipmentAction(uuid);
      if (!res.ok) {
        setError({ code: res.code, detail: res.detail });
        return;
      }
      router.push(`/shipments/${res.shipment.uuid}`);
    });
  };

  return (
    <div className="space-y-4">
      {error && <ErrorBanner detail={error.detail} code={error.code} />}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Smartphone className="size-4" />
            Push scan to your phone
          </CardTitle>
          <CardDescription>
            Recommended — the lot label is on a pallet in the dispatch cell,
            not on your desk.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            className="w-full"
            size="lg"
            disabled={pushingToDevice}
            onClick={() => void sendToDevice()}
          >
            {pushingToDevice ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Sending…
              </>
            ) : (
              <>
                <Smartphone className="mr-2 size-4" />
                Send scan task to my devices
              </>
            )}
          </Button>
          {awaitingScan && (
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              Waiting for the scan on your phone. Once it lands, the new
              shipment will appear on the /shipments list — refresh to see it,
              or open it directly from the phone.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Camera className="size-4" />
            Or type the lot uuid
          </CardTitle>
          <CardDescription>
            Use this if you already have the lot uuid open on a browser tab
            (item page URL). Skips the physical scan.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Input
            placeholder="00000000-0000-0000-0000-000000000000"
            value={manualUuid}
            onChange={(e) => setManualUuid(e.target.value)}
            className="font-mono text-xs"
          />
          <Button
            variant="outline"
            className="w-full"
            disabled={!manualUuid.trim() || creating}
            onClick={submitManual}
          >
            {creating ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Creating…
              </>
            ) : (
              "Create shipment from this uuid"
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
