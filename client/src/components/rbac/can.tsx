import { hasPermission, type PermissionCode } from "@/lib/rbac";
import type { User } from "@/lib/types";

interface CanProps {
  user: Pick<User, "permissions"> | null | undefined;
  permission: PermissionCode;
  /** Optional render-when-denied. Keeps the conditional in one place
   *  instead of every caller pairing this with an `else` block. */
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Declarative permission gate. Server component — pass the `user`
 * the page already loaded; never re-fetches.
 *
 *   <Can user={user} permission="company.edit">
 *     <Button>Save</Button>
 *   </Can>
 *
 * For client-component gates, prefer reading `user.permissions`
 * directly off whatever state you already have rather than spinning
 * up a parallel React context — the user object is small enough to
 * just pass down.
 */
export function Can({ user, permission, fallback = null, children }: CanProps) {
  if (!hasPermission(user, permission)) return <>{fallback}</>;
  return <>{children}</>;
}
