"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";
import { AlertTriangle, Camera, Check, ImagePlus, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ScannedCell } from "@/lib/types";

type ScanStatus =
  | { kind: "idle" }
  | { kind: "looking" }
  | { kind: "wrong"; scanned: ScannedCell }
  | { kind: "invalid"; reason: string }
  | { kind: "confirmed" };

interface Props {
  onResult: (cell: ScannedCell) => void;
  onError: (msg: string) => void;
  /** Recommended cell. When present, the scanner requires the operator
   *  to scan THIS exact cell — any other QR is rejected inline. The
   *  operator can override by tapping "Use a different shelf", which
   *  flips the scanner into free-scan mode. */
  expected?: ScannedCell | null;
}

/**
 * Camera scanner with inline verification. The whole point is to keep
 * the operator in the camera flow while the system decides: right
 * shelf → advance; wrong shelf → red flash, stay; not a shelf at all
 * → red flash, stay. Mismatches never escape to a "did you mean…"
 * dialog — the operator either points at the right thing or
 * explicitly switches to override mode.
 */
export function CellScanStep({ onResult, onError, expected }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const [mode, setMode] = useState<"camera" | "file" | "manual">("camera");
  const [status, setStatus] = useState<ScanStatus>({ kind: "idle" });
  const [overriding, setOverriding] = useState(false);
  const [manual, setManual] = useState("");

  // After a wrong-shelf / invalid flash, clear back to "looking" so
  // the operator can try again without a stale red banner.
  useEffect(() => {
    if (status.kind === "wrong" || status.kind === "invalid") {
      const t = setTimeout(
        () => setStatus({ kind: "looking" }),
        2200,
      );
      return () => clearTimeout(t);
    }
  }, [status]);

  const requireMatch = !!expected && !overriding;

  const handle = useCallback(
    async (data: string) => {
      const uuid = extractCellUuid(data);
      if (!uuid) {
        setStatus({ kind: "invalid", reason: "That QR isn't a shelf code." });
        return;
      }

      try {
        const res = await fetch(`/api/m/cells/${encodeURIComponent(uuid)}`);
        if (!res.ok) {
          setStatus({
            kind: "invalid",
            reason: "Shelf not found in this company.",
          });
          return;
        }
        const { cell } = (await res.json()) as { cell: ScannedCell };

        if (requireMatch && cell.uuid !== expected!.uuid) {
          setStatus({ kind: "wrong", scanned: cell });
          return;
        }

        // Match (or override mode) — green flash, then advance.
        setStatus({ kind: "confirmed" });
        scannerRef.current?.stop();
        setTimeout(() => onResult(cell), 350);
      } catch {
        onError("Network error — check your Wi-Fi.");
      }
    },
    [expected, requireMatch, onResult, onError],
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
      setStatus({
        kind: "invalid",
        reason: "Couldn't read a QR from that photo.",
      });
    } finally {
      e.target.value = "";
    }
  }

  return (
    <main className="relative flex flex-1 flex-col bg-black text-white">
      {/* Top hint: what the operator should be doing */}
      <div className="z-10 space-y-1 bg-black/70 px-4 py-3 text-sm">
        {expected && !overriding ? (
          <>
            <p className="text-xs uppercase tracking-wider text-white/70">
              Walk to & scan
            </p>
            <p className="font-semibold leading-tight">
              {formatLocationLabel(expected.storage_location)} ·{" "}
              {expected.name || `Cell ${expected.id}`}
            </p>
            <p className="text-xs text-white/70">
              {expected.warehouse?.name ?? "—"} ·{" "}
              {expected.floor?.name ?? "—"}
            </p>
          </>
        ) : (
          <>
            <p className="text-xs uppercase tracking-wider text-white/70">
              Override scan
            </p>
            <p className="font-semibold leading-tight">
              Scan any shelf&apos;s QR to set as destination
            </p>
          </>
        )}
      </div>

      {/* Camera or fallback */}
      {mode === "camera" && (
        <div className="relative flex-1 overflow-hidden">
          <video
            ref={videoRef}
            className="absolute inset-0 size-full object-cover"
            muted
            playsInline
          />
          {/* Centred scan-area outline so the operator knows where to aim */}
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
            The live viewfinder needs HTTPS or localhost. Snap a photo
            of the QR for now — or type the cell URL.
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
          <button
            type="button"
            onClick={() => setMode("manual")}
            className="text-xs text-white/80 underline underline-offset-2"
          >
            Or type the cell URL
          </button>
        </div>
      )}

      {mode === "manual" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handle(manual.trim());
          }}
          className="flex flex-1 flex-col items-center justify-center gap-3 bg-zinc-900 px-6 py-10 text-center text-white"
        >
          <p className="text-sm font-medium text-white">Type the cell URL</p>
          <Input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="https://…/stock/cells/<uuid>"
            className="bg-white/10 text-white placeholder:text-white/40"
            autoCapitalize="off"
            autoFocus
          />
          <Button type="submit" className="w-full max-w-xs" disabled={!manual.trim()}>
            Continue
          </Button>
        </form>
      )}

      {/* Status banner across the bottom — always visible while
          scanning so the operator knows what the system thinks. */}
      <StatusBanner status={status} expectedName={expected?.name ?? null} />

      {/* Override button — explicit intent to use a different shelf
          than the recommendation. Only visible when there IS an
          expected cell. */}
      {expected && (
        <div className="z-10 border-t border-white/10 bg-black/70 px-4 py-3">
          {!overriding ? (
            <button
              type="button"
              onClick={() => setOverriding(true)}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-white/20 px-3 py-2 text-sm text-white active:bg-white/10"
            >
              <Pencil className="size-4" />
              Use a different shelf instead
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setOverriding(false)}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-white/20 px-3 py-2 text-sm text-white active:bg-white/10"
            >
              <X className="size-4" />
              Back to recommended shelf
            </button>
          )}
        </div>
      )}

      {/* Dev bypass — pretend the operator scanned the expected cell
          so the move flow can roll through without a physical QR.
          Hidden in production builds. Only available when an expected
          cell is set (otherwise there's nothing to bypass to). */}
      {process.env.NODE_ENV !== "production" && expected && !overriding && (
        <div className="z-10 border-t border-amber-500/30 bg-amber-500/15 px-4 py-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-amber-100">
              Dev bypass — skip the physical scan.
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

      {mode === "camera" && (
        <button
          type="button"
          onClick={() => setMode("file")}
          className="absolute right-3 top-20 z-10 rounded-full bg-white/10 p-2 text-white"
          aria-label="Fall back to photo"
          title="Camera not working? Use a photo instead"
        >
          <ImagePlus className="size-4" />
        </button>
      )}
    </main>
  );
}

