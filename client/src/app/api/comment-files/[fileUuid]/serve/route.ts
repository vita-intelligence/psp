import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getSessionToken } from "@/lib/auth/server";

export const runtime = "nodejs";

/**
 * Streams a comment attachment (image / video / audio / gif / arbitrary
 * file) back from Phoenix carrying the laptop session bearer.
 *
 * The canonical URL the backend stamps on CommentFile payloads is
 * `/api/comment-files/<file_uuid>/serve` — this proxy attaches the auth
 * header so `<img src>` / `<video src>` / `<a href>` all resolve
 * transparently. Backend re-checks the caller's view perm on the
 * comment's parent entity at fetch time (tenanted by company).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ fileUuid: string }> },
) {
  const { fileUuid } = await params;
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const upstream = await fetch(
    `${env.apiUrl}/api/comment-files/${encodeURIComponent(fileUuid)}/serve`,
    {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );

  if (!upstream.ok) {
    return NextResponse.json(
      { error: "file_not_found" },
      { status: upstream.status },
    );
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "content-type":
        upstream.headers.get("content-type") ?? "application/octet-stream",
      "content-disposition":
        upstream.headers.get("content-disposition") ?? "inline",
      "cache-control": "private, max-age=300",
    },
  });
}
