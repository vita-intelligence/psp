// Shape returned by every backend error response.
// Keep this in sync with `BackendWeb.Errors.payload/3` (Phoenix side).

export interface ApiErrorBody {
  readonly error: string;
  readonly detail: string;
  /** Optional per-field validation errors keyed by form field name. */
  readonly fields?: Record<string, string[]>;
}

/**
 * Technical diagnostics attached to every ErrorResult so the user
 * isn't left staring at "Something went wrong." Surfaced in the
 * collapsed "Technical details" panel of the error banner; the user
 * can copy this and paste it into a bug report.
 *
 * `request_id` is server-generated per failed action so the same
 * string appears in our log files — making it trivial to grep for
 * the exact request the user reported.
 */
export interface ErrorDebug {
  /** Where in our code the error originated, e.g. "createWarehouseAction". */
  source: string;
  /** Best-effort one-line technical summary of the underlying exception. */
  exception?: string;
  /** HTTP status when the failure was a backend response; absent for
   *  thrown JS exceptions. */
  http_status?: number;
  /** Unique id correlating UI message ↔ server log line. */
  request_id: string;
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
