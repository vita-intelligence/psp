"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSocket } from "@/lib/realtime/socket";

// Mirror of `BackendWeb.PrintBridgeController` payload shape. Loose
// typing on `payload` because each `kind` carries its own object —
// the dispatch switch narrows it.
type PrintBridgeEvent =
  | {
      kind: "quarantine_pack";
      payload: QuarantinePackPayload;
      actor: { uuid: string; name: string };
    }
  | {
      kind: "stock_lot";
      payload: StockLotPayload;
      actor: { uuid: string; name: string };
    }
  | {
      kind: "three_pl_dispatch";
      payload: ThreePlDispatchPayload;
      actor: { uuid: string; name: string };
    };

interface ThreePlDispatchPayload {
  dispatch_uuid: string;
  customer_name: string | null;
  item_name: string | null;
  lot_code: string | null;
  qty: string;
  uom_symbol: string | null;
  reference: string | null;
}

interface QuarantinePackPayload {
  inspection_uuid: string;
  line_uuid: string;
  pack_index: number;
  pack_count: number;
  item_name: string;
  qty: string;
  uom_symbol: string | null;
  supplier_batch_no: string | null;
}

interface StockLotPayload {
  lot_uuid: string;
  lot_code: string;
  item_name: string;
  qty: string;
  uom_symbol: string | null;
  supplier_batch_no: string | null;
}

interface ViewerLite {
  uuid: string;
}

interface Props {
  viewer: ViewerLite | null;
}

/**
 * Subscribes the laptop session to its own `user:<uuid>` Phoenix
 * channel so the phone-driven print bridge can pop a print dialog
 * here. No-op when there's no session (login / pair / public pages)
 * or when running inside the mobile shell (the operator wouldn't
 * print to their own phone).
 *
 * Mounted once in the root layout — the live socket connection
 * survives client-side navigations.
 */
export function PrintBridgeListener({ viewer }: Props) {
  const [event, setEvent] = useState<PrintBridgeEvent | null>(null);
  const channelRef = useRef<{ leave: () => void } | null>(null);

  useEffect(() => {
    if (!viewer?.uuid) return;
    if (typeof window === "undefined") return;
    // Don't open a duplicate user channel from the phone — the device
    // socket isn't authenticated against `current_user` in the same
    // way and we want the bridge to live on the laptop session only.
    if (window.location.pathname.startsWith("/m")) return;

    let cancelled = false;

    (async () => {
      const socket = await getSocket();
      if (!socket || cancelled) return;

      const channel = socket.channel(`user:${viewer.uuid}`, {});
      channel.on("print_label", (raw: PrintBridgeEvent) => {
        setEvent(raw);
      });
      channel.join();
      channelRef.current = channel;
    })();

    return () => {
      cancelled = true;
      channelRef.current?.leave();
      channelRef.current = null;
    };
  }, [viewer?.uuid]);

  const handleClose = useCallback((open: boolean) => {
    if (!open) setEvent(null);
  }, []);

  if (!event) return null;
  if (event.kind === "stock_lot") {
    return <StockLotLabelDialog event={event} onOpenChange={handleClose} />;
  }
  if (event.kind === "three_pl_dispatch") {
    return <ThreePlLabelDialog event={event} onOpenChange={handleClose} />;
  }
  return <QuarantineLabelDialog event={event} onOpenChange={handleClose} />;
}

