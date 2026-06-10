import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { api, ApiError } from "@/lib/api";
import { getSessionToken } from "@/lib/auth/server";
import { renderCellLabelPdf } from "@/lib/stock/cell-label-pdf";

export const runtime = "nodejs";

interface CellScanResponse {
  cell: {
    id: number;
    uuid: string;
    name: string | null;
    /** Company-numbered code (CELL00010). Null for system cells. */
    code: string | null;
    storage_location: {
      id: number;
      uuid: string;
      name: string | null;
      code: string | null;
    } | null;
    floor: { id: number; uuid: string; name: string } | null;
    warehouse: { id: number; uuid: string; name: string } | null;
  };
}

/**
 * GET /api/storage-cells/[uuid]/label.pdf?copies=N
 *
 * Mirrors the lot label endpoint. QR encodes the absolute URL to the
 * cell so an in-app scan resolves the cell context, and an external
 * QR reader opens a useful page (we route /stock/cells/<uuid> later).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await params;
  const copies = parseCopies(req.nextUrl.searchParams.get("copies"));
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let data: CellScanResponse;
  try {
    data = await api<CellScanResponse>(`/api/stock/cells/scan/${encodeURIComponent(uuid)}`, {
      token,
    });
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 500;
    return NextResponse.json(
      { error: "lookup_failed", detail: err instanceof Error ? err.message : String(err) },
      { status },
    );
  }

  const hdrs = await headers();
  const proto = hdrs.get("x-forwarded-proto") || "http";
  const host = hdrs.get("x-forwarded-host") || hdrs.get("host") || "";
  const cellUrl = `${proto}://${host}/stock/cells/${uuid}`;

  // Operator-facing label: use the company-numbered code (CELL00010)
  // as the canonical name. Falls back to the raw `name` column only
  // when there's no code (shouldn't happen for non-system cells, but
  // keeps the PDF from throwing on legacy rows). pdfkit's
  // `info: { Title }` would throw on a null, so we always coerce.
  const cellLabel =
    (data.cell.code && data.cell.code.trim()) ||
    (data.cell.name && data.cell.name.trim()) ||
    `Cell ${data.cell.id}`;

  const pdf = await renderCellLabelPdf({
    cellName: data.cell.name ?? "",
    cellCode: data.cell.code,
    locationName: data.cell.storage_location?.name ?? "",
    locationCode: data.cell.storage_location?.code ?? null,
    floorName: data.cell.floor?.name ?? "—",
    warehouseName: data.cell.warehouse?.name ?? "—",
    cellUrl,
    copies,
  });

  const filename = `${cellLabel.replace(/\s+/g, "_") || `cell-${data.cell.id}`}.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

function parseCopies(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(100, Math.floor(n)));
}
