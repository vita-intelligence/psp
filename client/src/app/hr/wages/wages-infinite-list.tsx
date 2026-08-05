"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCompanyDate, formatCompanyMoney } from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";
import type { HREmployeeWage } from "@/lib/hr/types";
import type { TimelinePage } from "@/lib/hr/use-infinite-timeline";
import { useInfiniteTimeline } from "@/lib/hr/use-infinite-timeline";

interface Props {
  initialItems: HREmployeeWage[];
  initialCursor: string | null;
  employeeUuid: string | null;
}

async function fetchPage(
  employeeUuid: string | null,
  cursor: string,
): Promise<TimelinePage<HREmployeeWage>> {
  const params = new URLSearchParams({ limit: "50", cursor });
  if (employeeUuid) params.set("employee_uuid", employeeUuid);
  const res = await fetch(`/api/hr/wages?${params.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to load page (${res.status})`);
  return (await res.json()) as TimelinePage<HREmployeeWage>;
}

export function WagesInfiniteList({
  initialItems,
  initialCursor,
  employeeUuid,
}: Props) {
  const prefs = useFormatPrefs();
  const { items, sentinelRef, loading, cursor, error, retry } =
    useInfiniteTimeline<HREmployeeWage>({
      initialItems,
      initialCursor,
      fetchPage: (c) => fetchPage(employeeUuid, c),
    });

  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-muted-foreground">
        No wage rows recorded
        {employeeUuid ? " for this worker" : " yet"}.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/60 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="py-2 pr-3 font-semibold">Employee</th>
              <th className="py-2 pr-3 font-semibold">Effective from</th>
              <th className="py-2 pr-3 font-semibold">Effective to</th>
              <th className="py-2 pr-3 font-semibold">Rate / hr</th>
              <th className="py-2 pr-3 font-semibold">Source</th>
              <th className="py-2 font-semibold">Approved by</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {items.map((w) => {
              const name = w.employee?.name ?? "—";
              const href = w.employee ? `/hr/employees/${w.employee.uuid}` : null;
              const open = w.effective_to === null;
              return (
                <tr key={w.uuid}>
                  <td className="py-2 pr-3">
                    {href ? (
                      <Link
                        href={href}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {name}
                      </Link>
                    ) : (
                      <span className="font-medium">{name}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {formatCompanyDate(w.effective_from, prefs)}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {open ? (
                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                        Current
                      </span>
                    ) : (
                      formatCompanyDate(w.effective_to, prefs)
                    )}
                  </td>
                  <td className="py-2 pr-3 font-mono tabular-nums">
                    {formatCompanyMoney(w.hourly_rate, prefs, {
                      currency_code: w.currency_code,
                    })}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {w.source_kind ?? "—"}
                  </td>
                  <td className="py-2 text-muted-foreground">
                    {w.approved_by?.name ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {cursor !== null && (
        <div
          ref={sentinelRef}
          className="flex items-center justify-center py-4 text-xs text-muted-foreground"
          aria-live="polite"
        >
          {loading && (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="size-3 animate-spin" aria-hidden /> Loading
              more…
            </span>
          )}
          {!loading && error && (
            <span className="inline-flex items-center gap-3">
              <span className="text-red-600 dark:text-red-400">{error}</span>
              <Button size="sm" variant="outline" onClick={retry}>
                Retry
              </Button>
            </span>
          )}
        </div>
      )}
      {cursor === null && (
        <p className="border-t border-border/60 pt-4 text-center text-[11px] text-muted-foreground">
          End of history · {items.length} total
        </p>
      )}
    </div>
  );
}
