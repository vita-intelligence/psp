import { env } from "./env";

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(message || `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

interface ApiOptions extends RequestInit {
  token?: string | null;
}

/**
 * Tiny fetch wrapper. Throws ApiError on non-2xx so callers can branch
 * on `.status` (e.g. 401 → redirect to /login).
 *
 * Keep stateless — never reads from cookies / window. Server components
 * pass the token explicitly; client hooks read from `useAuth()`.
 */
export async function api<T = unknown>(
  path: string,
  { token, headers, ...init }: ApiOptions = {},
): Promise<T> {
  const res = await fetch(`${env.apiUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // body not JSON — leave as null
    }
    throw new ApiError(res.status, body);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
