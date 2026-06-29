"use client";

import {
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import {
  ArrowRight,
  Copy,
  Loader2,
  Smartphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  listMyDevicesAction,
  pushNavigateToDeviceAction,
  pushNavigateToMyDevicesAction,
} from "@/lib/devices/actions";
import type { LinkedDevice } from "@/lib/types";

// Match the project-board copy: 90 s window is long enough for a phone
// with the screen briefly off to still count as online.
const DEVICE_ONLINE_WINDOW_MS = 90_000;

function deviceOnline(d: LinkedDevice): boolean {
  if (!d.last_seen_at) return false;
  const seen = Date.parse(d.last_seen_at);
  if (Number.isNaN(seen)) return false;
  return Date.now() - seen < DEVICE_ONLINE_WINDOW_MS;
}

interface Props {
  /** Where the phone should land, e.g. "/m/inspections/<uuid>". */
  path: string;
  /** Title shown at the top of the dialog. */
  title?: string;
  /** Sub-headline beneath the title. */
  description?: string;
  /** Visible button label that triggers the modal. */
  buttonLabel?: string;
  /** Passed straight through to the trigger Button. */
  buttonProps?: Omit<ComponentProps<typeof Button>, "onClick" | "children">;
  /** Optional leading icon inside the trigger button. */
  buttonIcon?: ReactNode;
}

/**
 * Reusable "Send this page to a paired phone" button + dialog. Pulls
 * the user's paired devices, shows one row per device with a green dot
 * + Send button when online, plus a QR-code fallback so an unpaired
 * phone can still scan. Wraps the existing pushNavigateToMyDevices /
 * pushNavigateToDevice actions so the BE rules (path must start with
 * /m/) apply uniformly.
 *
 * Lives at the component level so any desktop page that wants to hand
 * off to a phone (project board, inspection detail, etc.) can drop it
 * in with one line.
 */
export function SendToDeviceButton({
  path,
  title = "Send to device",
  description = "Push this page to a paired phone — it jumps there instantly. Or scan the QR with an unpaired device.",
  buttonLabel = "Send to my phone",
  buttonProps,
  buttonIcon = <Smartphone className="size-4" />,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button {...buttonProps} onClick={() => setOpen(true)}>
        {buttonIcon}
        {buttonLabel}
      </Button>
      <SendToDeviceDialog
        open={open}
        onClose={() => setOpen(false)}
        path={path}
        title={title}
        description={description}
      />
    </>
  );
}

function SendToDeviceDialog({
  open,
  onClose,
  path,
  title,
  description,
}: {
  open: boolean;
  onClose: () => void;
  path: string;
  title: string;
  description: string;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [devices, setDevices] = useState<LinkedDevice[] | null>(null);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [pushingUuid, setPushingUuid] = useState<string | null>(null);
  const [pushingAll, setPushingAll] = useState(false);

  // Resolve the QR's absolute URL on the client so a scanned phone
  // hits the same dev/prod host as the desktop session.
  const url = useMemo(() => {
    if (!path) return "";
    if (typeof window === "undefined") return path;
    return `${window.location.protocol}//${window.location.host}${path}`;
  }, [path]);

  useEffect(() => {
    if (!open || !url) {
      setDataUrl(null);
      return;
    }
    void QRCode.toDataURL(url, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 256,
    }).then(setDataUrl);
  }, [open, url]);

  useEffect(() => {
    if (!open) {
      setDevices(null);
      setPushingUuid(null);
      setPushingAll(false);
      return;
    }
    setDevicesLoading(true);
    void listMyDevicesAction().then((res) => {
      setDevicesLoading(false);
      if (res.ok) setDevices(res.devices);
      else setDevices([]);
    });
  }, [open]);

  function copy() {
    if (!url) return;
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  async function pushOne(device: LinkedDevice) {
    setPushingUuid(device.uuid);
    const res = await pushNavigateToDeviceAction(device.uuid, path);
    setPushingUuid(null);
    if (res.ok) {
      toast.success(`Opened on ${device.label || "your device"}`);
      onClose();
    } else {
      toast.error(res.detail || "Couldn't push to that device.");
    }
  }

  async function pushAll() {
    setPushingAll(true);
    const res = await pushNavigateToMyDevicesAction(path);
    setPushingAll(false);
    if (res.ok) {
      const count = res.pushed_to.length;
      if (count === 0) {
        toast.error("No paired devices. Scan the QR with your phone instead.");
        return;
      }
      const label =
        count === 1
          ? `Opened on ${res.pushed_to[0]?.label || "your device"}`
          : `Opened on ${count} devices`;
      toast.success(label);
      onClose();
    } else {
      toast.error(res.detail || "Couldn't push to your devices.");
    }
  }

  const onlineDevices = (devices ?? []).filter(deviceOnline);
  const offlineDevices = (devices ?? []).filter((d) => !deviceOnline(d));
  const hasPaired = (devices?.length ?? 0) > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="size-4 text-muted-foreground" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <span>Your devices</span>
            {onlineDevices.length > 1 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[11px]"
                onClick={pushAll}
                disabled={pushingAll || !!pushingUuid}
              >
                {pushingAll ? (
                  <Loader2 className="mr-1 size-3 animate-spin" />
                ) : (
                  <ArrowRight className="mr-1 size-3" />
                )}
                Send to all {onlineDevices.length}
              </Button>
            )}
          </div>
          {devicesLoading ? (
            <Skeleton className="h-12 w-full rounded-md" />
          ) : hasPaired ? (
            <div className="space-y-1.5">
              {onlineDevices.map((d) => (
                <DeviceRow
                  key={d.uuid}
                  device={d}
                  online
                  busy={pushingUuid === d.uuid}
                  disabled={pushingAll || (!!pushingUuid && pushingUuid !== d.uuid)}
                  onPush={() => pushOne(d)}
                />
              ))}
              {offlineDevices.map((d) => (
                <DeviceRow
                  key={d.uuid}
                  device={d}
                  online={false}
                  busy={pushingUuid === d.uuid}
                  disabled={pushingAll || !!pushingUuid}
                  onPush={() => pushOne(d)}
                />
              ))}
            </div>
          ) : (
            <p className="rounded-md bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground">
              No paired devices yet. Pair a phone from{" "}
              <Link
                href="/settings/devices"
                className="text-brand underline-offset-2 hover:underline"
              >
                Settings → Devices
              </Link>{" "}
              for one-tap handoff next time.
            </p>
          )}
        </div>

        <div className="space-y-2 border-t border-border/60 pt-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Or scan with another phone
          </div>
          <div className="flex flex-col items-center gap-3">
            {dataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={dataUrl}
                alt="QR code"
                className="size-44 rounded-md border border-border/40 bg-white p-2"
              />
            ) : (
              <Skeleton className="size-44 rounded-md" />
            )}
            <code className="w-full break-all rounded-md bg-muted/40 px-2 py-1.5 text-center text-[10px]">
              {url}
            </code>
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button size="sm" variant="outline" onClick={copy}>
            <Copy className="mr-1.5 size-3.5" />
            {copied ? "Copied" : "Copy link"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeviceRow({
  device,
  online,
  busy,
  disabled,
  onPush,
}: {
  device: LinkedDevice;
  online: boolean;
  busy: boolean;
  disabled: boolean;
  onPush: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "inline-block size-2 shrink-0 rounded-full",
            online ? "bg-emerald-500" : "bg-muted-foreground/40",
          )}
          aria-hidden
        />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium leading-tight">
            {device.label || "Unnamed device"}
          </div>
          <div className="truncate text-[10px] text-muted-foreground">
            {device.platform ?? "device"} ·{" "}
            {online ? "online" : "offline"}
          </div>
        </div>
      </div>
      <Button
        size="sm"
        variant={online ? "default" : "outline"}
        onClick={onPush}
        disabled={busy || disabled}
        className="h-8 shrink-0"
      >
        {busy ? (
          <Loader2 className="mr-1 size-3.5 animate-spin" />
        ) : (
          <ArrowRight className="mr-1 size-3.5" />
        )}
        Send
      </Button>
    </div>
  );
}
