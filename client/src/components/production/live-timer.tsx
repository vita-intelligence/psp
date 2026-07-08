"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  startedAt: string;
  finishedAt?: string | null;
  className?: string;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatHMS(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

/**
 * Monospaced HH:MM:SS clock. Ticks every second while the session is
 * live; freezes once `finishedAt` is set. Uses `Math.max(0, …)` so
 * clock drift between the operator kiosk and the viewing browser can
 * never render negative time.
 *
 * Deliberately dumb — no formatting, no locale, no server prefs.
 * Duration is a universal unit.
 */
export function LiveTimer({ startedAt, finishedAt, className }: Props) {
  const started = new Date(startedAt).getTime();
  const finished = finishedAt ? new Date(finishedAt).getTime() : null;

  const computeElapsed = () => {
    const now = finished ?? Date.now();
    return (now - started) / 1000;
  };

  const [elapsed, setElapsed] = useState<number>(computeElapsed);

  useEffect(() => {
    if (finished !== null) {
      setElapsed((finished - started) / 1000);
      return;
    }
    setElapsed((Date.now() - started) / 1000);
    const id = window.setInterval(() => {
      setElapsed((Date.now() - started) / 1000);
    }, 1000);
    return () => window.clearInterval(id);
  }, [started, finished]);

  return (
    <span
      className={cn("font-mono tabular-nums", className)}
      aria-live={finished === null ? "polite" : "off"}
    >
      {formatHMS(elapsed)}
    </span>
  );
}
