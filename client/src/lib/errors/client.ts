// Client-safe ErrorResult constructors. Use these in form components
// that detect a problem BEFORE round-tripping the server (duplicate
// rows, invalid CIDR, etc.) so the page can render the same banner
// shape regardless of where the error originated.

import type { ErrorResult, FieldErrors } from "./server";

/**
 * Build a client-detected ErrorResult. No server log line is written
 * (there's no server interaction to correlate against), but the same
 * banner UI works because the shape matches.
 */
export function clientValidationError(opts: {
  /** Component name (e.g. "AllowedIpsForm"). Appears in the
   *  "Where" row of the technical details. */
  source: string;
  detail: string;
  /** Optional shorter code if the UI wants to switch on it. */
  code?: string;
  fields?: FieldErrors;
  /** One-line technical note describing the failed check
   *  ("duplicate currency", "invalid CIDR", etc.). */
  exception?: string;
}): ErrorResult {
  return {
    ok: false,
    code: opts.code ?? "client_validation",
    detail: opts.detail,
    fields: opts.fields,
    debug: {
      source: opts.source,
      exception: opts.exception ?? "client-side validation",
      request_id: makeClientId(),
    },
  };
}

function makeClientId(): string {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 6);
  return `cli_${ts}_${rnd}`;
}
