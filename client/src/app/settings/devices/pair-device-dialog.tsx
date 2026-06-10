"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Loader2, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createPairingCodeAction } from "@/lib/devices/actions";
import { getSocket } from "@/lib/realtime/socket";
import type { DevicePairingCode, LinkedDevice } from "@/lib/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPaired: (device: LinkedDevice) => void;
}

interface ClaimedEvent {
  device_uuid: string;
  label: string;
}

export function PairDeviceDialog({ open, onOpenChange, onPaired }: Props) {
  const [pairing, setPairing] = useState<DevicePairingCode | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Snapshot the channel handle so the cleanup leaves it alone after re-renders.
  const channelRef = useRef<{ leave: () => void } | null>(null);

  // Generate a fresh code each time the dialog opens.
  useEffect(() => {
    if (!open) {
      setPairing(null);
      setQrDataUrl(null);
      setError(null);
      channelRef.current?.leave();
      channelRef.current = null;
      return;
    }
    void requestCode();
  }, [open]);

  // Tick once per second for the expires-in countdown.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Subscribe to pairing:<uuid> once we have a code so the dialog
  // auto-closes the moment the phone claims it.
  useEffect(() => {
    if (!pairing) return;
    let cancelled = false;

    (async () => {
      const socket = await getSocket();
      if (!socket || cancelled) return;

      const channel = socket.channel(`pairing:${pairing.uuid}`, {});
      channel.on("claimed", (payload: ClaimedEvent) => {
        const device: LinkedDevice = {
          id: 0,
          uuid: payload.device_uuid,
          code: null,
          label: payload.label,
          platform: null,
          user_agent: null,
          paired_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
          revoked_at: null,
          inserted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        onPaired(device);
        onOpenChange(false);
      });
      channel.join();
      channelRef.current = channel;
    })();

    return () => {
      cancelled = true;
      channelRef.current?.leave();
      channelRef.current = null;
    };
  }, [pairing, onPaired, onOpenChange]);

  // Encode the /pair URL into a QR data URL on every code change.
  useEffect(() => {
    if (!pairing) {
      setQrDataUrl(null);
      return;
    }
    const url = `${window.location.origin}/pair?code=${pairing.code}`;
    void QRCode.toDataURL(url, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 256,
    }).then((data) => setQrDataUrl(data));
  }, [pairing]);

  async function requestCode() {
    setLoading(true);
    setError(null);
    const res = await createPairingCodeAction();
    setLoading(false);
    if (res.ok) {
      setPairing(res.pairing);
    } else {
      setError(res.detail);
    }
  }

  const expiresInSeconds = pairing
    ? Math.max(0, Math.floor((new Date(pairing.expires_at).getTime() - now) / 1000))
    : 0;
  const expired = pairing && expiresInSeconds === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pair new device</DialogTitle>
          <DialogDescription>
            On your phone or tablet, open the camera and point it at the
            code below. Or type the short code at <span className="font-mono">/pair</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3 py-2">
          {loading && (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {!loading && error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {!loading && pairing && qrDataUrl && !expired && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrDataUrl}
                alt="Pairing QR code"
                width={256}
                height={256}
                className="rounded-md border border-border/60"
              />
              <div className="text-center">
                <div className="font-mono text-2xl tracking-[0.4em]">
                  {pairing.code}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Expires in {expiresInSeconds}s
                </div>
              </div>
            </>
          )}

          {!loading && expired && (
            <div className="flex flex-col items-center gap-2 py-6">
              <p className="text-sm text-muted-foreground">Code expired.</p>
              <Button variant="outline" size="sm" onClick={requestCode}>
                <RefreshCcw className="mr-1.5 size-4" />
                Generate a new code
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
