import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { AttributeDefinition, AttributeScope, ProductFamily } from "../types";

export async function listProductFamiliesForPicker(): Promise<
  ProductFamily[] | null
> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const res = await api<{ items: ProductFamily[] }>(
      `/api/product-families?picker=true`,
      { token, cache: "no-store" },
    );
    return res.items;
  } catch {
    return null;
  }
}

export async function listActiveAttributeDefinitionsForScope(
  scope: AttributeScope,
): Promise<AttributeDefinition[] | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const res = await api<{ items: AttributeDefinition[] }>(
      `/api/attribute-definitions?scope=${scope}&picker=true`,
      { token, cache: "no-store" },
    );
    return res.items;
  } catch {
    return null;
  }
}
