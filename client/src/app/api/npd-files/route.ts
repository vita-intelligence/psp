import { NextResponse, type NextRequest } from "next/server";
import { loadNpdIntegrationConfig } from "@/lib/npd-integration/server";

/**
 * GET `/api/npd-files?url=<absolute NPD media URL>`
 *
 * Stream a media file (invoice PDF, label preview PNG, supplementary
 * artwork asset) from vita-cff (NPD) through PSP's origin so the
 * operator's browser can render it without a cross-origin session
 * dance. NPD sends absolute URLs on its sync payload (see
 * ``_absolute_media_url`` in ``apps/psp/services.py``); PSP just
 * hands those straight to the client via ``labelFileUrl`` /
 * ``paymentFileUrl`` helpers, which route through this endpoint.
 *
 * SSRF hardening:
 * * ``url`` MUST start with the configured NPD ``base_url`` from
 *   settings — no other host reachable through this proxy.
 * * ``..`` / raw fragments / newlines rejected.
 * * ``url`` is passed to ``new URL()`` for parsing, which throws
 *   on malformed input (caught → 400).
 *
 * Response:
 * * 200 with the upstream body + ``Content-Type`` /
 *   ``Content-Length`` / ``Content-Disposition`` preserved.
 * * 400 on missing / malformed ``url``.
 * * 502 when NPD is unreachable or returns non-2xx.
 * * 503 when the integration is turned off in ``/settings/integrations``.
 */
export async function GET(req: NextRequest) {
  const upstream = req.nextUrl.searchParams.get("url");
  if (!upstream) {
    return NextResponse.json({ detail: "url_required" }, { status: 400 });
  }
  if (upstream.includes("..") || /[\r\n]/.test(upstream)) {
    return NextResponse.json({ detail: "url_rejected" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(upstream);
  } catch {
    return NextResponse.json({ detail: "url_invalid" }, { status: 400 });
  }

  const config = await loadNpdIntegrationConfig();
  if (!config?.enabled || !config.base_url) {
    return NextResponse.json({ detail: "integration_off" }, { status: 503 });
  }

  let allowedBase: URL;
  try {
    allowedBase = new URL(config.base_url);
  } catch {
    return NextResponse.json({ detail: "config_invalid" }, { status: 503 });
  }

  // Origin match — the upstream URL must share host + protocol with
  // the configured NPD base. Path prefix isn't required (NPD hosts
  // media at ``/media/…`` while the API lives at ``/api/…``; both
  // ride the same host).
  if (
    parsed.protocol !== allowedBase.protocol ||
    parsed.host !== allowedBase.host
  ) {
    return NextResponse.json({ detail: "host_rejected" }, { status: 400 });
  }

  try {
    const upstreamRes = await fetch(parsed.toString(), {
      method: "GET",
      cache: "no-store",
    });
    if (!upstreamRes.ok || !upstreamRes.body) {
      return NextResponse.json(
        { detail: "upstream_error", status: upstreamRes.status },
        { status: 502 },
      );
    }
    const headers = new Headers();
    for (const h of ["content-type", "content-length", "content-disposition"]) {
      const v = upstreamRes.headers.get(h);
      if (v) headers.set(h, v);
    }
    // Cache invoice PDFs / label previews at the edge for a short
    // window — 60 s balances freshness after a re-upload with the
    // cost of streaming multi-MB PDFs on every open.
    headers.set("cache-control", "private, max-age=60");
    return new NextResponse(upstreamRes.body, {
      status: 200,
      headers,
    });
  } catch {
    return NextResponse.json({ detail: "upstream_unreachable" }, { status: 502 });
  }
}
