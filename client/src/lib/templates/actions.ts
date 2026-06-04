"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { PermissionTemplate } from "../types";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";

export type TemplateResult =
  | { ok: true; template: PermissionTemplate }
  | ErrorResult;

interface TemplateInput {
  name: string;
  description: string;
  permissions: string[];
}

export async function createTemplateAction(
  input: TemplateInput,
): Promise<TemplateResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createTemplateAction");

  try {
    const res = await api<{ template: PermissionTemplate }>("/api/roles", {
      method: "POST",
      token,
      body: JSON.stringify(input),
    });
    revalidatePath("/settings/roles");
    return { ok: true, template: res.template };
  } catch (err) {
    return toErrorResult(err, {
      source: "createTemplateAction",
      fallbackDetail: "Couldn't create the template.",
    });
  }
}

export async function updateTemplateAction(
  uuid: string,
  input: TemplateInput,
): Promise<TemplateResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateTemplateAction");

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
    return toErrorResult(err, {
      source: "updateTemplateAction",
      fallbackDetail: "Couldn't save the template.",
    });
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
