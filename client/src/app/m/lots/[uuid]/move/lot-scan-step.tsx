"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";
import { Camera, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StockLot } from "@/lib/types";

type ScanStatus =
  | { kind: "idle" }
  | { kind: "looking" }
  | { kind: "wrong"; scanned: StockLot }
  | { kind: "invalid"; reason: string }
  | { kind: "confirmed" };

interface Props {
  /** The lot the operator THOUGHT they tapped on the home page. The
   *  scanner accepts only this exact lot's QR — any other scan is
   *  flashed red and the camera stays open. */
  expected: StockLot;
  onResult: (lot: StockLot) => void;
  onError: (msg: string) => void;
  /** Operator explicitly skips the verify step (e.g. damaged QR
   *  label). Movements created downstream carry an audit flag. */
  onOverride: () => void;
}

/**
 * First step in the put-away flow: confirm the operator is actually
 * holding the lot they tapped on the pending list. Same camera +
 * mismatch UI as `CellScanStep` so the visual model is consistent.
 *
 * Why this step exists: tapping a card in "Pending put-away" is just
 * navigation — the worker could easily grab the wrong drum from a
 * receiving dock and start walking. Scanning the lot's QR first
 * blocks that whole class of mistake before any movement is recorded.
 */
export function LotScanStep({ expected, onResult, onError, onOverride }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const [mode, setMode] = useState<"camera" | "file">("camera");
  const [status, setStatus] = useState<ScanStatus>({ kind: "idle" });

  useEffect(() => {
    if (status.kind === "wrong" || status.kind === "invalid") {
      const t = setTimeout(() => setStatus({ kind: "looking" }), 2200);
      return () => clearTimeout(t);
    }
  }, [status]);

  const handle = useCallback(
    async (data: string) => {
      const uuid = extractLotUuid(data);
      if (!uuid) {
        setStatus({ kind: "invalid", reason: "That QR isn't a lot code." });
        return;
      }

      try {
        const res = await fetch(`/api/m/lots/${encodeURIComponent(uuid)}`);
        if (!res.ok) {
          setStatus({ kind: "invalid", reason: "Lot not found in this company." });
          return;
        }
        const { lot } = (await res.json()) as { lot: StockLot };

        if (lot.uuid !== expected.uuid) {
          setStatus({ kind: "wrong", scanned: lot });
          return;
        }

        setStatus({ kind: "confirmed" });
        scannerRef.current?.stop();
        setTimeout(() => onResult(lot), 350);
      } catch {
        onError("Network error — check your Wi-Fi.");
      }
    },
    [expected, onResult, onError],
  );

  useEffect(() => {
    if (mode !== "camera") return;
    const el = videoRef.current;
    if (!el) return;
    let cancelled = false;

    (async () => {
      try {
        const hasCamera = await QrScanner.hasCamera();
        if (!hasCamera) {
          setMode("file");
          return;
        }
        const scanner = new QrScanner(el, (r) => void handle(r.data), {
          highlightScanRegion: false,
          highlightCodeOutline: true,
          preferredCamera: "environment",
        });
        scannerRef.current = scanner;
        setStatus({ kind: "looking" });
        await scanner.start();
        if (cancelled) scanner.stop();
      } catch {
        if (!cancelled) setMode("file");
      }
    })();

    return () => {
      cancelled = true;
      scannerRef.current?.stop();
      scannerRef.current?.destroy();
      scannerRef.current = null;
    };
  }, [mode, handle]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const res = await QrScanner.scanImage(f, { returnDetailedScanResult: true });
      await handle(res.data);
    } catch {
      setStatus({ kind: "invalid", reason: "Couldn't read a QR from that photo." });
    } finally {
      e.target.value = "";
    }
  }

  const expectedLine =
    expected.code ??
    (typeof expected.id === "number" ? `Lot #${expected.id}` : "—");

  return (
    <main className="relative flex flex-1 flex-col bg-black text-white">
      <div className="z-10 space-y-1 bg-black/70 px-4 py-3 text-sm">
        <p className="text-xs uppercase tracking-wider text-white/70">
          Scan the lot you&apos;re holding
        </p>
        <p className="font-semibold leading-tight">
          {expectedLine} · {expected.item?.name ?? "—"}
        </p>
        <p className="text-xs text-white/70">
          The QR label on the drum / sack must match this code.
        </p>
      </div>

      {mode === "camera" && (
        <div className="relative flex-1 overflow-hidden">
          <video
            ref={videoRef}
            className="absolute inset-0 size-full object-cover"
            muted
            playsInline
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div
              className={`size-56 rounded-3xl border-4 transition-colors ${
                status.kind === "confirmed"
                  ? "border-emerald-400"
                  : status.kind === "wrong" || status.kind === "invalid"
                    ? "border-red-400"
                    : "border-white/80"
              }`}
            />
          </div>
        </div>
      )}

      {mode === "file" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-zinc-900 px-6 py-10 text-center text-white">
          <Camera className="size-10 text-white/70" />
          <p className="text-base font-medium text-white">Camera unavailable</p>
          <p className="text-xs text-white/70">
            Snap a photo of the QR for now.
          </p>
          <label className="cursor-pointer rounded-md bg-white px-4 py-2 text-sm font-medium text-black shadow">
            <ImagePlus className="mr-1.5 inline size-4" />
            Pick a photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onFile}
              className="hidden"
            />
          </label>
        </div>
      )}

      <footer className="space-y-2 bg-black/80 px-4 py-3">
        {status.kind === "wrong" && (
          <p
            role="alert"
            className="rounded-md bg-red-500/20 px-3 py-2 text-sm font-medium text-red-200"
          >
            That&apos;s {status.scanned.code ?? `Lot #${status.scanned.id}`}
            {status.scanned.item?.name ? ` (${status.scanned.item.name})` : ""}
            . You opened {expectedLine}. Try the other drum or override.
          </p>
        )}
        {status.kind === "invalid" && (
          <p
            role="alert"
            className="rounded-md bg-red-500/20 px-3 py-2 text-sm font-medium text-red-200"
          >
            {status.reason}
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          className="h-12 w-full bg-transparent text-white"
          onClick={onOverride}
        >
          Can&apos;t scan the lot — proceed anyway
        </Button>

        {process.env.NODE_ENV !== "production" && (
          <div className="rounded-lg border border-dashed border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-amber-300">
              Dev bypass
            </p>
            <div className="mt-1 flex items-center justify-between gap-2">
              <p className="text-[11px] text-white/70">
                Skip the physical scan and pretend the lot matched.
                Hidden in production builds.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="shrink-0 bg-transparent text-white"
                onClick={() => {
                  setStatus({ kind: "confirmed" });
                  scannerRef.current?.stop();
                  setTimeout(() => onResult(expected), 200);
                }}
              >
                Skip scan
              </Button>
            </div>
          </div>
        )}
      </footer>
    </main>
  );
}

/** Pulls a lot uuid out of whatever the QR encodes — full URLs from
 *  the printed label (`https://.../m/lots/<uuid>` or
 *  `/stock/lots/<uuid>`) and bare UUIDs both work. */
function extractLotUuid(raw: string): string | null {
  if (!raw) return null;
  let path: string;
  try {
    path = new URL(raw).pathname;
  } catch {
    path = raw.startsWith("/") ? raw : `/${raw}`;
  }
  const m =
    path.match(/\/stock\/lots\/([0-9a-fA-F-]{36})/) ??
    path.match(/\/m\/lots\/([0-9a-fA-F-]{36})/);
  if (m?.[1]) return m[1];
  if (/^[0-9a-fA-F-]{36}$/.test(raw.trim())) return raw.trim();
  return null;
}
