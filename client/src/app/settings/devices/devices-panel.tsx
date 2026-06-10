"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  AlertCircle,
  Apple,
  Bell,
  Monitor,
  Plus,
  Smartphone,
  Tablet,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { LinkedDevice } from "@/lib/types";
import {
  revokeDeviceAction,
  sendPingAction,
} from "@/lib/devices/actions";
import { formatCompanyDate } from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";
import { PairDeviceDialog } from "./pair-device-dialog";

interface Props {
  initial: LinkedDevice[];
}

export function DevicesPanel({ initial }: Props) {
  const prefs = useFormatPrefs();
  const [devices, setDevices] = useState<LinkedDevice[]>(initial);
  const [pairOpen, setPairOpen] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<LinkedDevice | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Re-tick relative timestamps every 30s without re-fetching.
  const [, setTick] = useState(0);
  // Until we've mounted, render absolute dates instead of relative
  // strings — `relative()` calls `Date.now()` which differs between
  // the SSR snapshot and hydration, otherwise React throws a
  // hydration warning the moment the cookie-set `paired_at` time
  // shifts by a second.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const handlePaired = useCallback((device: LinkedDevice) => {
    setDevices((prev) => {
      const without = prev.filter((d) => d.uuid !== device.uuid);
      return [device, ...without];
    });
    toast.success(`${device.label} paired`);
  }, []);

  const handleRevoke = useCallback((device: LinkedDevice) => {
    setPendingId(device.uuid);
    startTransition(async () => {
      const res = await revokeDeviceAction(device.uuid);
      setPendingId(null);
      if (res.ok) {
        setDevices((prev) => prev.filter((d) => d.uuid !== device.uuid));
        toast.success(`${device.label} revoked`);
      } else {
        toast.error(res.detail);
      }
      setConfirmRevoke(null);
    });
  }, []);

  const handlePing = useCallback((device: LinkedDevice) => {
    setPendingId(device.uuid);
    startTransition(async () => {
      const res = await sendPingAction(device.uuid);
      setPendingId(null);
      if (res.ok) {
        toast.success(`Ping sent to ${device.label}`);
      } else {
        toast.error(res.detail);
      }
    });
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setPairOpen(true)}>
          <Plus className="mr-1.5 size-4" />
          Pair new device
        </Button>
      </div>

      {devices.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="divide-y divide-border/60 rounded-md border border-border/60">
          {devices.map((d) => (
            <li
              key={d.uuid}
              className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap"
            >
              <PlatformIcon platform={d.platform} className="size-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{d.label}</span>
                  {isOnline(d) && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                      <span className="size-1.5 rounded-full bg-emerald-500" />
                      Online
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground" suppressHydrationWarning>
                  {d.code && <span className="font-mono">{d.code}</span>}
                  {d.code && " · "}
                  Paired {mounted ? relative(d.paired_at) : formatDate(d.paired_at, prefs.date_format)}
                  {d.last_seen_at &&
                    ` · Last seen ${mounted ? relative(d.last_seen_at) : formatDate(d.last_seen_at, prefs.date_format)}`}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handlePing(d)}
                  disabled={pendingId === d.uuid}
                >
                  <Bell className="mr-1.5 size-3.5" />
                  Send ping
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setConfirmRevoke(d)}
                  disabled={pendingId === d.uuid}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <PairDeviceDialog
        open={pairOpen}
        onOpenChange={setPairOpen}
        onPaired={handlePaired}
      />

      <AlertDialog
        open={confirmRevoke !== null}
        onOpenChange={(open) => !open && setConfirmRevoke(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this device?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmRevoke?.label} will be signed out immediately. Pairing
              again later will need a fresh QR code.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => confirmRevoke && handleRevoke(confirmRevoke)}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border/60 px-4 py-10 text-center">
      <AlertCircle className="size-6 text-muted-foreground" />
      <p className="text-sm font-medium">No paired devices yet</p>
      <p className="max-w-sm text-xs text-muted-foreground">
        Click <span className="font-medium">Pair new device</span> above
        and scan the QR code with your phone or tablet to link it to
        your account.
      </p>
    </div>
  );
}

function PlatformIcon({
  platform,
  className,
}: {
  platform: LinkedDevice["platform"];
  className?: string;
}) {
  switch (platform) {
    case "ios":
      return <Apple className={className} />;
    case "android":
      return <Smartphone className={className} />;
    case "web":
      return <Monitor className={className} />;
    default:
      return <Tablet className={className} />;
  }
}

function isOnline(d: LinkedDevice): boolean {
  if (!d.last_seen_at) return false;
  const diff = Date.now() - new Date(d.last_seen_at).getTime();
  return diff < 60_000;
}

function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "just now";
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

/** Stable SSR-friendly date — same string on server and client.
 *  Uses the company date pattern so it matches every other date the
 *  operator sees in the app. */
function formatDate(iso: string, datePattern?: string | null): string {
  return formatCompanyDate(iso, { date_format: datePattern });
}
