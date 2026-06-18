"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";
import { Camera, ImagePlus, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ScanStatus =
  | { kind: "idle" }
  | { kind: "looking" }
  | { kind: "wrong"; scanned: string }
  | { kind: "invalid"; reason: string }
  | { kind: "confirmed" };

interface Props {
  /** UUID that the scanned QR must match. */
  expectedUuid: string;
  /** Which kind of label is expected — drives URL parsing + copy. */
  kind: "lot" | "cell";
  /** Human-readable label shown above the camera (lot code, cell
   *  breadcrumb) so the operator can compare against the physical tag. */
  expectedLabel: string;
  onConfirmed: () => void;
  onCancel: () => void;
}

/**
 * Minimal QR scanner with inline verification. Mirrors the canonical
 * `LotScanStep` / `CellScanStep` UX without taking on their dependency
 * on the full lot / cell payload — pickup mark-picked validation
 * happens server-side via `mark_booking_picked`, so the FE just needs
 * to confirm the operator scanned the right UUID before posting.
 */
export function UuidScanStep({
  expectedUuid,
  kind,
  expectedLabel,
  onConfirmed,
  onCancel,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const [mode, setMode] = useState<"camera" | "file" | "manual">("camera");
  const [status, setStatus] = useState<ScanStatus>({ kind: "idle" });
  const [manual, setManual] = useState("");

  useEffect(() => {
    if (status.kind === "wrong" || status.kind === "invalid") {
      const t = setTimeout(() => setStatus({ kind: "looking" }), 2200);
      return () => clearTimeout(t);
    }
  }, [status]);

  const handle = useCallback(
    (data: string) => {
      const uuid = kind === "lot" ? extractLotUuid(data) : extractCellUuid(data);
      if (!uuid) {
        setStatus({
          kind: "invalid",
          reason:
            kind === "lot"
              ? "That QR isn't a lot code."
              : "That QR isn't a cell code.",
        });
        return;
      }
      if (uuid !== expectedUuid) {
        setStatus({ kind: "wrong", scanned: uuid });
        return;
      }
      setStatus({ kind: "confirmed" });
      scannerRef.current?.stop();
      setTimeout(() => onConfirmed(), 350);
    },
    [expectedUuid, kind, onConfirmed],
  );

  useEffect(() => {
    if (mode !== "camera") return;
    const el = videoRef.current;
    if (!el) return;
    let cancelled = false;

    (async () => {
      try {
        const hasCamera = await QrScanner.hasCamera();
        if (!hasCamera || cancelled) {
          setMode("file");
          return;
        }
        const scanner = new QrScanner(
          el,
          (r) => handle(r.data),
          {
            preferredCamera: "environment",
            highlightScanRegion: true,
            highlightCodeOutline: true,
          },
        );
        scannerRef.current = scanner;
        await scanner.start();
        if (cancelled) {
          scanner.stop();
          return;
        }
        setStatus({ kind: "looking" });
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

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    QrScanner.scanImage(file, { returnDetailedScanResult: true })
      .then((r) => handle(r.data))
      .catch(() =>
        setStatus({ kind: "invalid", reason: "Couldn't read the photo." }),
      );
  }

  function submitManual() {
    if (manual.trim().length === 0) return;
    handle(manual.trim());
  }

  const heading = kind === "lot" ? "Scan the lot label" : "Scan the cell label";

  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-muted px-3 py-2">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Expected {kind}
        </p>
        <p className="text-sm font-medium">{expectedLabel}</p>
      </div>

      <div className="relative overflow-hidden rounded-xl border border-border/60 bg-black">
        {mode === "camera" ? (
          <video
            ref={videoRef}
            className="aspect-square w-full object-cover"
            muted
            playsInline
          />
        ) : mode === "file" ? (
          <div className="grid aspect-square w-full place-items-center bg-muted text-muted-foreground">
            <label className="flex cursor-pointer flex-col items-center gap-2 text-xs">
              <ImagePlus className="size-6" />
              <span>Pick a photo of the QR</span>
              <input
                type="file"
                accept="image/*"
                onChange={onFile}
                className="hidden"
              />
            </label>
          </div>
        ) : (
          <div className="grid aspect-square w-full place-items-center bg-muted px-4 text-sm">
            <div className="w-full space-y-3">
              <p className="text-xs text-muted-foreground">
                Type the {kind} UUID from the label
              </p>
              <Input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder={
                  kind === "lot"
                    ? "00000000-0000-0000-0000-..."
                    : "00000000-0000-0000-0000-..."
                }
                className="h-11 font-mono text-xs"
              />
              <Button
                type="button"
                className="w-full"
                onClick={submitManual}
                disabled={manual.trim().length === 0}
              >
                Submit
              </Button>
            </div>
          </div>
        )}

        {status.kind === "wrong" && (
          <div className="absolute inset-x-0 bottom-0 bg-red-600/95 px-3 py-2 text-center text-xs font-semibold text-white">
            Wrong {kind} — try again
          </div>
        )}
        {status.kind === "invalid" && (
          <div className="absolute inset-x-0 bottom-0 bg-red-600/95 px-3 py-2 text-center text-xs font-semibold text-white">
            {status.reason}
          </div>
        )}
        {status.kind === "confirmed" && (
          <div className="absolute inset-x-0 bottom-0 bg-emerald-600/95 px-3 py-2 text-center text-xs font-semibold text-white">
            Matched
          </div>
        )}
      </div>

      <h2 className="text-sm font-semibold">{heading}</h2>

      <div className="flex flex-wrap items-center gap-2">
        {mode !== "camera" && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setMode("camera")}
          >
            <Camera className="mr-1.5 size-3.5" />
            Use camera
          </Button>
        )}
        {mode !== "file" && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setMode("file")}
          >
            <ImagePlus className="mr-1.5 size-3.5" />
            From a photo
          </Button>
        )}
        {mode !== "manual" && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setMode("manual")}
          >
            <Pencil className="mr-1.5 size-3.5" />
            Type manually
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="ml-auto text-muted-foreground"
        >
          <X className="mr-1.5 size-3.5" />
          Cancel
        </Button>
      </div>
    </div>
  );
}

function extractLotUuid(raw: string): string | null {
  return extractUuidFromUrlPath(raw, "stock/lots") ?? extractBareUuid(raw);
}

function extractCellUuid(raw: string): string | null {
  return extractUuidFromUrlPath(raw, "stock/cells") ?? extractBareUuid(raw);
}

function extractUuidFromUrlPath(raw: string, prefix: string): string | null {
  try {
    const url = new URL(raw);
    const re = new RegExp(`/${prefix}/([0-9a-fA-F-]{36})`);
    const m = url.pathname.match(re);
    return m ? m[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

function extractBareUuid(raw: string): string | null {
  const m = raw.trim().match(/^([0-9a-fA-F-]{36})$/);
  return m ? m[1].toLowerCase() : null;
}
