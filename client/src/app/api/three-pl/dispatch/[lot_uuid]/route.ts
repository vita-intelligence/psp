import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { getSessionToken } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

interface Ctx {
  params: Promise<{ lot_uuid: string }>;
}

export async function POST(req: Request, { params }: Ctx) {
  const { lot_uuid: lotUuid } = await params;
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Sign in." },
      { status: 401 },
    );
  }

  try {
    const body = (await req.json()) as {
      qty?: string;
      reference?: string | null;
      notes?: string | null;
      photo_url?: string | null;
    };
    const data = await api(
      `/api/three-pl/dispatch/${encodeURIComponent(lotUuid)}`,
      {
        method: "POST",
        token,
        body: JSON.stringify({
          qty: body.qty,
          reference: body.reference,
          notes: body.notes,
          photo_url: body.photo_url,
        }),
      },
    );
    return NextResponse.json(data);
  } catch (err) {
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/three-pl/dispatch",
      fallbackDetail: "Couldn't record the dispatch.",
    });
    return NextResponse.json(payload, { status });
  }
}
