"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/users/user-avatar";
import { ErrorBanner } from "@/components/forms/error-banner";
import type { ErrorDebug } from "@/lib/errors/types";
import { cn } from "@/lib/utils";
import { formatCompanyDate } from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";
import { subscribeAudit, dispatchRestore } from "@/lib/audit/invalidator";
import { toast } from "sonner";
import {
  fieldLabel,
  formatValue,
  summarizeChanges,
} from "@/lib/audit/formatters";
import type { AuditEvent } from "@/lib/types";
import {
  ChevronDown,
  Loader2,
  RefreshCw,
  Plus,
  Pencil,
  Trash2,
  Activity as ActivityIcon,
  Undo2,
} from "lucide-react";

interface AuditHistoryCardProps {
  entityType: AuditEvent["entity_type"];
  entityId: number;
  /** Whether to show the "Restore this version" button on each event.
   *  Hide when the viewer lacks edit permission — they can read the
   *  history but can't repopulate the form. */
  canRestore?: boolean;
}

/** Structured error so the banner can show code + detail + technical
 *  drawer the same way every other form-error banner does. Saves the
 *  "wait, why did this 404?" guessing in production. */
interface ActivityError {
  /** Human-readable message — always present. Falls back to a stable
   *  phrase only when the backend gave us literally nothing. */
  detail: string;
  /** Backend error code (`unknown_entity_type`, `missing_permission`,
   *  `entity_not_found`, …). Surfaced inside Technical details. */
  code?: string;
  debug?: ErrorDebug;
}

interface FetchState {
  status: "loading" | "ready" | "error";
  events: AuditEvent[];
  cursor: string | null;
  loadingMore: boolean;
  error: ActivityError | null;
}

const PAGE_SIZE = 20;

/**
 * Activity timeline for one record. Reads `/api/audit?entity_type=&
 * entity_id=` with cursor pagination and lazy-loads the next page
 * when the user scrolls within ~200px of the bottom (IntersectionObserver).
 *
 * Each row collapses to a single-line summary by default. Click to
 * expand a side-by-side "before vs after" using friendly field
 * labels + formatted values so a non-technical reader can see what
 * the record used to look like at that moment in time.
 *
 * Subscribed to `invalidateAudit(entityType, entityId)` so a Save on
 * the same page refetches immediately — no page reload needed.
 */
