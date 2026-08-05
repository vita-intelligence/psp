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

  // Finished sessions are deterministic (finished - started) so it's
  // safe to render them server-side. Live sessions depend on Date.now()
  // — we defer to a post-mount render to avoid hydration mismatches
  // where the server's tick and the client's tick disagree.
  const [elapsed, setElapsed] = useState<number | null>(() =>
    finished !== null ? (finished - started) / 1000 : null,
  );

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
      suppressHydrationWarning
    >
      {elapsed === null ? "--:--:--" : formatHMS(elapsed)}
    </span>
  );
}
