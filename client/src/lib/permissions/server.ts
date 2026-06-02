// Server-only fetcher for the per-user permission-matrix config. The
// shape (sections → resources → action columns) lives in
// `Backend.RBAC.Permissions.matrix/0` on the Elixir side so the
// frontend never hard-codes the resource list.

import { api, ApiError } from "../api";
import { getSessionToken } from "../auth/server";
import type { PermissionMatrix } from "../types";

export async function getPermissionMatrix(): Promise<PermissionMatrix> {
  const token = await getSessionToken();
  if (!token) return [];

  try {
    const { matrix } = await api<{ matrix: PermissionMatrix }>(
      "/api/permissions/matrix",
      { token },
    );
    return matrix;
  } catch (err) {
    if (err instanceof ApiError) return [];
    throw err;
  }
}
