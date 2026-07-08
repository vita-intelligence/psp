// Types for the /settings/integrations page. Mirrors the JSON the
// Elixir controller emits via `Payloads.integration_token/1`.

export type IntegrationScope =
  | "mo:read"
  | "mo:write:session"
  | "mo:transition"
  | "workstation:read"
  | "item:read"
  | "user:read"
  | "hr:read"
  | "hr:write:pin"
  | "hr:write:reputation";

export interface IntegrationTokenActor {
  id: number;
  uuid?: string;
  name?: string;
  email?: string;
}

export interface IntegrationToken {
  id: number;
  uuid: string;
  name: string;
  prefix: string;
  scopes: IntegrationScope[];
  is_active: boolean;
  last_used_at: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
  revoked_by: IntegrationTokenActor | null;
  created_by: IntegrationTokenActor | null;
  inserted_at: string;
  updated_at: string;
}

export interface IntegrationTokenList {
  items: IntegrationToken[];
  known_scopes: IntegrationScope[];
}

export interface MintResult {
  integration_token: IntegrationToken;
  /** The raw bearer string. Displayed to the operator EXACTLY ONCE
   *  and never returned again by any endpoint. Handle with care —
   *  never log, never persist client-side, never re-render. */
  raw_token: string;
}
