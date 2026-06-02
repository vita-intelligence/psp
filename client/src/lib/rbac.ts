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
  | "roles.edit"
  | "warehouses.view"
  | "warehouses.create"
  | "warehouses.edit"
  | "warehouses.delete";

/**
 * Server-side / RSC-safe permission check. Server components and
 * server actions pass the `User` they already have.
 */
export function hasPermission(
  user: Pick<User, "permissions"> | null | undefined,
  code: PermissionCode,
): boolean {
  if (!user?.permissions) return false;
  return user.permissions.includes(code);
}

/**
 * Throw-style helper for server actions / route handlers. Use when a
 * surface MUST be gated and a fallback render isn't appropriate.
 */
export function assertPermission(
  user: Pick<User, "permissions"> | null | undefined,
  code: PermissionCode,
): void {
  if (!hasPermission(user, code)) {
    throw new Error(`Forbidden: missing permission "${code}"`);
  }
}
