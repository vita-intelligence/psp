import "server-only";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

// 1 mm in PDF points.
const MM = 2.83464567;
const LABEL_WIDTH_MM = 100;
const LABEL_HEIGHT_MM = 60;

export interface CellLabelInput {
  cellName: string;
  cellCode: string | null;
  locationName: string;
  locationCode: string | null;
  floorName: string;
  warehouseName: string;
  cellUrl: string;
  copies: number;
}

/**
 * Render a cell label PDF — big QR + breadcrumb. Operator sticks
 * this on the physical shelf so the mobile scanner can confirm
 * "the box went onto this exact spot".
 *
 * Layout mirrors the lot label: QR-dominant left (about 1/3),
 * breadcrumb + code stacked right. Same 100×60mm thermal-friendly
 * page size + standard Helvetica fonts.
 */
export async function renderCellLabelPdf(input: CellLabelInput): Promise<Buffer> {
  const qrPng = await QRCode.toBuffer(input.cellUrl, {
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
      Title: input.cellCode ?? input.cellName,
      Author: input.warehouseName,
      Subject: "Storage cell label",
    },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const finished = new Promise<void>((resolve) => doc.on("end", () => resolve()));

  for (let i = 0; i < input.copies; i++) {
    doc.addPage({
      size: [LABEL_WIDTH_MM * MM, LABEL_HEIGHT_MM * MM],
      margin: 0,
    });
    drawCellLabel(doc, input, qrPng);
  }

  doc.end();
  await finished;
  return Buffer.concat(chunks);
}

function drawCellLabel(
  doc: PDFKit.PDFDocument,
  input: CellLabelInput,
  qrPng: Buffer,
) {
  const pad = 4 * MM;
  const qrSize = 36 * MM;
  const qrX = pad;
  const qrY = (LABEL_HEIGHT_MM * MM - qrSize) / 2;
  const dataX = qrX + qrSize + 4 * MM;
  const dataWidth = LABEL_WIDTH_MM * MM - dataX - pad;

  doc.image(qrPng, qrX, qrY, { width: qrSize, height: qrSize });

  // ---- right column ----
  let cursorY = pad;

  // CELL label
  doc
    .font("Helvetica-Bold")
    .fontSize(6)
    .fillColor("#6b7280")
    .text("CELL", dataX, cursorY, { width: dataWidth, characterSpacing: 0.4 });
  cursorY += 2.5 * MM;

  // Hero — company-numbered code (CELL00010). Falls back to the raw
  // cell.name only when there's no code, which only happens on
  // legacy / system cells.
  const hero = input.cellCode ?? input.cellName ?? "";
  doc
    .font("Helvetica-Bold")
    .fontSize(18)
    .fillColor("#000")
    .text(hero, dataX, cursorY, { width: dataWidth, ellipsis: true });
  cursorY += 8 * MM;

  // Optional subtitle — only render when the cell carries an
  // operator-meaningful name distinct from its code. Previously we
  // always painted `cellName` here, which read as "Cell 10" right
  // under the "Cell 10" hero. With the code/name dedupe, registered
  // cells with empty names skip this entirely.
  const subtitle = (input.cellName ?? "").trim();
  if (subtitle && subtitle !== hero) {
    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor("#374151")
      .text(subtitle, dataX, cursorY, {
        width: dataWidth,
        ellipsis: true,
      });
    cursorY += 4 * MM;
  }

  doc
    .font("Helvetica-Bold")
    .fontSize(6)
    .fillColor("#6b7280")
    .text("LOCATION", dataX, cursorY, {
      width: dataWidth,
      characterSpacing: 0.4,
    });
  cursorY += 2.5 * MM;

  // Prefer the code (SL00004); use the name only when it adds info
  // beyond the code. Painting "—" under LOCATION because the name
  // column was empty was just visual noise.
  const locationHero =
    input.locationCode ?? input.locationName ?? "—";
  doc
    .font(input.locationCode ? "Courier-Bold" : "Helvetica")
    .fontSize(9)
    .fillColor("#000")
    .text(locationHero, dataX, cursorY, {
      width: dataWidth,
      ellipsis: true,
    });
  const locationSub = (input.locationName ?? "").trim();
  if (locationSub && locationSub !== locationHero) {
    cursorY += 3.5 * MM;
    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor("#374151")
      .text(locationSub, dataX, cursorY, {
        width: dataWidth,
        ellipsis: true,
      });
  }
  cursorY += 4.5 * MM;

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

  // Site (warehouse + floor)
  doc
    .font("Helvetica")
    .fontSize(7)
    .fillColor("#6b7280")
    .text(`${input.warehouseName} · ${input.floorName}`, dataX, cursorY, {
      width: dataWidth,
      ellipsis: true,
    });
}