export function AuditHistoryCard({
  entityType,
  entityId,
  canRestore = false,
}: AuditHistoryCardProps) {
  const [state, setState] = useState<FetchState>({
    status: "loading",
    events: [],
    cursor: null,
    loadingMore: false,
    error: null,
  });

  const loadFirstPage = useCallback(async () => {
    setState({
      status: "loading",
      events: [],
      cursor: null,
      loadingMore: false,
      error: null,
    });

    try {
      const res = await fetch(
        `/api/audit?entity_type=${entityType}&entity_id=${entityId}&limit=${PAGE_SIZE}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        setState({
          status: "error",
          events: [],
          cursor: null,
          loadingMore: false,
          error: await extractError(
            res,
            `proxy:/api/audit?entity_type=${entityType}&entity_id=${entityId}`,
          ),
        });
        return;
      }
      const data = (await res.json()) as {
        items: AuditEvent[];
        next_cursor: string | null;
      };
      setState({
        status: "ready",
        events: data.items,
        cursor: data.next_cursor,
        loadingMore: false,
        error: null,
      });
    } catch (err) {
      setState({
        status: "error",
        events: [],
        cursor: null,
        loadingMore: false,
        error: {
          detail:
            err instanceof Error
              ? `Couldn't reach the server: ${err.message}`
              : "Couldn't reach the server.",
          code: "network_error",
          debug: {
            source: `audit-history-card:${entityType}/${entityId}`,
            exception: err instanceof Error ? err.message : String(err),
            request_id: synthesizeRequestId(),
          },
        },
      });
    }
  }, [entityType, entityId]);

  // First-page fetch on mount / entity change.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await loadFirstPage();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadFirstPage]);

  // Subscribe to invalidation: when the form on this page saves, the
  // server-action calls `invalidateAudit` and we refetch the first
  // page so the new event appears without a manual reload.
  useEffect(() => {
    return subscribeAudit(entityType, entityId, () => {
      void loadFirstPage();
    });
  }, [entityType, entityId, loadFirstPage]);

  // Cursor pagination via IntersectionObserver on a sentinel placed
  // after the last row. When the sentinel is within 200px of the
  // viewport bottom and we have a `next_cursor`, fetch + append.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const cursorRef = useRef<string | null>(null);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    cursorRef.current = state.cursor;
  }, [state.cursor]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current) return;
    const cursor = cursorRef.current;
    if (!cursor) return;

    loadingMoreRef.current = true;
    setState((s) => ({ ...s, loadingMore: true }));

    try {
      const res = await fetch(
        `/api/audit?entity_type=${entityType}&entity_id=${entityId}&limit=${PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        // Fail soft on pagination — keep what we have, surface a
        // small error banner but let the user retry. The banner shows
        // the backend code + detail so a prod issue is debuggable.
        const detailed = await extractError(
          res,
          `proxy:/api/audit?cursor=…&entity_type=${entityType}&entity_id=${entityId}`,
        );
        setState((s) => ({
          ...s,
          loadingMore: false,
          error: detailed,
        }));
        return;
      }
      const data = (await res.json()) as {
        items: AuditEvent[];
        next_cursor: string | null;
      };
      setState((s) => ({
        ...s,
        events: [...s.events, ...data.items],
        cursor: data.next_cursor,
        loadingMore: false,
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        loadingMore: false,
        error: {
          detail:
            err instanceof Error
              ? `Couldn't reach the server: ${err.message}`
              : "Couldn't reach the server.",
          code: "network_error",
          debug: {
            source: `audit-history-card:loadMore:${entityType}/${entityId}`,
            exception: err instanceof Error ? err.message : String(err),
            request_id: synthesizeRequestId(),
          },
        },
      }));
    } finally {
      loadingMoreRef.current = false;
    }
  }, [entityType, entityId]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    if (state.status !== "ready") return;
    if (!state.cursor) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            void loadMore();
            break;
          }
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [state.status, state.cursor, loadMore]);

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <ActivityIcon className="size-4 text-muted-foreground" />
              Activity
            </CardTitle>
            <CardDescription className="text-xs">
              Every change made to this record, newest first. Click any
              entry to see exactly what changed.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {state.status === "loading" && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading activity…
          </div>
        )}

        {state.status === "error" && state.error && (
          <div className="space-y-3">
            <ErrorBanner
              detail={state.error.detail}
              code={state.error.code}
              debug={state.error.debug}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void loadFirstPage()}
            >
              <RefreshCw className="mr-1.5 size-3.5" />
              Try again
            </Button>
          </div>
        )}

        {state.status === "ready" && state.events.length === 0 && (
          <div className="rounded-md border border-dashed border-border/60 py-10 text-center text-xs text-muted-foreground">
            No activity yet. Save a change and it&apos;ll appear here.
          </div>
        )}

        {state.status === "ready" && state.events.length > 0 && (
          <ol className="relative space-y-3 pl-6 before:absolute before:bottom-2 before:left-2 before:top-2 before:w-px before:bg-border/60">
            {state.events.map((event) => (
              <EventRow
                key={event.id}
                event={event}
                entityType={entityType}
                entityId={entityId}
                canRestore={canRestore}
              />
            ))}

            {/* Sentinel for IntersectionObserver. Sits below the last
                row so observing it kicks off the next-page fetch. */}
            <div ref={sentinelRef} className="-my-1 h-1" aria-hidden />

            {state.loadingMore && (
              <li className="-ml-6 flex items-center justify-center py-3 text-xs text-muted-foreground">
                <Loader2 className="mr-1.5 size-3 animate-spin" />
                Loading more…
              </li>
            )}

            {/* Explicit fallback. The IntersectionObserver auto-loads
                when the sentinel scrolls into view, but a visible
                button reassures the operator the history continues
                beyond what's on screen and works for keyboard / no-
                scroll cases (e.g. when only one screen of rows shows
                but there's a next page). */}
            {state.cursor && !state.loadingMore && (
              <li className="-ml-6 pt-2 text-center">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void loadMore()}
                >
                  <ChevronDown className="mr-1 size-3.5" />
                  Load more history
                </Button>
              </li>
            )}

            {!state.cursor && state.events.length > 0 && (
              <li className="-ml-6 pt-2 text-center text-[10px] uppercase tracking-wide text-muted-foreground/60">
                — end of history —
              </li>
            )}

            {state.error && state.events.length > 0 && (
              <li className="-ml-6 space-y-2">
                <ErrorBanner
                  detail={state.error.detail}
                  code={state.error.code}
                  debug={state.error.debug}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void loadMore()}
                >
                  <RefreshCw className="mr-1.5 size-3.5" />
                  Try loading more
                </Button>
              </li>
            )}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function EventRow({
  event,
  entityType,
  entityId,
  canRestore,
}: {
  event: AuditEvent;
  entityType: AuditEvent["entity_type"];
  entityId: number;
  canRestore: boolean;
}) {
  const prefs = useFormatPrefs();
  const [expanded, setExpanded] = useState(false);
  const { icon: Icon, tone } = eventStyle(event.event);
  const hasChanges = Object.keys(event.changes).length > 0;

  // Delete events have nothing to restore (the row is gone), and
  // events recorded before the snapshot column shipped come back with
  // an empty `state_after`. Hide the button in both cases so the user
  // only sees Restore when it'll actually do something useful.
  const hasSnapshot =
    event.state_after &&
    typeof event.state_after === "object" &&
    Object.keys(event.state_after).length > 0;
  const canRestoreThis = canRestore && event.event !== "deleted" && hasSnapshot;

  const summary = summarizeChanges(entityType, event.event, event.changes);
  const when = new Date(event.at);

  function onRestoreClick(e: React.MouseEvent) {
    e.stopPropagation();

    // Pre-state_after rows (audit events created before the snapshot
    // column shipped) have an empty `state_after`. Restoring them
    // would silently blank the form — refuse with a clear warning
    // instead.
    if (!event.state_after || Object.keys(event.state_after).length === 0) {
      toast.warning("Can't restore this version", {
        description:
          "This event was recorded before full snapshots were enabled. Make a fresh edit and Restore that one instead.",
      });
      return;
    }

    dispatchRestore(entityType, entityId, event.state_after);
    toast.info("Version loaded into the form", {
      description:
        "Review the values above, then hit Save to record it as a new version.",
    });
  }

  return (
    <li className="relative">
      <span
        className={cn(
          "absolute -left-4 top-1.5 flex size-4 items-center justify-center rounded-full ring-4 ring-background",
          tone === "emerald" && "bg-emerald-100 text-emerald-700",
          tone === "brand" && "bg-brand/15 text-brand",
          tone === "destructive" && "bg-destructive/15 text-destructive",
        )}
      >
        <Icon className="size-2.5" />
      </span>

      <button
        type="button"
        onClick={() => hasChanges && setExpanded((e) => !e)}
        disabled={!hasChanges}
        className={cn(
          "block w-full rounded-md px-2 py-1.5 text-left transition-colors",
          hasChanges && "cursor-pointer hover:bg-muted/40",
        )}
      >
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {event.actor ? (
            <span className="inline-flex items-center gap-1">
              <UserAvatar
                name={event.actor.name}
                email={event.actor.email}
                avatar={event.actor.avatar}
                sizeClassName="size-4"
                fallbackClassName="text-[8px]"
              />
              <span className="font-medium text-foreground">
                {event.actor.name}
              </span>
            </span>
          ) : (
            <span className="italic text-muted-foreground">Unknown user</span>
          )}
          <span className="text-muted-foreground">{summary}</span>
          <span
            className="text-muted-foreground/70"
            title={when.toLocaleString()}
          >
            · {relativeTime(when, prefs.date_format)}
          </span>
          <div className="ml-auto flex items-center gap-1">
            {canRestoreThis && (
              <span
                role="button"
                tabIndex={0}
                onClick={onRestoreClick}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onRestoreClick(e as unknown as React.MouseEvent);
                  }
                }}
                className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground transition-colors hover:bg-brand/[0.06] hover:text-brand"
                title="Load this version into the form. Hit Save afterwards to record it as a new version."
              >
                <Undo2 className="size-3" />
                Restore
              </span>
            )}
            {hasChanges && (
              <ChevronDown
                className={cn(
                  "size-3.5 text-muted-foreground/60 transition-transform",
                  expanded && "rotate-180",
                )}
              />
            )}
          </div>
        </div>
      </button>

      {expanded && hasChanges && (
        <DiffPanel entityType={entityType} event={event} />
      )}
    </li>
  );
}

