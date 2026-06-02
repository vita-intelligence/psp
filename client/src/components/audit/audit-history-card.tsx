"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/users/user-avatar";
import { Badge } from "@/components/ui/badge-mini";
import { messageFor } from "@/lib/errors/codes";
import { cn } from "@/lib/utils";
import type { AuditEvent } from "@/lib/types";
import {
  AlertCircle,
  Loader2,
  RefreshCw,
  Plus,
  Pencil,
  Trash2,
  History,
} from "lucide-react";

interface AuditHistoryCardProps {
  entityType: "warehouse" | "user" | "template";
  /** Internal DB id (integer) — the audit log indexes by this; uuid
   *  isn't used in the query (the column does exist for cross-check
   *  but the index lives on `entity_id`). */
  entityId: number;
}

interface FetchState {
  status: "loading" | "ready" | "error";
  events: AuditEvent[];
  error: string | null;
}

/**
 * History card shown on each detail page. Lists every recorded
 * mutation in reverse-chronological order with the actor, timestamp,
 * and per-field diff. Skipped when the server returns 403 — the page
 * fetched the entity already, so an audit forbidden response is
 * either a misconfigured permission or a deliberate non-display.
 */
export function AuditHistoryCard({
  entityType,
  entityId,
}: AuditHistoryCardProps) {
  const [state, setState] = useState<FetchState>({
    status: "loading",
    events: [],
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading", events: [], error: null });

    (async () => {
      try {
        const res = await fetch(
          `/api/audit?entity_type=${entityType}&entity_id=${entityId}`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          let body: { error?: string; detail?: string } = {};
          try {
            body = await res.json();
          } catch {
            // body wasn't JSON
          }
          if (cancelled) return;
          setState({
            status: "error",
            events: [],
            error: messageFor(body.error, body.detail),
          });
          return;
        }
        const data = (await res.json()) as { items: AuditEvent[] };
        if (cancelled) return;
        setState({ status: "ready", events: data.items, error: null });
      } catch {
        if (cancelled) return;
        setState({
          status: "error",
          events: [],
          error: "Couldn't load history. Please try again.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [entityType, entityId]);

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="size-4 text-muted-foreground" />
              History
            </CardTitle>
            <CardDescription className="text-xs">
              Every recorded change to this record, newest first.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {state.status === "loading" && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading history…
          </div>
        )}

        {state.status === "error" && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{state.error}</span>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setState((s) => ({ ...s, status: "loading" }));
                // Trigger refetch by causing effect to re-run via a
                // tiny dummy state nudge: we just re-set status, which
                // doesn't change deps, so we manually retry inline.
                (async () => {
                  try {
                    const res = await fetch(
                      `/api/audit?entity_type=${entityType}&entity_id=${entityId}`,
                      { cache: "no-store" },
                    );
                    if (!res.ok) throw new Error();
                    const data = (await res.json()) as { items: AuditEvent[] };
                    setState({
                      status: "ready",
                      events: data.items,
                      error: null,
                    });
                  } catch {
                    setState({
                      status: "error",
                      events: [],
                      error: "Couldn't load history. Please try again.",
                    });
                  }
                })();
              }}
            >
              <RefreshCw className="mr-1.5 size-3.5" />
              Try again
            </Button>
          </div>
        )}

        {state.status === "ready" && state.events.length === 0 && (
          <div className="rounded-md border border-dashed border-border/60 py-10 text-center text-xs text-muted-foreground">
            No history yet.
          </div>
        )}

        {state.status === "ready" && state.events.length > 0 && (
          <ol className="relative space-y-4 pl-6 before:absolute before:bottom-2 before:left-2 before:top-2 before:w-px before:bg-border/60">
            {state.events.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function EventRow({ event }: { event: AuditEvent }) {
  const { icon: Icon, label, tone } = eventStyle(event.event);

  return (
    <li className="relative">
      <span
        className={cn(
          "absolute -left-4 top-1 flex size-4 items-center justify-center rounded-full ring-4 ring-background",
          tone === "emerald" && "bg-emerald-100 text-emerald-700",
          tone === "brand" && "bg-brand/15 text-brand",
          tone === "destructive" && "bg-destructive/15 text-destructive",
        )}
      >
        <Icon className="size-2.5" />
      </span>

      <div className="space-y-1.5">
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
          <span className="text-muted-foreground">{label}</span>
          <span className="text-muted-foreground">
            · {new Date(event.at).toLocaleString()}
          </span>
        </div>

        {Object.keys(event.changes).length > 0 && (
          <ul className="space-y-0.5 rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5 text-xs">
            {Object.entries(event.changes).map(([field, diff]) => (
              <li key={field} className="flex flex-wrap items-baseline gap-1">
                <Badge tone="muted">{field}</Badge>
                <ValueDisplay value={diff.old} />
                <span className="text-muted-foreground/60">→</span>
                <ValueDisplay value={diff.new} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function eventStyle(kind: AuditEvent["event"]) {
  switch (kind) {
    case "created":
      return { icon: Plus, label: "created", tone: "emerald" as const };
    case "updated":
      return { icon: Pencil, label: "updated", tone: "brand" as const };
    case "deleted":
      return { icon: Trash2, label: "deleted", tone: "destructive" as const };
  }
}

function ValueDisplay({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") {
    return (
      <span className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground/70">
        empty
      </span>
    );
  }
  if (typeof value === "boolean") {
    return (
      <span className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-foreground">
        {value ? "true" : "false"}
      </span>
    );
  }
  if (typeof value === "number" || typeof value === "string") {
    const s = String(value);
    return (
      <span
        className="max-w-[18rem] truncate rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-foreground"
        title={s}
      >
        {s}
      </span>
    );
  }
  // Objects + arrays: show JSON, truncated.
  const json = JSON.stringify(value);
  return (
    <span
      className="max-w-[18rem] truncate rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-foreground"
      title={json}
    >
      {json}
    </span>
  );
}
