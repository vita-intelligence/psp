"use client";

import { ClipboardCheck, MessageSquare } from "lucide-react";
import { formatCompanyDate } from "@/lib/format/company";
import type { CompanyDefaults } from "@/lib/types";
import type { MoQcNoteRow } from "@/lib/production/server";

function formatWhen(iso: string, prefs: CompanyDefaults): string {
  const date = formatCompanyDate(iso, prefs);
  try {
    const t = new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${date} · ${t}`;
  } catch {
    return date;
  }
}

interface MoQcNotesCardProps {
  notes: MoQcNoteRow[];
  prefs: CompanyDefaults;
  /** Optional title override — the Output-QC page renders the same
   *  card under a slightly different heading ("QC notes from the
   *  line") because the audience is the finish-of-run QC operator
   *  reviewing what floor QC captured during the run. */
  title?: string;
  /** Optional sub-heading text ("Chronological", "Captured during
   *  production", …). Defaults to "Chronological". */
  subtitle?: string;
}

/**
 * Chronological QC-note timeline rendered on:
 *   * the MO detail page ("QC notes"), and
 *   * the Output-QC review page ("QC notes from the line").
 *
 * Notes come from ``audit_events`` where ``event='note_added'`` on
 * this MO — populated by the vita-perf Live QC kiosk callback. Order
 * is ascending (oldest first) so the reader follows the production
 * timeline in the same direction it happened.
 *
 * Empty state renders a soft placeholder rather than hiding the
 * card, so the operator knows the surface exists even before the
 * first note lands.
 */
export function MoQcNotesCard({
  notes,
  prefs,
  title = "QC notes",
  subtitle = "Chronological",
}: MoQcNotesCardProps) {
  return (
    <section
      className="rounded-lg border border-border/60 bg-card p-5 shadow-sm"
      aria-label={title}
    >
      <header className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          <span className="text-xs text-muted-foreground">
            · {subtitle}
            {notes.length > 0 && <> · {notes.length}</>}
          </span>
        </div>
      </header>

      {notes.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border/60 bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
          <MessageSquare className="size-5" />
          <p>No QC notes captured for this MO yet.</p>
          <p className="text-xs">
            Notes written by QC on the Live-QC kiosk while this run is
            in progress will appear here.
          </p>
        </div>
      ) : (
        <ol className="flex flex-col gap-3">
          {notes.map((n) => (
            <li
              key={n.id}
              className="rounded-md border border-border/60 bg-background p-3"
            >
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <p className="text-xs font-semibold text-foreground">
                  {n.author_name || "QC operator"}
                  {n.author_kind === "kiosk_qc" && (
                    <span className="ml-1.5 rounded-full bg-lime-500/15 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-lime-700 dark:text-lime-400">
                      Live QC
                    </span>
                  )}
                </p>
                <p className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {formatWhen(n.at, prefs)}
                </p>
              </div>
              <p className="whitespace-pre-wrap text-sm text-foreground">
                {n.note}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
