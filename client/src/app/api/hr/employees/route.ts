import { NextRequest, NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSessionToken, clearSessionCookie } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

/**
 * Same-origin proxy for the HR employees ledger feed. The browser-
 * side DataTable fetches this; we forward the session bearer to
 * Phoenix and pass the response through. Same shape as every other
 * proxy under this folder (workstations, POs, etc).
 */
export async function GET(req: NextRequest) {
    const token = await getSessionToken();
    if (!token) {
        return NextResponse.json(
            { error: "unauthorized", detail: "Session expired." },
            { status: 401 },
        );
    }
    const upstream = `/api/hr/employees${req.nextUrl.search ?? ""}`;
    try {
        const data = await api(upstream, { token });
        return NextResponse.json(data);
    } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
            await clearSessionCookie();
        }
        const { payload, status } = toJsonError(err, {
            source: "proxy:/api/hr/employees",
            fallbackDetail: "Couldn't load employees.",
        });
        return NextResponse.json(payload, { status });
    }
}
