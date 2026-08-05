"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CalendarRange } from "lucide-react";

const WINDOWS = [
  { value: 7, label: "Last 7 days" },
  { value: 14, label: "Last 14 days" },
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
  { value: 180, label: "Last 180 days" },
];

interface Props {
  selected: number;
}

/** Window picker for /hr/statistics. Writes back into `?days=` so the
 *  server component re-runs the aggregate for the new window. */
export function WindowSelect({ selected }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function onChange(days: number) {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    next.set("days", String(days));
    startTransition(() => {
      router.push(`?${next.toString()}`);
    });
  }

  return (
    <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      <CalendarRange className="size-3.5" aria-hidden />
      <span className="sr-only">Window</span>
      <select
        value={selected}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={pending}
        className="min-w-[10rem] rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {WINDOWS.map((w) => (
          <option key={w.value} value={w.value}>
            {w.label}
          </option>
        ))}
      </select>
    </label>
  );
}
