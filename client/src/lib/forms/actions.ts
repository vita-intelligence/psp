"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";
import type {
  FormTemplate,
  FormTemplateSchema,
  FormTrigger,
} from "./types";

export interface FormTemplateInput {
  name: string;
  description?: string | null;
  trigger: FormTrigger;
  schema: FormTemplateSchema;
  /** Optional worker audience filter — empty = every worker on the
   *  assigned workstation gets it. See `FormTemplate.worker_uuids`. */
  worker_uuids?: string[];
}

export type FormTemplateResult =
  | { ok: true; form_template: FormTemplate }
  | ErrorResult;

export async function createFormTemplateAction(
  input: FormTemplateInput,
): Promise<FormTemplateResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createFormTemplateAction");

  try {
    const { form_template } = await api<{ form_template: FormTemplate }>(
      "/api/form-templates",
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath("/production/forms");
    return { ok: true, form_template };
  } catch (err) {
    return toErrorResult(err, {
      source: "createFormTemplateAction",
      fallbackDetail: "Couldn't create the form template.",
    });
  }
}

export async function updateFormTemplateAction(
  uuid: string,
  input: Partial<FormTemplateInput>,
): Promise<FormTemplateResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateFormTemplateAction");

  try {
    const { form_template } = await api<{ form_template: FormTemplate }>(
      `/api/form-templates/${encodeURIComponent(uuid)}`,
      { method: "PATCH", token, body: JSON.stringify(input) },
    );
    revalidatePath("/production/forms");
    revalidatePath(`/production/forms/${uuid}`);
    return { ok: true, form_template };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateFormTemplateAction",
      fallbackDetail: "Couldn't update the form template.",
    });
  }
}

export async function archiveFormTemplateAction(
  uuid: string,
): Promise<FormTemplateResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("archiveFormTemplateAction");

  try {
    const { form_template } = await api<{ form_template: FormTemplate }>(
      `/api/form-templates/${encodeURIComponent(uuid)}`,
      { method: "DELETE", token },
    );
    revalidatePath("/production/forms");
    return { ok: true, form_template };
  } catch (err) {
    return toErrorResult(err, {
      source: "archiveFormTemplateAction",
      fallbackDetail: "Couldn't archive the form template.",
    });
  }
}

export async function reactivateFormTemplateAction(
  uuid: string,
): Promise<FormTemplateResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("reactivateFormTemplateAction");

  try {
    const { form_template } = await api<{ form_template: FormTemplate }>(
      `/api/form-templates/${encodeURIComponent(uuid)}/reactivate`,
      { method: "POST", token },
    );
    revalidatePath("/production/forms");
    return { ok: true, form_template };
  } catch (err) {
    return toErrorResult(err, {
      source: "reactivateFormTemplateAction",
      fallbackDetail: "Couldn't reactivate the form template.",
    });
  }
}
