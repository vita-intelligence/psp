"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Users2 } from "lucide-react";
import type { HREmployeeSummary } from "@/lib/hr/types";

interface Props {
  employees: HREmployeeSummary[];
  /** Current employee_uuid filter, or null for "all". */
  selected: string | null;
}

/**
 * Worker filter dropdown shared by /hr/shifts, /hr/wages, and
 * /hr/reputation. Writes the selection back into `?employee_uuid=`;
 * the server component picks it up on the next render and hands fresh
 * `initialItems` to the infinite-list. The list resets via `key` so
 * you never see stale rows from the previous worker's feed.
 */
export function EmployeeFilter({ employees, selected }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function onChange(uuid: string) {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    if (uuid) next.set("employee_uuid", uuid);
    else next.delete("employee_uuid");
    const qs = next.toString();
    startTransition(() => {
      router.push(qs ? `?${qs}` : "?");
    });
  }

  return (
    <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      <Users2 className="size-3.5" aria-hidden />
      <span className="sr-only">Filter by worker</span>
      <select
        value={selected ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={pending}
        className="min-w-[10rem] rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value="">All workers</option>
        {employees.map((e) => (
          <option key={e.uuid} value={e.uuid}>
            {e.full_name}
          </option>
        ))}
      </select>
    </label>
  );
}
