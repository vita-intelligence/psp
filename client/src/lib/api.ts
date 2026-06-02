import { env } from "./env";
import type { ApiErrorBody, ApiErrorCode } from "./errors/types";

/**
 * Typed error thrown by `api()`. Always has at least `status`, `code`,
 * and `detail`; `fields` is populated on validation failures.
 *
 * The synthetic codes (`network_error`, `server_error`) are added
 * when the backend isn't reachable or returned something that wasn't
 * JSON — callers shouldn't have to switch on `instanceof TypeError`
 * vs `ApiError` to reason about "did the request even land".
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | string;
  readonly detail: string;
  readonly fields?: Record<string, string[]>;

  constructor(opts: {
    status: number;
    code: string;
    detail: string;
    fields?: Record<string, string[]>;
  }) {
    super(opts.detail || opts.code);
    this.status = opts.status;
    this.code = opts.code;
    this.detail = opts.detail;
    this.fields = opts.fields;
  }
}

interface ApiOptions extends RequestInit {
  token?: string | null;
}

/**
 * Tiny fetch wrapper. Throws `ApiError` on any non-2xx (or when the
 * request fails entirely). Successful 204s return `undefined`.
 *
 * Keep stateless — never read from cookies / window. Server components
 * pass the token explicitly; client hooks pull it from a session
 * endpoint.
 */
export async function api<T = unknown>(
  path: string,
  { token, headers, ...init }: ApiOptions = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${env.apiUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      cache: "no-store",
    });
  } catch {
    // fetch() rejects only on network failure / abort. Anything else
    // (4xx / 5xx) returns a Response with .ok === false.
    throw new ApiError({
      status: 0,
      code: "network_error",
      detail:
        "Can't reach the server. Check your internet connection and try again.",
    });
  }

  if (!res.ok) {
    let body: Partial<ApiErrorBody> = {};
    try {
      body = (await res.json()) as Partial<ApiErrorBody>;
    } catch {
      // body wasn't JSON — leave as {}, we'll synthesise below
    }

    const code = body.error || synthesiseCode(res.status);
    const detail = body.detail || synthesiseDetail(res.status);

    throw new ApiError({
      status: res.status,
      code,
      detail,
      fields: body.fields,
    });
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function synthesiseCode(status: number): string {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "unknown";
}

function synthesiseDetail(status: number): string {
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "You don't have permission to do that.";
  if (status === 404) return "We couldn't find what you're looking for.";
  if (status === 429) return "You're going too fast. Please wait a moment.";
  if (status >= 500) return "Something went wrong on our end. Please try again.";
  return "Something went wrong. Please try again.";
}
