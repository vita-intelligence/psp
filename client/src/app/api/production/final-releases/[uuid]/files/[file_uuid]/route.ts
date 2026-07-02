import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { getDeviceToken } from "@/lib/devices/server";
import { getSessionToken } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";
import { env } from "@/lib/env";

interface Ctx {
  params: Promise<{ uuid: string; file_uuid: string }>;
}

/** Serve the file blob through Phoenix — auth-gated. */
export async function GET(_req: Request, { params }: Ctx) {
  const { uuid, file_uuid: fileUuid } = await params;
  const token = (await getSessionToken()) ?? (await getDeviceToken());
  if (!token) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Sign in." },
      { status: 401 },
    );
  }

  // Blob is binary — proxy via raw fetch so we stream bytes instead
  // of buffering JSON.
  const upstream = `${env.apiUrl}/api/production/final-releases/${encodeURIComponent(uuid)}/files/${encodeURIComponent(fileUuid)}`;
  const res = await fetch(upstream, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    return NextResponse.json(
      { error: "not_found", detail: "File not found." },
      { status: res.status },
    );
  }
  const buf = await res.arrayBuffer();
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "content-type":
        res.headers.get("content-type") ?? "application/octet-stream",
      "content-disposition":
        res.headers.get("content-disposition") ?? "inline",
    },
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { uuid, file_uuid: fileUuid } = await params;
  const token = (await getSessionToken()) ?? (await getDeviceToken());
  if (!token) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Sign in." },
      { status: 401 },
    );
  }
  try {
    await api(
      `/api/production/final-releases/${encodeURIComponent(uuid)}/files/${encodeURIComponent(fileUuid)}`,
      { method: "DELETE", token },
    );
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/production/final-releases/:uuid/files/:file_uuid",
      fallbackDetail: "Couldn't delete the file.",
    });
    return NextResponse.json(payload, { status });
  }
}
