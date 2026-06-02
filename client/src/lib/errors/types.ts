// Shape returned by every backend error response.
// Keep this in sync with `BackendWeb.Errors.payload/3` (Phoenix side).

export interface ApiErrorBody {
  readonly error: string;
  readonly detail: string;
  /** Optional per-field validation errors keyed by form field name. */
  readonly fields?: Record<string, string[]>;
}

export type ApiErrorCode =
  | "validation_failed"
  | "invalid_credentials"
  | "email_not_confirmed"
  | "email_and_password_required"
  | "invalid_or_expired_token"
  | "token_required"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  // synthetic codes the client adds when the backend isn't reachable
  | "network_error"
  | "server_error"
  | "rate_limited"
  | "unknown";
