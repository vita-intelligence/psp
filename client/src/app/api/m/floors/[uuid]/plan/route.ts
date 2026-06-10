import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { getDeviceToken } from "@/lib/devices/server";

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
    const data = await api(
      `/api/stock/floors/${encodeURIComponent(uuid)}/plan`,
      { token },
    );
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}
