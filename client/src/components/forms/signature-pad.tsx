"use client";

import { useEffect, useRef, useState } from "react";
import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SignaturePadProps {
  /** Called after each stroke ends with the latest data-URL (or null
   *  if the pad has just been cleared). The parent typically debounces
   *  / stores the latest value to submit on Sign. */
  onChange?: (dataUrl: string | null) => void;
  /** Fixed height in CSS pixels. Width grows to fill the parent. */
  height?: number;
  /** Hint text shown faintly inside an empty pad. */
  placeholder?: string;
  /** Disable input entirely (e.g. after the form is submitted). */
  disabled?: boolean;
  className?: string;
}

/**
 * Mobile-first signature pad. Renders a fixed-DPR canvas, listens for
 * pointer events (covers mouse + touch + stylus), strokes a smooth
 * 2-px black line, and exports `data:image/png;base64,…` on demand.
 *
 * Sizes via `ResizeObserver` so the pad responds when the viewport
 * shifts (keyboard pop-up on iOS, orientation flip).
 *
 * Why not a library: the canvas-and-pointer flow is ~80 LOC and the
 * eSign payload is just a base64 image — pulling in `signature_pad`
 * adds 30 KB for the same thing.
 */
export function SignaturePad({
  onChange,
  height = 160,
  placeholder = "Sign here",
  disabled,
  className,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  // Re-fit the backing buffer to the wrapper's CSS size × devicePixelRatio
  // so strokes stay crisp on retina screens.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const fit = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.max(window.devicePixelRatio || 1, 1);
      // Preserve any existing strokes by snapshotting them before resize.
      const snapshot = canvas.toDataURL();
      const wasEmpty = empty;

      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#0a0a0a";

      if (!wasEmpty) {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, rect.width, height);
        };
        img.src = snapshot;
      }
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [empty, height]);

  function pointerCoords(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    e.preventDefault();
    drawingRef.current = true;
    const canvas = canvasRef.current;
    if (canvas) canvas.setPointerCapture(e.pointerId);
    const pt = pointerCoords(e);
    lastPointRef.current = pt;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
    // Dot for a tap with no drag — common when "signing" a check.
    ctx.lineTo(pt.x + 0.01, pt.y + 0.01);
    ctx.stroke();
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const last = lastPointRef.current;
    if (!canvas || !ctx || !last) return;
    const pt = pointerCoords(e);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    lastPointRef.current = pt;
  }

  function endStroke(e?: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    const canvas = canvasRef.current;
    if (canvas && e) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // Pointer may have already been released; safe to ignore.
      }
    }
    setEmpty(false);
    if (canvas && onChange) {
      onChange(canvas.toDataURL("image/png"));
    }
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setEmpty(true);
    onChange?.(null);
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <div
        ref={wrapRef}
        className={cn(
          "relative overflow-hidden rounded-md border bg-white",
          disabled && "opacity-60",
        )}
        style={{ height }}
      >
        <canvas
          ref={canvasRef}
          className="block touch-none"
          aria-label="Signature pad"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onPointerLeave={(e) => drawingRef.current && endStroke(e)}
        />
        {empty && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground/60">
            {placeholder}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Sign with your finger or a stylus.</span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 gap-1 text-xs"
          onClick={clear}
          disabled={disabled || empty}
        >
          <Eraser className="size-3.5" />
          Clear
        </Button>
      </div>
    </div>
  );
}