function ThreePlLabelDialog({
  event,
  onOpenChange,
}: {
  event: Extract<PrintBridgeEvent, { kind: "three_pl_dispatch" }>;
  onOpenChange: (open: boolean) => void;
}) {
  const [copiesText, setCopiesText] = useState("1");
  const { payload, actor } = event;

  function onPrint(e: React.FormEvent) {
    e.preventDefault();
    const n = parseInt(copiesText, 10);
    const copies = Number.isFinite(n) ? Math.max(1, Math.min(100, n)) : 1;
    const params = new URLSearchParams({ copies: String(copies) });
    const url =
      `/api/three-pl/dispatches/${encodeURIComponent(payload.dispatch_uuid)}` +
      `/label.pdf?${params.toString()}`;
    window.open(url, "_blank", "noopener");
    onOpenChange(false);
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="size-4 text-brand" />
            Print 3PL order label
          </DialogTitle>
          <DialogDescription>
            From <span className="font-medium">{actor.name}</span> on the
            phone. Sticks on the parcel + follows it through Paperwork /
            Pickup / Return — a scan opens the current stage on any
            paired phone.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Customer
          </p>
          <p className="font-medium">{payload.customer_name ?? "—"}</p>
          <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Order
          </p>
          <p>
            <span className="font-mono">{payload.qty}</span>
            {payload.uom_symbol ? ` ${payload.uom_symbol}` : ""} ·{" "}
            {payload.item_name ?? "—"}
          </p>
          {(payload.lot_code || payload.reference) && (
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {[payload.lot_code, payload.reference]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </div>

        <form onSubmit={onPrint} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="three-pl-copies">Copies</Label>
            <Input
              id="three-pl-copies"
              type="number"
              inputMode="numeric"
              min={1}
              max={100}
              step={1}
              value={copiesText}
              onChange={(e) => setCopiesText(e.target.value)}
              onBlur={(e) => {
                const n = parseInt(e.target.value, 10);
                const clamped = Number.isFinite(n)
                  ? Math.max(1, Math.min(100, n))
                  : 1;
                setCopiesText(String(clamped));
              }}
              autoFocus
              className="h-11 text-lg"
            />
          </div>

          <DialogFooter className="sm:justify-stretch">
            <Button type="submit" size="lg" className="w-full">
              <Printer className="mr-1.5 size-4" />
              Print
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function QuarantineLabelDialog({
  event,
  onOpenChange,
}: {
  event: Extract<PrintBridgeEvent, { kind: "quarantine_pack" }>;
  onOpenChange: (open: boolean) => void;
}) {
  const [copiesText, setCopiesText] = useState("1");
  const { payload, actor } = event;

  function onPrint(e: React.FormEvent) {
    e.preventDefault();
    const n = parseInt(copiesText, 10);
    const copies = Number.isFinite(n) ? Math.max(1, Math.min(100, n)) : 1;
    const params = new URLSearchParams({
      line_uuid: payload.line_uuid,
      pack_index: String(payload.pack_index),
      copies: String(copies),
    });
    const url =
      `/api/m/inspections/${encodeURIComponent(payload.inspection_uuid)}` +
      `/quarantine-label.pdf?${params.toString()}`;
    window.open(url, "_blank", "noopener");
    onOpenChange(false);
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="size-4 text-brand" />
            Print quarantine label
          </DialogTitle>
          <DialogDescription>
            From <span className="font-medium">{actor.name}</span> on the
            phone. How many labels do you want to print?
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm">
          <p className="font-medium">{payload.item_name}</p>
          <p className="text-xs text-muted-foreground">
            Pack {payload.pack_index + 1} of {payload.pack_count} ·{" "}
            <span className="font-mono">{payload.qty}</span>
            {payload.uom_symbol ? ` ${payload.uom_symbol}` : ""}
          </p>
          {payload.supplier_batch_no && (
            <p className="font-mono text-xs text-muted-foreground">
              Batch {payload.supplier_batch_no}
            </p>
          )}
        </div>

        <form onSubmit={onPrint} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="quarantine-copies">Copies</Label>
            <Input
              id="quarantine-copies"
              type="number"
              inputMode="numeric"
              min={1}
              max={100}
              step={1}
              value={copiesText}
              onChange={(e) => setCopiesText(e.target.value)}
              onBlur={(e) => {
                const n = parseInt(e.target.value, 10);
                const clamped = Number.isFinite(n)
                  ? Math.max(1, Math.min(100, n))
                  : 1;
                setCopiesText(String(clamped));
              }}
              autoFocus
              className="h-11 text-lg"
            />
          </div>

          <DialogFooter className="sm:justify-stretch">
            <Button type="submit" size="lg" className="w-full">
              <Printer className="mr-1.5 size-4" />
              Print
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}


// Regular stock-lot label — mirrors `QuarantineLabelDialog` above,
// but points at `/api/stock/lots/[uuid]/label.pdf` (the same endpoint
// the desktop "print label" affordance uses everywhere else) so the
// output is the standard Zebra/Brother 100×60mm sticker instead of
// the quarantine variant.
function StockLotLabelDialog({
  event,
  onOpenChange,
}: {
  event: Extract<PrintBridgeEvent, { kind: "stock_lot" }>;
  onOpenChange: (open: boolean) => void;
}) {
  const [copiesText, setCopiesText] = useState("1");
  const { payload, actor } = event;

  function onPrint(e: React.FormEvent) {
    e.preventDefault();
    const n = parseInt(copiesText, 10);
    const copies = Number.isFinite(n) ? Math.max(1, Math.min(100, n)) : 1;
    const params = new URLSearchParams({ copies: String(copies) });
    const url =
      `/api/stock/lots/${encodeURIComponent(payload.lot_uuid)}` +
      `/label.pdf?${params.toString()}`;
    window.open(url, "_blank", "noopener");
    onOpenChange(false);
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="size-4 text-brand" />
            Print lot label
          </DialogTitle>
          <DialogDescription>
            From <span className="font-medium">{actor.name}</span> on the
            phone. How many labels do you want to print?
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm">
          <p className="font-medium">{payload.item_name}</p>
          <p className="text-xs text-muted-foreground">
            <span className="font-mono">{payload.lot_code}</span>
            {" · "}
            <span className="font-mono">{payload.qty}</span>
            {payload.uom_symbol ? ` ${payload.uom_symbol}` : ""}
          </p>
          {payload.supplier_batch_no && (
            <p className="font-mono text-xs text-muted-foreground">
              Batch {payload.supplier_batch_no}
            </p>
          )}
        </div>

        <form onSubmit={onPrint} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="stock-lot-copies">Copies</Label>
            <Input
              id="stock-lot-copies"
              type="number"
              inputMode="numeric"
              min={1}
              max={100}
              step={1}
              value={copiesText}
              onChange={(e) => setCopiesText(e.target.value)}
              onBlur={(e) => {
                const n = parseInt(e.target.value, 10);
                const clamped = Number.isFinite(n)
                  ? Math.max(1, Math.min(100, n))
                  : 1;
                setCopiesText(String(clamped));
              }}
              autoFocus
              className="h-11 text-lg"
            />
          </div>

          <DialogFooter className="sm:justify-stretch">
            <Button type="submit" size="lg" className="w-full">
              <Printer className="mr-1.5 size-4" />
              Print
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
