"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, ApiError } from "../api";
import { getSessionToken } from "../auth/server";
import type { PermissionTemplate } from "../types";
import type { ErrorResult } from "../auth/actions";

export type TemplateResult =
  | { ok: true; template: PermissionTemplate }
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

interface TemplateInput {
  name: string;
  description: string;
  permissions: string[];
}

export async function createTemplateAction(
  input: TemplateInput,
): Promise<TemplateResult> {
  const token = await getSessionToken();
  if (!token)
    return { ok: false, code: "unauthorized", detail: "Sign in first." };

  try {
    const res = await api<{ template: PermissionTemplate }>("/api/roles", {
      method: "POST",
      token,
      body: JSON.stringify(input),
    });
    revalidatePath("/settings/roles");
    return { ok: true, template: res.template };
  } catch (err) {
    return toErrorResult(err);
  }
}

export async function updateTemplateAction(
  uuid: string,
  input: TemplateInput,
): Promise<TemplateResult> {
  const token = await getSessionToken();
  if (!token)
    return { ok: false, code: "unauthorized", detail: "Sign in first." };

  try {
    const res = await api<{ template: PermissionTemplate }>(
      `/api/roles/${uuid}`,
      {
        method: "PUT",
        token,
        body: JSON.stringify(input),
      },
    );
    revalidatePath(`/settings/roles/${uuid}`);
    revalidatePath("/settings/roles");
    return { ok: true, template: res.template };
  } catch (err) {
    return toErrorResult(err);
  }
}

export async function deleteTemplateAction(uuid: string): Promise<void> {
  const token = await getSessionToken();
  if (!token) return;

  try {
    await api(`/api/roles/${uuid}`, { method: "DELETE", token });
  } catch {
    // best-effort — UI shows a toast on the optimistic side
  }
  revalidatePath("/settings/roles");
  redirect("/settings/roles");
}
