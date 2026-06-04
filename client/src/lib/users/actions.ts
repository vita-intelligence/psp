"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { User } from "../types";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";

export type UpdateAccessResult =
  | { ok: true; user: User & { is_online?: boolean } }
  | ErrorResult;

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
  if (!token) return unauthorizedResult("updateUserAccessAction");

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
    return toErrorResult(err, {
      source: "updateUserAccessAction",
      fallbackDetail: "Couldn't update access for this user.",
    });
  }
}