function StatusBanner({
  status,
  expectedName,
}: {
  status: ScanStatus;
  expectedName: string | null;
}) {
  if (status.kind === "idle") return null;

  if (status.kind === "looking") {
    return (
      <div className="z-10 bg-black/70 px-4 py-3 text-center text-xs text-white/80">
        Point at the QR on the shelf…
      </div>
    );
  }

  if (status.kind === "confirmed") {
    return (
      <div className="z-10 flex items-center justify-center gap-2 bg-emerald-500/90 px-4 py-3 text-sm font-semibold text-emerald-950">
        <Check className="size-4" />
        Confirmed — opening
      </div>
    );
  }

  if (status.kind === "wrong") {
    // Cell names are often empty (operators rely on the rack code +
    // ordinal). Trying to render the scanned cell's name back reads as
    // "You scanned ." — drop that, the headline is enough.
    return (
      <div className="z-10 space-y-1 bg-red-500/90 px-4 py-3 text-sm text-red-50">
        <div className="flex items-center justify-center gap-2 font-semibold">
          <AlertTriangle className="size-4" />
          Wrong QR code
        </div>
        {expectedName && (
          <p className="text-center text-xs text-red-50/90">
            Looking for {expectedName}.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="z-10 bg-red-500/90 px-4 py-3 text-center text-sm font-semibold text-red-50">
      {status.reason}
    </div>
  );
}

function formatLocationLabel(
  loc:
    | { name?: string | null; code?: string | null }
    | null
    | undefined,
): string {
  if (!loc) return "—";
  const name = loc.name?.trim();
  const code = loc.code?.trim();
  if (name && code) return `${name} · ${code}`;
  return name || code || "—";
}

function extractCellUuid(raw: string): string | null {
  if (!raw) return null;
  let path: string;
  try {
    path = new URL(raw).pathname;
  } catch {
    path = raw.startsWith("/") ? raw : `/${raw}`;
  }
  const m = path.match(/\/stock\/cells\/([0-9a-fA-F-]{36})/);
  if (m?.[1]) return m[1];
  if (/^[0-9a-fA-F-]{36}$/.test(raw.trim())) return raw.trim();
  return null;
}
