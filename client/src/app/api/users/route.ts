import { NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSessionToken, clearSessionCookie } from "@/lib/auth/server";

// Proxy: browser → Next route → Phoenix /api/users.
// Browser JS never touches the bearer token. Pass through the backend's
// structured error shape so client-side error handling stays consistent
// whether the error came from Phoenix or from this proxy itself.
export async function GET() {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json(
      {
        error: "unauthorized",
        detail: "Your session has expired. Please sign in again.",
      },
      { status: 401 },
    );
  }

  try {
    const data = await api("/api/users", { token });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 401) {
        await clearSessionCookie();
      }
      return NextResponse.json(
        { error: err.code, detail: err.detail, fields: err.fields },
        { status: err.status || 502 },
      );
    }
    return NextResponse.json(
      {
        error: "server_error",
        detail: "Something went wrong on our end. Please try again.",
      },
      { status: 500 },
    );
  }
}
