// Server-only error helpers used by every Next server action + proxy
// route. The goal: never let an exception flatten to "Something went
// wrong" without recording WHAT actually failed.
//
// Every catch in this codebase should route through `toErrorResult`
// (server actions) or `toJsonError` (proxy routes). They:
//   1. Log the real exception server-side with a unique request_id
//   2. Surface a structured payload back to the browser carrying that
//      same request_id, the underlying code/detail when known, and a
//      one-line technical summary the user can quote back to support.

import { ApiError } from "../api";
import type { ApiErrorBody, ErrorDebug } from "./types";

export type FieldErrors = Record<string, string[]>;

/** Canonical error envelope returned by every server action. */
export interface ErrorResult {
  ok: false;
  /** Stable string the UI can switch on (`validation_failed`,
   *  `unauthorized`, etc.). Synthetic codes like `network_error`
   *  bubble up from the api() wrapper. */
  code: string;
  /** Plain-English message. ALWAYS populated — never "Something went
   *  wrong"; if the underlying error didn't supply one, we synthesise
   *  from the http status. */
  detail: string;
  /** Per-field validation errors (`{name: ["can't be blank"]}`).
   *  Only present for `validation_failed`. */
  fields?: FieldErrors;
  /** Technical diagnostics — the bit a non-engineer can copy + send. */
  debug: ErrorDebug;
}

interface ToErrorOpts {
  /** Identifier of the calling function — appears in our server logs
   *  alongside the request_id so we can grep for "where did this fire". */
  source: string;
  /** Optional copy override when the underlying error didn't supply
   *  a detail string. Pass when the action knows more context than the
   *  generic synthesiser (e.g. "Couldn't load templates."). */
  fallbackDetail?: string;
}

/**
 * Standard exception → ErrorResult mapping for use inside a server
 * action's catch block. Pass `{source: "myAction"}` so the log line
 * tells you WHERE this fired.
 *
 *   try {
 *     ...
 *   } catch (err) {
 *     return toErrorResult(err, { source: "createWarehouseAction" });
 *   }
 */
export function toErrorResult(err: unknown, opts: ToErrorOpts): ErrorResult {
  const debug = describeException(err, opts.source);

  // Always log server-side. The request_id appears here AND in the UI
  // → the user can copy the id from the page and we can grep it.
  logServerError(debug, err);

  if (err instanceof ApiError) {
    return {
      ok: false,
      code: err.code,
      detail: err.detail || fallbackDetailFor(err.status, opts.fallbackDetail),
      fields: err.fields,
      debug,
    };
  }

  return {
    ok: false,
    code: "unknown",
    detail:
      opts.fallbackDetail ??
      "We hit an unexpected problem. Copy the technical details below and let us know what you were doing.",
    debug,
  };
}

/**
 * Same shape as `toErrorResult` but emits the JSON body a Next API
 * route should respond with. Use in the catch blocks of every
 * proxy route under `app/api`.
 *
 * Returns a plain object so callers can `NextResponse.json(payload, {status})`
 * — keeping NextResponse out of this module so it stays usable from
 * non-route code paths too.
 */
export function toJsonError(
  err: unknown,
  opts: ToErrorOpts,
): { payload: ApiErrorBody & { debug: ErrorDebug }; status: number } {
  const debug = describeException(err, opts.source);
  logServerError(debug, err);

  if (err instanceof ApiError) {
    return {
      payload: {
        error: err.code,
        detail: err.detail || fallbackDetailFor(err.status, opts.fallbackDetail),
        fields: err.fields,
        debug,
      },
      status: err.status || 502,
    };
  }

  return {
    payload: {
      error: "proxy_error",
      detail:
        opts.fallbackDetail ??
        "The request couldn't be forwarded. Copy the technical details below.",
      debug,
    },
    status: 502,
  };
}

// ---------------------------------------------------------------- helpers

function describeException(err: unknown, source: string): ErrorDebug {
  if (err instanceof ApiError) {
    return {
      source,
      exception: `${err.code}: ${err.detail || err.message || "(no detail)"}`,
      http_status: err.status,
      request_id: makeRequestId(),
    };
  }

  if (err instanceof Error) {
    return {
      source,
      exception: `${err.name}: ${err.message || "(no message)"}`,
      request_id: makeRequestId(),
    };
  }

  return {
    source,
    exception: String(err) || "(non-Error thrown)",
    request_id: makeRequestId(),
  };
}

function fallbackDetailFor(status: number, override?: string): string {
  if (override) return override;
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "You don't have permission to do that.";
  if (status === 404) return "We couldn't find what you're looking for.";
  if (status === 422) return "The form has some issues — see the field errors.";
  if (status === 429) return "You're going too fast. Please wait a moment.";
  if (status >= 500)
    return "The server hit an error. Copy the technical details below and let us know.";
  return "The request didn't succeed. Copy the technical details below.";
}

/**
 * For client-side guards that fail BEFORE the API call (empty email,
 * password too short, etc.). Carries the same envelope as a thrown
 * error so the UI doesn't have to branch on "was this an API error
 * or a pre-flight check". Skips server logging since the action
 * isn't really failing — the user just hasn't filled the form yet.
 */
export function syntheticErrorResult(opts: {
  source: string;
  code: string;
  detail: string;
  fields?: FieldErrors;
  exception?: string;
}): ErrorResult {
  return {
    ok: false,
    code: opts.code,
    detail: opts.detail,
    fields: opts.fields,
    debug: {
      source: opts.source,
      exception: opts.exception,
      request_id: makeRequestId(),
    },
  };
}

/**
 * Convenience for the "no session token" guard that runs before every
 * server action's API call. Returns a fully-formed ErrorResult so we
 * never ad-hoc-construct a half-populated one inline.
 */
export function unauthorizedResult(source: string): ErrorResult {
  return {
    ok: false,
    code: "unauthorized",
    detail: "Your session has expired. Please sign in again.",
    debug: {
      source,
      exception: "no session token in cookie",
      request_id: makeRequestId(),
    },
  };
}

function makeRequestId(): string {
  // Short, URL-safe, sortable. Length 12 is fine — collisions are
  // a non-issue at request granularity in a dev/single-tenant setup.
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 8);
  return `req_${ts}_${rnd}`;
}

function logServerError(debug: ErrorDebug, raw: unknown) {
  // Single structured line so it grep's easily.
  // eslint-disable-next-line no-console
  console.error(
    `[error] [${debug.request_id}] [${debug.source}] ${debug.exception ?? "unknown"}`,
    raw instanceof Error && raw.stack ? `\n${raw.stack}` : "",
  );
}