function DiffPanel({
  entityType,
  event,
}: {
  entityType: AuditEvent["entity_type"];
  event: AuditEvent;
}) {
  const entries = Object.entries(event.changes);

  return (
    <div className="ml-2 mt-1.5 space-y-2 rounded-md border border-border/40 bg-muted/20 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
        What changed
      </p>
      <dl className="space-y-2 text-xs">
        {entries.map(([field, diff]) => (
          <div
            key={field}
            className="grid gap-1.5 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-3"
          >
            <dt className="font-medium text-foreground">
              {fieldLabel(entityType, field)}
            </dt>
            <dd className="space-y-1 min-w-0">
              <div className="flex flex-wrap items-baseline gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                  Before
                </span>
                <ValueChip>{formatValue(entityType, field, diff.old)}</ValueChip>
              </div>
              <div className="flex flex-wrap items-baseline gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-brand/70">
                  After
                </span>
                <ValueChip tone="brand">
                  {formatValue(entityType, field, diff.new)}
                </ValueChip>
              </div>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ValueChip({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "brand";
}) {
  return (
    <span
      className={cn(
        "inline-block max-w-full truncate rounded-md border px-1.5 py-0.5 font-mono text-[10.5px]",
        tone === "muted"
          ? "border-border/60 bg-background text-foreground"
          : "border-brand/30 bg-brand/[0.08] text-foreground",
      )}
      title={typeof children === "string" ? children : undefined}
    >
      {children}
    </span>
  );
}

function eventStyle(kind: AuditEvent["event"]) {
  switch (kind) {
    case "created":
      return { icon: Plus, tone: "emerald" as const };
    case "updated":
      return { icon: Pencil, tone: "brand" as const };
    case "deleted":
      return { icon: Trash2, tone: "destructive" as const };
  }
}

/**
 * Pull a structured error out of a non-OK response. Preserves the
 * backend's `code` + `detail` + any `debug` block so the ErrorBanner
 * can show the same level of diagnostic depth forms get — no more
 * "we couldn't find what you're looking for" with zero context.
 *
 * Order of preference, most informative to least:
 *   1. Backend JSON `{ error, detail, debug }` (the standard payload)
 *   2. Raw response body (HTML error page, plain text, etc.)
 *   3. Status code phrase as last resort
 */
async function extractError(
  res: Response,
  source: string,
): Promise<ActivityError> {
  // Synthesise a request id on the FE when the backend didn't stamp
  // one. Keeps the "paste this id into a bug report" support flow
  // alive even for client-side errors and pre-route 404s.
  const debug: ErrorDebug = {
    source,
    http_status: res.status,
    request_id: synthesizeRequestId(),
  };
  type ErrorBody = {
    error?: string;
    detail?: string;
    debug?: Partial<ErrorDebug>;
  };
  let body: ErrorBody | null = null;
  let rawText: string | null = null;
  try {
    rawText = await res.text();
    body = rawText ? (JSON.parse(rawText) as ErrorBody) : null;
  } catch {
    // Body wasn't JSON — leave body null, fall through.
  }
  if (body?.detail) {
    return {
      detail: body.detail,
      code: body.error,
      debug: { ...debug, ...(body.debug ?? {}) },
    };
  }
  if (rawText && rawText.trim().length > 0 && rawText.length < 400) {
    return {
      detail: `Server returned HTTP ${res.status}: ${rawText.trim()}`,
      code: body?.error,
      debug,
    };
  }
  return {
    detail: `Server returned HTTP ${res.status} (${res.statusText || "no status text"}). Open Technical details for the request id.`,
    code: body?.error,
    debug,
  };
}

function synthesizeRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `fe-${crypto.randomUUID()}`;
  }
  return `fe-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** "5m ago", "yesterday", "Jan 12" — readable relative time. */
function relativeTime(d: Date, datePattern?: string | null): string {
  const diff = Date.now() - d.getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return formatCompanyDate(d.toISOString(), { date_format: datePattern });
}
