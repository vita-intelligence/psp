import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { AttributeDefinition } from "../types";

export async function listAttributeDefinitionsPage(): Promise<{
  items: AttributeDefinition[];
  next_cursor: string | null;
} | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    return await api<{
      items: AttributeDefinition[];
      next_cursor: string | null;
    }>("/api/attribute-definitions", { token, cache: "no-store" });
  } catch {
    return null;
  }
}

export async function getAttributeDefinition(
  uuid: string,
): Promise<AttributeDefinition | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const { attribute_definition } = await api<{
      attribute_definition: AttributeDefinition;
    }>(`/api/attribute-definitions/${uuid}`, { token, cache: "no-store" });
    return attribute_definition;
  } catch {
    return null;
  }
}
