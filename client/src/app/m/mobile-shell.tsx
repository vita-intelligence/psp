"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, LogOut, ScanLine, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/brand/wordmark";
import { getDeviceSocket, disconnectDeviceSocket } from "@/lib/realtime/device-socket";
import type { DeviceDisplay } from "@/lib/devices/server";

interface Props {
  display: DeviceDisplay;
}

interface PingPayload {
  message: string;
  sent_at: string;
}

export function MobileShell({ display }: Props) {
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const channelRef = useRef<{ leave: () => void } | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const socket = await getDeviceSocket();
      if (!socket || cancelled) return;

      const channel = socket.channel(`device:${display.device_uuid}`, {});

      channel.on("ping", (payload: PingPayload) => {
        toast.message(payload.message, {
          icon: <Bell className="size-4" />,
          description: new Date(payload.sent_at).toLocaleTimeString(),
        });
      });

      channel.on("revoked", () => {
        setRevoked(true);
        disconnectDeviceSocket();
      });

      channel
        .join()
        .receive("ok", () => setConnected(true))
        .receive("error", () => setConnected(false));

      socket.onError(() => setConnected(false));
      socket.onOpen(() => {
        if (channelRef.current) setConnected(true);
      });

      channelRef.current = channel;
    })();

    return () => {
      cancelled = true;
      channelRef.current?.leave();
      channelRef.current = null;
    };
  }, [display.device_uuid]);

  if (revoked) {
    return <RevokedScreen onPairAgain={() => signOutAndPair(router)} />;
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <Wordmark />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {connected ? (
            <>
              <Wifi className="size-3.5 text-emerald-500" />
              <span>Online</span>
            </>
          ) : (
            <>
              <WifiOff className="size-3.5 text-amber-500" />
              <span>Connecting…</span>
            </>
          )}
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-8 text-center">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Signed in as
          </p>
          <p className="text-lg font-semibold">{display.user_name}</p>
          <p className="text-sm text-muted-foreground">
            Device: <span className="font-medium">{display.device_label}</span>
          </p>
        </div>

        <div className="flex w-full max-w-xs flex-col gap-3">
          <Button size="lg" className="h-16 text-base" disabled>
            <ScanLine className="mr-2 size-5" />
            Scan QR (coming soon)
          </Button>
          <p className="text-xs text-muted-foreground">
            The scanner module lands in the next slice. For now this
            shell just confirms the realtime path — every test ping
            sent from your laptop will pop a toast right here.
          </p>
        </div>
      </main>

      <footer className="border-t border-border/60 px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-muted-foreground"
          onClick={() => signOutAndPair(router)}
        >
          <LogOut className="mr-1.5 size-4" />
          Sign this device out
        </Button>
      </footer>
    </div>
  );
}

function RevokedScreen({ onPairAgain }: { onPairAgain: () => void }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <WifiOff className="size-8 text-destructive" />
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Device revoked</h1>
        <p className="text-sm text-muted-foreground">
          This device was signed out from your laptop. Pair again with a
          fresh code to continue.
        </p>
      </div>
      <Button onClick={onPairAgain}>Pair again</Button>
    </div>
  );
}

async function signOutAndPair(router: ReturnType<typeof useRouter>) {
  disconnectDeviceSocket();
  await fetch("/api/device/sign-out", { method: "POST" });
  router.replace("/pair");
}
