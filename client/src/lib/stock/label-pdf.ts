import "server-only";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import {
  formatCompanyDate,
  formatCompanyNumber,
  type FormatPrefs,
} from "../format/company";
import type { StockLot } from "../types";

// 1 mm in PDF points (72 dpi / 25.4 mm).
const MM = 2.83464567;
const LABEL_WIDTH_MM = 100;
const LABEL_HEIGHT_MM = 60;

interface LabelInput {
  lot: StockLot;
  companyName: string;
  lotUrl: string;
  copies: number;
  prefs: FormatPrefs;
}

/**
 * Render a thermal-label PDF for `lot`, repeating it `copies` times.
 * Each page is exactly 100×60 mm so a Zebra / Brother label driver
 * lands it 1:1 on the roll. No external fonts — only PDF standard
 * Helvetica family so we don't need to bundle font files.
 *
 * Layout: QR on the left (~32mm square), data column on the right
 * with the lot code + expiry + qty in big type, item description +
 * source detail underneath, company name in the footer.
 *
 * Returns the rendered bytes as a Node `Buffer` — the Route Handler
 * wraps it in a Response with `application/pdf`.
 */
export async function renderLabelPdf(input: LabelInput): Promise<Buffer> {
  const { lot, companyName, lotUrl, copies, prefs } = input;

  const qrPng = await QRCode.toBuffer(lotUrl, {
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
      Title: lot.code ?? `Lot ${lot.id}`,
      Author: companyName,
      Subject: "Stock label",
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
    drawLabel(doc, lot, companyName, qrPng, prefs);
  }

  doc.end();
  await finished;
  return Buffer.concat(chunks);
}

function drawLabel(
  doc: PDFKit.PDFDocument,
  lot: StockLot,
  companyName: string,
  qrPng: Buffer,
  prefs: FormatPrefs,
) {
  // Internal padding from the label edge — 4mm leaves enough room for
  // printer kerning without wasting space.
  const pad = 4 * MM;
  const qrSize = 32 * MM;
  const qrX = pad;
  const qrY = pad;
  const dataX = qrX + qrSize + 4 * MM;
  const dataWidth = LABEL_WIDTH_MM * MM - dataX - pad;

  // QR
  doc.image(qrPng, qrX, qrY, { width: qrSize, height: qrSize });

  // Lot code caption under QR
  doc
    .font("Helvetica-Bold")
    .fontSize(7)
    .fillColor("#000")
    .text(lot.code ?? "—", qrX, qrY + qrSize + 1.5 * MM, {
      width: qrSize,
      align: "center",
    });

  // ---- right column ----
  let cursorY = pad;

  // LOT label
  doc
    .font("Helvetica-Bold")
    .fontSize(6)
    .fillColor("#6b7280")
    .text("LOT", dataX, cursorY, { width: dataWidth, characterSpacing: 0.4 });
  cursorY += 2.5 * MM;

  // Lot code — hero
  doc
    .font("Helvetica-Bold")
    .fontSize(22)
    .fillColor("#000")
    .text(lot.code ?? "—", dataX, cursorY, { width: dataWidth });
  cursorY += 9 * MM;

  // Expiry + Quantity, two columns
  const halfW = (dataWidth - 2 * MM) / 2;
  drawKeyValue(
    doc,
    "EXPIRY",
    formatCompanyDate(lot.expiry_at, prefs),
    dataX,
    cursorY,
    halfW,
    12,
  );
  drawKeyValue(
    doc,
    "QUANTITY",
    formatQty(lot.qty_received, lot.unit_of_measurement?.symbol, prefs),
    dataX + halfW + 2 * MM,
    cursorY,
    halfW,
    12,
  );
  cursorY += 8 * MM;

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

  // Item description (max 2 lines, ellipsis)
  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor("#000")
    .text(lot.item?.name ?? "—", dataX, cursorY, {
      width: dataWidth,
      height: 8 * MM,
      ellipsis: true,
      lineGap: 0,
    });
  cursorY += 8 * MM;

  // part code · rev · source
  const partCode = lot.item?.code ?? "—";
  const rev = lot.revision || "—";
  const source = formatSource(lot.source_kind, lot.source_ref);
  doc
    .font("Courier")
    .fontSize(7)
    .fillColor("#374151")
    .text(`${partCode} · Rev ${rev} · ${source}`, dataX, cursorY, {
      width: dataWidth,
      ellipsis: true,
    });

  // Footer — company name (bottom-right of data column)
  doc
    .font("Helvetica")
    .fontSize(6.5)
    .fillColor("#6b7280")
    .text(
      companyName,
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

function formatSource(
  kind: StockLot["source_kind"] | null,
  ref: string | null,
): string {
  if (ref) return ref;
  if (!kind) return "—";
  const labels: Record<string, string> = {
    purchase_order: "PO",
    manufacturing_order: "MO",
    opening_balance: "Opening balance",
    return: "Return",
    adjustment: "Adjustment",
    manual: "Manual",
  };
  return labels[kind] ?? kind;
}
