"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type {
  AttributeDefinition,
  AttributeEnumChoice,
  AttributeScope,
  AttributeType,
} from "../types";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";

export type AttrResult =
  | { ok: true; attribute_definition: AttributeDefinition }
  | ErrorResult;
export type DeleteResult = { ok: true } | ErrorResult;

interface AttrInput {
  scope?: AttributeScope;
  key?: string;
  label?: string;
  attribute_type?: AttributeType;
  enum_choices?: AttributeEnumChoice[];
  required?: boolean;
  default_value?: unknown;
  unit_symbol?: string | null;
  help_text?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

export async function createAttributeDefinitionAction(
  input: AttrInput,
): Promise<AttrResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createAttributeDefinitionAction");

  try {
    const res = await api<{ attribute_definition: AttributeDefinition }>(
      `/api/attribute-definitions`,
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/settings/attribute-definitions`);
    return { ok: true, attribute_definition: res.attribute_definition };
  } catch (err) {
    return toErrorResult(err, {
      source: "createAttributeDefinitionAction",
      fallbackDetail: "Couldn't create the attribute definition.",
    });
  }
}

export async function updateAttributeDefinitionAction(
  uuid: string,
  input: AttrInput,
): Promise<AttrResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateAttributeDefinitionAction");

  try {
    const res = await api<{ attribute_definition: AttributeDefinition }>(
      `/api/attribute-definitions/${uuid}`,
      { method: "PUT", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/settings/attribute-definitions`);
    return { ok: true, attribute_definition: res.attribute_definition };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateAttributeDefinitionAction",
      fallbackDetail: "Couldn't update the attribute definition.",
    });
  }
}

export async function deleteAttributeDefinitionAction(
  uuid: string,
): Promise<DeleteResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("deleteAttributeDefinitionAction");

  try {
    await api<void>(`/api/attribute-definitions/${uuid}`, {
      method: "DELETE",
      token,
    });
    revalidatePath(`/settings/attribute-definitions`);
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "deleteAttributeDefinitionAction",
      fallbackDetail: "Couldn't delete the attribute definition.",
    });
  }
}
