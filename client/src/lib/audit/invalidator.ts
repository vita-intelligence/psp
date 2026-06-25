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

type EntityType =
  | "warehouse"
  | "user"
  | "template"
  | "floor"
  | "storage_location"
  | "storage_cell"
  | "storage_tag"
  | "unit_of_measurement"
  | "item"
  | "product_family"
  | "attribute_definition"
  | "raw_material_compliance"
  | "raw_material_risk_assessment"
  | "finished_product_spec"
  | "packaging_compliance"
  | "certificate"
  | "item_certificate"
  | "item_image"
  | "stock_lot"
  | "stock_lot_placement"
  | "stock_movement"
  | "vendor"
  | "vendor_approved_item"
  | "vendor_certificate"
  | "customer"
  | "customer_contact"
  | "customer_file"
  | "customer_contact_event"
  | "pricelist"
  | "pricelist_item"
  | "customer_order"
  | "customer_order_line"
  | "customer_order_approval"
  | "customer_order_file"
  | "customer_approved_item"
  | "customer_invoice"
  | "customer_invoice_line"
  | "customer_invoice_payment"
  | "customer_return"
  | "customer_return_line"
  | "customer_return_file"
  | "loyalty_program"
  | "loyalty_program_tier"
  | "customer_credit"
  | "purchase_order"
  | "purchase_order_line"
  | "purchase_order_approval"
  | "bom"
  | "workstation_group"
  | "workstation"
  | "routing"
  | "manufacturing_order"
  | "manufacturing_order_step"
  | "manufacturing_order_booking";
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

// "Restore version" channel — the Activity card's Restore button
// dispatches a snapshot keyed by (entity_type, entity_id); the form
// on the same page subscribes and populates its state. Separate from
// the invalidate channel because the payloads are different
// (snapshot vs. nothing) and the listener semantics differ (apply
// state vs. trigger a refetch).

type RestoreListener = (state: Record<string, unknown>) => void;
const restoreListeners = new Map<string, Set<RestoreListener>>();

export function dispatchRestore(
  entityType: EntityType,
  entityId: number,
  state: Record<string, unknown>,
) {
  const ls = restoreListeners.get(key(entityType, entityId));
  if (!ls) return;
  for (const listener of ls) listener(state);
}

export function subscribeRestore(
  entityType: EntityType,
  entityId: number,
  listener: RestoreListener,
): () => void {
  const k = key(entityType, entityId);
  if (!restoreListeners.has(k)) restoreListeners.set(k, new Set());
  restoreListeners.get(k)!.add(listener);

  return () => {
    const set = restoreListeners.get(k);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) restoreListeners.delete(k);
  };
}
