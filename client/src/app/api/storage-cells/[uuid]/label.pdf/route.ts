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
    name: string;
    storage_location: {
      id: number;
      uuid: string;
      name: string;
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

  // Cells often have empty `name` (operators rely on the ordinal +
  // breadcrumb), so synthesise a fallback label that's never null —
  // pdfkit's `info: { Title }` throws when it tries to coerce null.
  const cellLabel =
    (data.cell.name && data.cell.name.trim()) || `Cell ${data.cell.id}`;

  const pdf = await renderCellLabelPdf({
    cellName: cellLabel,
    cellCode: null, // numbering format for cells could be added later
    locationName: data.cell.storage_location?.name ?? "—",
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
