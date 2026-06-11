import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { getDeviceToken } from "@/lib/devices/server";

/**
 * Browser-side proxy for the move flow's lot-verify step. The
 * scanner component does an inline `fetch()` from the camera handler
 * (no server action round-trip), so it needs a same-origin Next
 * route to avoid CORS — same pattern as `/api/m/cells/[uuid]`.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await params;
  const token = await getDeviceToken();
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const data = await api<{ lot: unknown }>(
      `/api/stock/lots/scan/${encodeURIComponent(uuid)}`,
      { token },
    );
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: "lookup_failed", detail: err instanceof Error ? err.message : "?" },
      { status: 404 },
    );
  }
}
