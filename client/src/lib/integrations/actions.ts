"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { IntegrationScope, IntegrationToken, MintResult } from "./types";

/**
 * Mint a new integration token. The raw bearer string is included in
 * the response body EXACTLY ONCE — the client component must show it
 * to the operator in a copy-once modal and drop the reference
 * afterwards. It is never persisted server-side beyond a bcrypt hash
 * and never returned by any subsequent endpoint.
 */
export async function mintIntegrationToken(input: {
  name: string;
  scopes: IntegrationScope[];
}): Promise<MintResult> {
  const token = await getSessionToken();
  if (!token) throw new Error("Not signed in");

  const result = await api<MintResult>("/api/integration-tokens", {
    method: "POST",
    token,
    body: JSON.stringify({ name: input.name, scopes: input.scopes }),
    headers: { "Content-Type": "application/json" },
  });

  revalidatePath("/settings/integrations");
  return result;
}

/**
 * Soft-revoke an existing token by uuid. Optional reason is captured
 * in the audit trail. The token stays in the table (so historical
 * audit rows keep resolving) but every subsequent verify attempt
 * returns `{:error, :not_found}`.
 */
export async function revokeIntegrationToken(input: {
  uuid: string;
  reason?: string;
}): Promise<{ integration_token: IntegrationToken }> {
  const token = await getSessionToken();
  if (!token) throw new Error("Not signed in");

  const result = await api<{ integration_token: IntegrationToken }>(
    `/api/integration-tokens/${encodeURIComponent(input.uuid)}/revoke`,
    {
      method: "POST",
      token,
      body: JSON.stringify({ reason: input.reason ?? null }),
      headers: { "Content-Type": "application/json" },
    },
  );

  revalidatePath("/settings/integrations");
  return result;
}
