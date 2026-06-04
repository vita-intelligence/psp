"use client";

import { useState } from "react";
import { AlertCircle, Check, ChevronDown, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ErrorDebug } from "@/lib/errors/types";

interface ErrorBannerProps {
  /** Plain-English message shown in big text. */
  detail: string;
  /** Backend error code (`validation_failed`, `last_admin_removed`, …).
   *  Surfaced inside the "Technical details" panel so the user can
   *  read it back to support. */
  code?: string;
  /** Server-stamped diagnostics (request_id, exception, http_status).
   *  When present, the banner exposes a collapsed "Technical details"
   *  drawer with a Copy-to-clipboard button. */
  debug?: ErrorDebug;
  /** Override the banner's icon/colour scheme. Default is destructive
   *  red; pass `tone="warning"` for soft yellow (e.g. validation
   *  errors that aren't really crashes). */
  tone?: "destructive" | "warning";
  /** Optional className for the outer wrapper. */
  className?: string;
}

/**
 * The one error banner every form / page should use when a server
 * action returned `{ok: false}`. Solves the "Something went wrong"
 * problem by surfacing:
 *
 *   - the actual `detail` message in plain English (always)
 *   - a collapsed "Technical details" drawer with `code`, HTTP
 *     status, exception summary, request_id (when debug is present)
 *   - a "Copy details" button so the user can paste a complete
 *     diagnostic into a bug report without screenshots
 *
 * The request_id appears in the same line in server logs, so when a
 * user reports an error you can grep the logs for their id and find
 * the exact failed request in seconds.
 */
export function ErrorBanner({
  detail,
  code,
  debug,
  tone = "destructive",
  className,
}: ErrorBannerProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const hasDetails = !!debug || !!code;

  async function copyDetails() {
    const payload = formatForCopy({ detail, code, debug });
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can fail on older browsers / non-https origins.
      // Fall back to selecting a hidden textarea so the user can copy
      // manually with the keyboard.
      const ta = document.createElement("textarea");
      ta.value = payload;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } finally {
        document.body.removeChild(ta);
      }
    }
  }

  return (
    <div
      role="alert"
      className={cn(
        "rounded-md border px-3 py-2.5 text-sm",
        tone === "destructive" &&
          "border-destructive/30 bg-destructive/5 text-destructive",
        tone === "warning" &&
          "border-amber-300/40 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium leading-snug">{detail}</p>

          {hasDetails && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="inline-flex items-center gap-0.5 text-[11px] font-medium opacity-80 hover:opacity-100"
            >
              <ChevronDown
                className={cn(
                  "size-3 transition-transform",
                  expanded && "rotate-180",
                )}
              />
              Technical details
            </button>
          )}
        </div>
      </div>

      {expanded && hasDetails && (
        <div className="mt-2 space-y-1.5 rounded-md border border-current/20 bg-background/40 p-2 text-xs">
          <DetailsTable code={code} debug={debug} />
          <div className="flex justify-end pt-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={copyDetails}
              className="h-7 gap-1 text-[11px]"
            >
              {copied ? (
                <>
                  <Check className="size-3" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="size-3" />
                  Copy details
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailsTable({
  code,
  debug,
}: {
  code?: string;
  debug?: ErrorDebug;
}) {
  const rows: Array<[label: string, value: string | number | undefined]> = [
    ["Error code", code],
    ["HTTP status", debug?.http_status],
    ["Where", debug?.source],
    ["Exception", debug?.exception],
    ["Request id", debug?.request_id],
  ];
  return (
    <dl className="space-y-1">
      {rows.map(([label, value]) =>
        value === undefined ? null : (
          <div key={label} className="grid grid-cols-[90px_minmax(0,1fr)] gap-2">
            <dt className="font-medium opacity-70">{label}</dt>
            <dd className="break-all font-mono text-[11px] opacity-90">
              {String(value)}
            </dd>
          </div>
        ),
      )}
    </dl>
  );
}

function formatForCopy({
  detail,
  code,
  debug,
}: {
  detail: string;
  code?: string;
  debug?: ErrorDebug;
}): string {
  const lines = [
    `Error: ${detail}`,
    code ? `Code:  ${code}` : null,
    debug?.http_status ? `HTTP:  ${debug.http_status}` : null,
    debug?.source ? `Where: ${debug.source}` : null,
    debug?.exception ? `Cause: ${debug.exception}` : null,
    debug?.request_id ? `Req:   ${debug.request_id}` : null,
    `When:  ${new Date().toISOString()}`,
  ].filter(Boolean);
  return lines.join("\n");
}
