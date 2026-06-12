import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { getSessionToken } from "@/lib/auth/server";

/**
 * Desktop proxy for the floor-plan widget on the lot detail page.
 * Same upstream BE endpoint as the mobile `/api/m/floors/<uuid>/plan`
 * route — just uses the session cookie instead of the device cookie
 * so it works for QC + admins on the laptop.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await params;
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const data = await api(
      `/api/stock/floors/${encodeURIComponent(uuid)}/plan`,
      { token },
    );
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}
