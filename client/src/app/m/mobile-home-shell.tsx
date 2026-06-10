"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  Camera,
  ChevronRight,
  LogOut,
  PackageOpen,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/brand/wordmark";
import {
  getDeviceSocket,
  disconnectDeviceSocket,
} from "@/lib/realtime/device-socket";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";
import { formatCompanyNumber } from "@/lib/format/company";
import type { DeviceDisplay } from "@/lib/devices/server";
import type { StockLot } from "@/lib/types";

interface Props {
  display: DeviceDisplay;
  pendingLots: StockLot[];
}

interface PingPayload {
  message: string;
  sent_at: string;
}

/**
 * Mobile shell home. Lists "Pending put-away" — lots whose stock
 * still sits in the warehouse's Unregistered cell — so operators
 * walk in and see "5 things waiting for a shelf decision". Tapping
 * a card opens the lot's mobile detail (`/m/lots/[uuid]`); the big
 * camera button below opens the scanner for the more common case of
 * "I already have the box in hand, scan its QR".
 */
export function MobileHomeShell({ display, pendingLots }: Props) {
  const router = useRouter();
  const prefs = useFormatPrefs();
  const [connected, setConnected] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const channelRef = useRef<{ leave: () => void } | null>(null);

  // Same channel + revoked handling as the previous shell — pings
  // toast in, revoke kicks us out to the "device revoked" screen.
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
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {connected ? (
            <Wifi className="size-3.5 text-emerald-500" />
          ) : (
            <WifiOff className="size-3.5 text-amber-500" />
          )}
        </div>
      </header>

      <main className="flex-1 space-y-5 px-4 py-5">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {display.user_name}
          </p>
          <p className="text-sm font-medium">{display.device_label}</p>
        </div>

        <section className="space-y-2">
          <header className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold tracking-tight">
              Pending put-away
            </h2>
            <span className="text-xs text-muted-foreground">
              {pendingLots.length}
            </span>
          </header>

          {pendingLots.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border/60 px-4 py-8 text-center">
              <PackageOpen className="size-6 text-muted-foreground/60" />
              <p className="text-sm font-medium">All clear</p>
              <p className="text-xs text-muted-foreground">
                Nothing waiting on a shelf decision right now.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {pendingLots.map((lot) => (
                <PendingCard key={lot.uuid} lot={lot} prefs={prefs} />
              ))}
            </ul>
          )}
        </section>
      </main>

      <footer className="space-y-2 border-t border-border/60 px-4 py-3">
        <Button asChild size="lg" className="h-14 w-full text-base">
          <Link href="/m/scan">
            <Camera className="mr-2 size-5" />
            Scan a QR code
          </Link>
        </Button>
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

function PendingCard({
  lot,
  prefs,
}: {
  lot: StockLot;
  prefs: ReturnType<typeof useFormatPrefs>;
}) {
  const qty = formatCompanyNumber(lot.qty_on_hand, prefs);
  const symbol = lot.unit_of_measurement?.symbol ?? "";
  const warehouseName =
    lot.placements?.find((p) => p.storage_cell)?.storage_cell?.name ?? "—";
  void warehouseName;

  return (
    <li>
      <Link
        href={`/m/lots/${lot.uuid}`}
        className="flex items-center gap-3 rounded-lg border border-border/60 bg-card px-3 py-3 active:bg-muted"
      >
        <div className="flex-1 space-y-0.5 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-semibold">
              {lot.code ?? `#${lot.id}`}
            </span>
            <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
              Unregistered
            </span>
          </div>
          <p className="truncate text-sm font-medium">{lot.item?.name ?? "—"}</p>
          <p className="text-[11px] text-muted-foreground">
            {qty} {symbol}
          </p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
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
