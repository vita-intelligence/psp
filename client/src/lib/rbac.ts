// Frontend RBAC helpers — mirror the backend permission registry.
//
// Keep this list in sync with `Backend.RBAC.Permissions` (Phoenix
// side). Type the codes as a string-literal union so misspellings get
// flagged at compile time instead of silently failing the check.

import type { User } from "./types";

export type PermissionCode =
  | "company.view"
  | "company.edit"
  | "users.view"
  | "users.invite"
  | "users.deactivate"
  | "roles.view"
  | "roles.create"
  | "roles.edit"
  | "roles.delete"
  | "warehouses.view"
  | "warehouses.create"
  | "warehouses.edit"
  | "warehouses.delete"
  | "storage_tags.manage"
  | "units.view"
  | "units.manage"
  | "items.view"
  | "items.create"
  | "items.edit"
  | "items.delete"
  | "product_families.manage"
  | "attribute_definitions.manage"
  | "risk_assessments.view"
  | "risk_assessments.create"
  | "risk_assessments.approve"
  | "certificates.view"
  | "certificates.manage"
  | "stock.view"
  | "stock.receive"
  | "stock.move"
  | "stock.edit"
  | "stock.adjust"
  | "stock.dispose"
  | "vendors.view"
  | "vendors.create"
  | "vendors.edit"
  | "vendors.delete"
  | "vendors.approve"
  | "procurement.po_view"
  | "procurement.po_create"
  | "procurement.po_submit"
  | "procurement.po_approve"
  | "procurement.po_director_approve"
  | "procurement.po_receive"
  | "procurement.invoice_view"
  | "procurement.invoice_manage"
  | "procurement.invoice_approve"
  | "goods_in.view"
  | "goods_in.inspect"
  | "goods_in.approve"
  | "production.bom_view"
  | "production.bom_create"
  | "production.bom_edit"
  | "production.bom_delete"
  | "production.workstation_group_view"
  | "production.workstation_group_create"
  | "production.workstation_group_edit"
  | "production.workstation_group_delete"
  | "production.facility_view"
  | "production.facility_create"
  | "production.facility_edit"
  | "production.facility_delete"
  | "production.workstation_view"
  | "production.workstation_create"
  | "production.workstation_edit"
  | "production.workstation_delete"
  | "production.routing_view"
  | "production.routing_create"
  | "production.routing_edit"
  | "production.routing_delete"
  | "production.mo_view"
  | "production.mo_create"
  | "production.mo_edit"
  | "production.mo_approve"
  | "production.mo_execute"
  | "production.mo_delete";

/**
 * Server-side / RSC-safe permission check. Server components and
 * server actions pass the `User` they already have.
 *
 * `is_admin` short-circuits to true — same semantics as the Elixir
 * `Backend.RBAC.has_permission?/2`. Hide-the-entire-tab behavior on
 * the frontend should still call this; the bypass keeps admins
 * seeing everything regardless of the granular code list.
 */
export function hasPermission(
  user: Pick<User, "permissions" | "is_admin"> | null | undefined,
  code: PermissionCode,
): boolean {
  if (!user) return false;
  if (user.is_admin) return true;
  if (!user.permissions) return false;
  return user.permissions.includes(code);
}

/**
 * Throw-style helper for server actions / route handlers. Use when a
 * surface MUST be gated and a fallback render isn't appropriate.
 */
export function assertPermission(
  user: Pick<User, "permissions" | "is_admin"> | null | undefined,
  code: PermissionCode,
): void {
  if (!hasPermission(user, code)) {
    throw new Error(`Forbidden: missing permission "${code}"`);
  }
}
