"use server";

import { revalidatePath } from "next/cache";
import { api, ApiError } from "../api";
import { getSessionToken } from "../auth/server";
import type { User } from "../types";
import type { ErrorResult } from "../auth/actions";

export type UpdateAccessResult =
  | { ok: true; user: User & { is_online?: boolean } }
  | ErrorResult;

function toErrorResult(err: unknown): ErrorResult {
  if (err instanceof ApiError) {
    return {
      ok: false,
      code: err.code,
      detail: err.detail,
      fields: err.fields,
    };
  }
  return {
    ok: false,
    code: "unknown",
    detail: "Something went wrong. Please try again.",
  };
}

/**
 * Replace a user's matrix access — Admin flag, direct permission
 * grants, and hourly wage. Backend enforces the last-admin floor and
 * the don't-lock-yourself-out guard; surface those as field errors
 * for the form's banner / inline display.
 */
export async function updateUserAccessAction(
  userUuid: string,
  input: {
    is_admin: boolean;
    permissions: string[];
    hourly_wage: string | null;
  },
): Promise<UpdateAccessResult> {
  const token = await getSessionToken();
  if (!token)
    return { ok: false, code: "unauthorized", detail: "Sign in first." };

  try {
    const res = await api<{ user: User & { is_online?: boolean } }>(
      `/api/users/${userUuid}/access`,
      {
        method: "PUT",
        token,
        body: JSON.stringify(input),
      },
    );
    revalidatePath(`/settings/users/${userUuid}`);
    revalidatePath("/settings/users");
    return { ok: true, user: res.user };
  } catch (err) {
    return toErrorResult(err);
  }
}
