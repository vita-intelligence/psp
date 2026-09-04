import "server-only";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import {
  formatCompanyDate,
  formatCompanyNumber,
  type FormatPrefs,
} from "../format/company";
import type { PendingDispatch } from "./types";

// 1 mm in PDF points (72 dpi / 25.4 mm) — same MM constant as
// ``lib/stock/label-pdf.ts`` so the two labels share thermal-printer
// dimensions.
const MM = 2.83464567;
const LABEL_WIDTH_MM = 100;
const LABEL_HEIGHT_MM = 60;

export interface ThreePlLabelInput {
  /** Live dispatch payload — customer / lot / item / qty / notes. */
  dispatch: PendingDispatch;
  companyName: string;
  /** Absolute URL the QR encodes. Should point at
   *  ``/scan/three-pl/<dispatch_uuid>`` on the PSP client so a mobile
   *  scan resolves the current lifecycle stage and lands on the
   *  right screen (Move / Paperwork / Pickup / Return). */
  scanUrl: string;
  copies: number;
  prefs: FormatPrefs;
}

/**
 * Render a printable thermal label for a 3PL customer dispatch
 * order. Distinct from the stock-lot label (``lib/stock/label-pdf``)
 * — bailee custody is customer-owned so the label leads with the
 * customer's name + delivery destination, not our internal lot
 * traceability fields.
 *
 * Purpose: stick this label on the parcel the moment the portal
 * request lands. Every subsequent scan on the same paired phone
 * opens the current stage (Move → Paperwork → Pickup → Return),
 * so the label follows the parcel through the whole outbound
 * lifecycle without a re-print.
 */
export async function renderThreePlLabelPdf(
  input: ThreePlLabelInput,
): Promise<Buffer> {
  const { dispatch, companyName, scanUrl, copies, prefs } = input;

  const qrPng = await QRCode.toBuffer(scanUrl, {
    errorCorrectionLevel: "M",
    margin: 0,
    width: 320,
    type: "png",
  });

  const doc = new PDFDocument({
    size: [LABEL_WIDTH_MM * MM, LABEL_HEIGHT_MM * MM],
    margin: 0,
    autoFirstPage: false,
    info: {
      Title: `3PL · ${dispatch.lot?.item?.name ?? "Dispatch"}`,
      Author: companyName,
      Subject: "3PL dispatch label",
    },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve) => doc.on("end", () => resolve()));

  for (let i = 0; i < copies; i++) {
    doc.addPage({
      size: [LABEL_WIDTH_MM * MM, LABEL_HEIGHT_MM * MM],
      margin: 0,
    });
    drawLabel(doc, dispatch, companyName, qrPng, prefs);
  }

  doc.end();
  await finished;
  return Buffer.concat(chunks);
}

function drawLabel(
  doc: PDFKit.PDFDocument,
  dispatch: PendingDispatch,
  companyName: string,
  qrPng: Buffer,
  prefs: FormatPrefs,
) {
  const pad = 4 * MM;
  const qrSize = 32 * MM;
  const qrX = pad;
  const qrY = pad;
  const dataX = qrX + qrSize + 4 * MM;
  const dataWidth = LABEL_WIDTH_MM * MM - dataX - pad;

  // Header band — brand block so the label is instantly
  // recognisable as a 3PL dispatch on a warehouse floor.
  const bandH = 3.5 * MM;
  doc
    .rect(0, 0, LABEL_WIDTH_MM * MM, bandH)
    .fill("#7c3aed"); // violet-600 — matches the hub's Move tile
  doc
    .font("Helvetica-Bold")
    .fontSize(6.5)
    .fillColor("#ffffff")
    .text("3PL DISPATCH", pad, 0.9 * MM, {
      width: LABEL_WIDTH_MM * MM - 2 * pad,
      characterSpacing: 0.6,
    });

  // QR block (leaves top band alone).
  const qrTop = qrY + bandH;
  doc.image(qrPng, qrX, qrTop, { width: qrSize, height: qrSize });

  // Short dispatch ref under the QR.
  doc
    .font("Helvetica-Bold")
    .fontSize(6.5)
    .fillColor("#000")
    .text(dispatch.reference ?? shortId(dispatch.uuid), qrX, qrTop + qrSize + 1 * MM, {
      width: qrSize,
      align: "center",
    });

  // ---- right column ----
  let cursorY = qrTop;

  doc
    .font("Helvetica-Bold")
    .fontSize(6)
    .fillColor("#6b7280")
    .text("CUSTOMER", dataX, cursorY, {
      width: dataWidth,
      characterSpacing: 0.4,
    });
  cursorY += 2.5 * MM;

  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor("#000")
    .text(dispatch.lot?.bailee_customer?.name ?? "—", dataX, cursorY, {
      width: dataWidth,
      height: 5 * MM,
      ellipsis: true,
    });
  cursorY += 5.5 * MM;

  // Item + qty
  const halfW = (dataWidth - 2 * MM) / 2;
  drawKeyValue(
    doc,
    "QTY",
    formatQty(dispatch.qty, dispatch.lot?.unit_symbol, prefs),
    dataX,
    cursorY,
    halfW,
    13,
  );
  drawKeyValue(
    doc,
    "REQUESTED",
    formatCompanyDate(dispatch.requested_at, prefs),
    dataX + halfW + 2 * MM,
    cursorY,
    halfW,
    9,
  );
  cursorY += 8.5 * MM;

  // Divider
  doc
    .strokeColor("#000")
    .lineWidth(0.2)
    .opacity(0.15)
    .moveTo(dataX, cursorY)
    .lineTo(dataX + dataWidth, cursorY)
    .stroke()
    .opacity(1);
  cursorY += 1.5 * MM;

  // Product description
  doc
    .font("Helvetica-Bold")
    .fontSize(8.5)
    .fillColor("#000")
    .text(dispatch.lot?.item?.name ?? "—", dataX, cursorY, {
      width: dataWidth,
      height: 6 * MM,
      ellipsis: true,
      lineGap: 0,
    });
  cursorY += 6.5 * MM;

  // Lot code · batch — smaller, mono
  doc
    .font("Courier")
    .fontSize(7)
    .fillColor("#374151")
    .text(
      [
        dispatch.lot?.code ?? "—",
        dispatch.lot?.supplier_batch_no
          ? `Batch ${dispatch.lot.supplier_batch_no}`
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
      dataX,
      cursorY,
      { width: dataWidth, ellipsis: true },
    );

  // Footer — company name (bottom-right)
  doc
    .font("Helvetica")
    .fontSize(6.5)
    .fillColor("#6b7280")
    .text(
      `${companyName} · Scan to open on phone`,
      dataX,
      LABEL_HEIGHT_MM * MM - pad - 2.5 * MM,
      { width: dataWidth, align: "right" },
    );
}

function drawKeyValue(
  doc: PDFKit.PDFDocument,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
  valuePt: number,
) {
  doc
    .font("Helvetica-Bold")
    .fontSize(6)
    .fillColor("#6b7280")
    .text(label, x, y, { width, characterSpacing: 0.4 });
  doc
    .font("Helvetica-Bold")
    .fontSize(valuePt)
    .fillColor("#000")
    .text(value, x, y + 2.5 * MM, { width, ellipsis: true });
}

function formatQty(
  qty: string | number | null,
  symbol: string | null | undefined,
  prefs: FormatPrefs,
): string {
  const formatted = formatCompanyNumber(qty, prefs);
  if (formatted === "—") return formatted;
  return symbol ? `${formatted} ${symbol}` : formatted;
}

function shortId(uuid: string): string {
  return uuid.slice(0, 8).toUpperCase();
}
