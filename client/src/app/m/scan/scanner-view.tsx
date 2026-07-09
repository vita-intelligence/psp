"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Camera, ImagePlus, Keyboard, X } from "lucide-react";
import QrScanner from "qr-scanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Mode = "camera" | "file" | "manual";

/**
 * QR scanner — live camera viewfinder when available, file capture
 * fallback when not. `qr-scanner` needs `getUserMedia` which is gated
 * to secure contexts in browsers (HTTPS or `localhost`). On plain-HTTP
 * LAN dev the live camera path will throw; we catch that and silently
 * switch to the file-capture path so phone testing still works.
 *
 * Both paths feed into `routeFromUrl()` which extracts the entity uuid
 * from the QR's URL payload and routes the operator to the matching
 * mobile page.
 */
export function ScannerView() {
  const router = useRouter();
  const params = useSearchParams();
  // `?to=<cell_uuid>` is set when the worker arrived via the
  // scan-cell-first flow ("Scan a lot to move here" on the cell
  // page). Carries through so the lot scan jumps straight into the
  // move flow with that cell pre-set as the destination.
  const destinationCellUuid = params.get("to");
  const [mode, setMode] = useState<Mode>("camera");
  const [error, setError] = useState<string | null>(null);
  const [manualValue, setManualValue] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerRef = useRef<QrScanner | null>(null);

  const handleResult = useCallback(
    (value: string) => {
      const dest = routeFromUrl(value, destinationCellUuid);
      if (!dest) {
        setError("Unrecognised QR. Expecting a stock lot or storage cell URL.");
        return;
      }
      scannerRef.current?.stop();
      router.replace(dest);
    },
    [router, destinationCellUuid],
  );

  // Start live camera scanner on mount; if it throws (HTTP LAN dev,
  // permission denied), fall back to the file capture mode.
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

        const scanner = new QrScanner(
          el,
          (res) => handleResult(res.data),
          {
            highlightScanRegion: true,
            highlightCodeOutline: true,
            preferredCamera: "environment",
          },
        );
        scannerRef.current = scanner;
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
  }, [mode, handleResult]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    try {
      const res = await QrScanner.scanImage(f, { returnDetailedScanResult: true });
      handleResult(res.data);
    } catch {
      setError("Couldn't read a QR code from that photo. Try again.");
    } finally {
      e.target.value = "";
    }
  }

  function onManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    handleResult(manualValue.trim());
  }

  return (
    <div className="relative flex min-h-dvh flex-col bg-black text-white">
      <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-black/60 px-4 py-3 backdrop-blur">
        <Link href="/m" className="rounded-md p-1.5 active:bg-white/10">
          <X className="size-5" />
        </Link>
        <span className="text-sm font-medium">Scan QR</span>
        <div className="size-7" />
      </header>

      {mode === "camera" && (
        <div className="flex-1">
          <video
            ref={videoRef}
            className="absolute inset-0 size-full object-cover"
            muted
            playsInline
          />
        </div>
      )}

      {mode === "file" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <Camera className="size-10 text-white/70" />
          <p className="text-base font-medium">Camera unavailable</p>
          <p className="text-sm text-white/70">
            Take a photo of the QR code and pick it from your library.
          </p>
          <label className="cursor-pointer rounded-md bg-white px-4 py-2 text-sm font-medium text-black">
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

      {mode === "manual" && (
        <form
          onSubmit={onManualSubmit}
          className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center"
        >
          <Keyboard className="size-10 text-white/70" />
          <p className="text-base font-medium">Enter code manually</p>
          <p className="text-sm text-white/70">
            Paste the URL or scan target — we&apos;ll route from there.
          </p>
          <Input
            value={manualValue}
            onChange={(e) => setManualValue(e.target.value)}
            placeholder="https://…/stock/lots/<uuid> or /production/machines/<uuid>"
            className="bg-white/10 text-white placeholder:text-white/40"
            autoFocus
            inputMode="text"
            autoCapitalize="off"
          />
          <Button type="submit" className="w-full max-w-xs" disabled={!manualValue.trim()}>
            Continue
          </Button>
        </form>
      )}

      <footer className="absolute inset-x-0 bottom-0 z-10 space-y-2 bg-gradient-to-t from-black/80 px-4 py-4">
        {error && (
          <div className="rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-center text-sm">
            {error}
          </div>
        )}
        <div className="flex justify-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setMode("camera")}
            className={`rounded-full px-3 py-1.5 ${mode === "camera" ? "bg-white text-black" : "bg-white/10 text-white"}`}
          >
            Camera
          </button>
          <button
            type="button"
            onClick={() => setMode("file")}
            className={`rounded-full px-3 py-1.5 ${mode === "file" ? "bg-white text-black" : "bg-white/10 text-white"}`}
          >
            Photo
          </button>
          <button
            type="button"
            onClick={() => setMode("manual")}
            className={`rounded-full px-3 py-1.5 ${mode === "manual" ? "bg-white text-black" : "bg-white/10 text-white"}`}
          >
            Type
          </button>
        </div>
      </footer>
    </div>
  );
}

/** Map a QR payload to a mobile route. Accepts full URLs or path-only
 *  shapes so we tolerate both the "real URL" QRs and any future
 *  shorter encodings. Returns null if the shape isn't recognised.
 *
 *  When `destinationCellUuid` is supplied, a lot scan routes straight
 *  into the move flow with that cell pre-set as the destination —
 *  this is the scan-cell-first put-away path. */
function routeFromUrl(
  raw: string,
  destinationCellUuid: string | null,
): string | null {
  if (!raw) return null;
  let path: string;
  try {
    path = new URL(raw).pathname;
  } catch {
    path = raw.startsWith("/") ? raw : `/${raw}`;
  }
  const lotMatch = path.match(/\/stock\/lots\/([^/]+)/);
  if (lotMatch?.[1]) {
    const uuid = encodeURIComponent(lotMatch[1]);
    if (destinationCellUuid) {
      return `/m/lots/${uuid}/move?to=${encodeURIComponent(destinationCellUuid)}`;
    }
    return `/m/lots/${uuid}`;
  }
  const cellMatch = path.match(/\/stock\/cells\/([^/]+)/);
  if (cellMatch?.[1]) return `/m/scan/cell/${encodeURIComponent(cellMatch[1])}`;
  const machineMatch = path.match(/\/production\/machines\/([^/]+)/);
  if (machineMatch?.[1])
    return `/m/machines/${encodeURIComponent(machineMatch[1])}`;
  return null;
}
