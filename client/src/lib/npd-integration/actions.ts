"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type {
  NpdIntegrationConfig,
  NpdIntegrationTestResult,
} from "./types";

//: Payload the settings form sends to persist a config change. Blank
//: / null ``token`` explicitly means "keep the currently-stored value"
//: — matches the BE changeset's ``preserve_existing_token_when_blank``.
export interface UpdateNpdIntegrationInput {
  readonly enabled: boolean;
  readonly base_url: string;
  readonly token: string | null;
}

export async function updateNpdIntegration(
  input: UpdateNpdIntegrationInput,
): Promise<NpdIntegrationConfig> {
  const token = await getSessionToken();
  if (!token) throw new Error("Not signed in");

  const { npd_integration } = await api<{
    npd_integration: NpdIntegrationConfig;
  }>("/api/settings/npd-integration", {
    method: "PUT",
    token,
    body: JSON.stringify({
      enabled: input.enabled,
      base_url: input.base_url,
      token: input.token,
    }),
    headers: { "Content-Type": "application/json" },
  });

  revalidatePath("/settings/integrations");
  revalidatePath("/projects");
  return npd_integration;
}


export async function testNpdIntegration(): Promise<NpdIntegrationTestResult> {
  const token = await getSessionToken();
  if (!token) throw new Error("Not signed in");

  try {
    return await api<NpdIntegrationTestResult>(
      "/api/settings/npd-integration/test",
      {
        method: "POST",
        token,
        cache: "no-store",
        //: BE returns 502/400 with a ``{ok: false, reason}`` payload
        //: on failure; api() throws on non-2xx which loses the reason.
        //: Wrap in try/catch and return a synthetic failure so the
        //: form can surface it.
      },
    );
  } catch {
    return { ok: false, reason: "request_failed" };
  }
}
