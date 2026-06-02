// Module-level pub/sub for "this entity's audit log just changed —
// any subscribed AuditHistoryCard should refetch."
//
// Why not TanStack Query or a Zustand store? Because the only
// consumer is the AuditHistoryCard mounted on detail pages, and the
// only producer is "the form on the same page just saved". A
// 40-line emitter is the right size for that — no library, no
// global cache layer to reason about, no SSR gymnastics.
//
// The runtime is the browser; this module's state is fine being
// in-memory and ephemeral. Cleanup happens on subscriber unmount.

type EntityType = "warehouse" | "user" | "template";
type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();

function key(entityType: EntityType, entityId: number) {
  return `${entityType}:${entityId}`;
}

/**
 * Signal that `audit_events` for this entity has new rows. Every
 * subscribed AuditHistoryCard will re-fetch its first page. No-op
 * when nothing is subscribed (e.g. user is on the list page).
 *
 * Call right after a server-action save succeeds — and also from
 * `onCommit` (the peer-receive branch) so realtime collaborators see
 * their teammate's edits land in the timeline.
 */
export function invalidateAudit(entityType: EntityType, entityId: number) {
  const ls = listeners.get(key(entityType, entityId));
  if (!ls) return;
  for (const listener of ls) listener();
}

/**
 * Subscribe to invalidation events for one entity. Returns the
 * unsubscribe fn — call it from the effect cleanup.
 */
export function subscribeAudit(
  entityType: EntityType,
  entityId: number,
  listener: Listener,
): () => void {
  const k = key(entityType, entityId);
  if (!listeners.has(k)) listeners.set(k, new Set());
  listeners.get(k)!.add(listener);

  return () => {
    const set = listeners.get(k);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) listeners.delete(k);
  };
}
