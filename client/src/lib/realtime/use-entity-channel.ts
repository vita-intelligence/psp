"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { getSocket } from "./socket";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";

interface UseEntityChannelOptions {
  /**
   * The kebab-case entity name matching the backend's
   * `Backend.Broadcasts.entity_changed/4` first argument
   * (e.g. `"shipment"`, `"purchase-order"`, `"manufacturing-order"`).
   */
  entity: string;

  /**
   * Optional detail-scoped suffix — if you're on a detail page and
   * want to react to changes on THIS specific record only, pass its
   * uuid. Omit to receive every change across the entity in the
   * current tenant (list-page behaviour).
   */
  uuid?: string | null;

  /**
   * When set, invalidate this TanStack query key on every `changed`
   * event so `useInfiniteQuery` / `useQuery` consumers refetch on
   * the next render. The DataTable v2 wrapper wires this
   * automatically; pass it directly for hand-rolled fetchers.
   */
  invalidateQueryKey?: unknown[];

  /**
   * Extra work to run per event — e.g. clear a local selection that
   * points at a row that might have vanished. Fires after the
   * router refresh + invalidation.
   */
  onEvent?: (payload: EntityChangedPayload) => void;

  /**
   * Suspend the subscription without unmounting the caller (e.g.
   * when the DataTable's tableId itself is dynamic). Defaults to
   * `false`; pass `true` to skip the socket join.
   */
  disabled?: boolean;
}

export interface EntityChangedPayload {
  entity: string;
  id: string | null;
  action: string;
  at: string;
}

/**
 * Subscribe to the tenant-scoped `entity:<name>:<company_id>` (or
 * detail-scoped `entity:<name>:<company_id>:<uuid>`) channel and
 * kick a refresh whenever the backend broadcasts a `changed` event.
 *
 * The refresh does three things, each cheap and idempotent:
 *
 *   1. `router.refresh()` — re-runs the server component that fed
 *      the page's `initialPage` prop, so the next render has fresh
 *      SSR data.
 *   2. `queryClient.invalidateQueries({ queryKey })` — flags any
 *      TanStack Query cache entries that back the visible rows as
 *      stale, so the next fetch (or the current in-flight one) is
 *      re-run against the server.
 *   3. Optional `onEvent` callback for anything the caller needs
 *      to do beyond the refetch (e.g. clear a selection).
 *
 * Debounced at ~250 ms so a burst of writes (bulk import,
 * cascading updates) collapses to a single refresh.
 */
export function useEntityChannel({
  entity,
  uuid,
  invalidateQueryKey,
  onEvent,
  disabled,
}: UseEntityChannelOptions): void {
  const router = useRouter();
  const queryClient = useQueryClient();
  const prefs = useFormatPrefs();
  const companyId = prefs.id ?? null;

  // Keep the handler stable across renders so we don't rebuild the
  // subscription on every parent render. We tick through refs so
  // the closure the socket holds always sees the latest values.
  const invalidateKeyRef = useRef(invalidateQueryKey);
  invalidateKeyRef.current = invalidateQueryKey;
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (disabled) return;
    if (!companyId) return;
    if (!entity) return;

    const topic = uuid
      ? `entity:${entity}:${companyId}:${uuid}`
      : `entity:${entity}:${companyId}`;

    let cancelled = false;
    let channel: { leave: () => void } | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    (async () => {
      const socket = await getSocket();
      if (!socket || cancelled) return;

      const c = socket.channel(topic, {});

      c.on("changed", (payload: EntityChangedPayload) => {
        if (timer) return;
        timer = setTimeout(() => {
          timer = null;
          const key = invalidateKeyRef.current;
          if (key && key.length > 0) {
            void queryClient.invalidateQueries({ queryKey: key });
          }
          router.refresh();
          onEventRef.current?.(payload);
        }, 250);
      });

      c.join();
      channel = c;
    })();

    return () => {
      cancelled = true;
      channel?.leave();
      if (timer) clearTimeout(timer);
    };
    // We intentionally omit `invalidateQueryKey` / `onEvent` — they're
    // refs so state changes don't tear down the channel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, uuid, companyId, disabled, router, queryClient]);
}
