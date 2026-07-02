import { NextRequest, NextResponse } from "next/server";
import { api } from "@/lib/api";
import { getDeviceToken } from "@/lib/devices/server";
import { getSessionToken } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

interface Ctx {
  params: Promise<{ uuid: string }>;
}

/** Multipart upload proxy. Client sends FormData with `file` + `kind`. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const { uuid } = await params;
  const token = (await getSessionToken()) ?? (await getDeviceToken());
  if (!token) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Sign in." },
      { status: 401 },
    );
  }

  try {
    const form = await req.formData();
    const data = await api(
      `/api/production/final-releases/${encodeURIComponent(uuid)}/files`,
      { method: "POST", token, body: form },
    );
    return NextResponse.json(data);
  } catch (err) {
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/production/final-releases/:uuid/files",
      fallbackDetail: "Couldn't upload the file.",
    });
    return NextResponse.json(payload, { status });
  }
}
