import "server-only";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import {
  formatCompanyDate,
  type FormatPrefs,
} from "../format/company";
import type { Equipment } from "./types";

// 1 mm in PDF points (72 dpi / 25.4 mm). Matches the stock-lot
// label so operators can share printer profiles.
const MM = 2.83464567;
const LABEL_WIDTH_MM = 100;
const LABEL_HEIGHT_MM = 60;

interface LabelInput {
  equipment: Equipment;
  companyName: string;
  scanUrl: string;
  copies: number;
  prefs: FormatPrefs;
}

/**
 * Render a thermal-label PDF for `equipment`, repeating it `copies`
 * times. Each page is exactly 100×60 mm so a Zebra / Brother label
 * driver lands it 1:1 on the roll. Same size as the stock-lot label
 * so a shared printer profile works for both.
 *
 * Layout: QR on the left (~32mm square), data column on the right
 * with the equipment code + item name + category badge, serial +
 * manufacturer/model + next-cal date underneath, company name in
 * the footer.
 *
 * QR encodes the mobile detail URL so a scan lands on
 * `/m/equipment/<uuid>` on any paired phone.
 */
export async function renderEquipmentLabelPdf(
  input: LabelInput,
): Promise<Buffer> {
  const { equipment, companyName, scanUrl, copies, prefs } = input;

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
      Title: equipment.code ?? `Equipment ${equipment.id}`,
      Author: companyName,
      Subject: "Equipment label",
    },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve) =>
    doc.on("end", () => resolve()),
  );

  for (let i = 0; i < copies; i++) {
    doc.addPage({
      size: [LABEL_WIDTH_MM * MM, LABEL_HEIGHT_MM * MM],
      margin: 0,
    });
    drawLabel(doc, equipment, companyName, qrPng, prefs);
  }

  doc.end();
  await finished;
  return Buffer.concat(chunks);
}

function drawLabel(
  doc: PDFKit.PDFDocument,
  equipment: Equipment,
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

  // QR
  doc.image(qrPng, qrX, qrY, { width: qrSize, height: qrSize });

  // Equipment code caption under QR
  doc
    .font("Helvetica-Bold")
    .fontSize(7)
    .fillColor("#000")
    .text(equipment.code ?? equipment.serial_number, qrX, qrY + qrSize + 1.5 * MM, {
      width: qrSize,
      align: "center",
      ellipsis: true,
    });

  // ---- right column ----
  let cursorY = pad;

  // EQUIPMENT tag caption
  doc
    .font("Helvetica-Bold")
    .fontSize(6)
    .fillColor("#6b7280")
    .text("EQUIPMENT", dataX, cursorY, {
      width: dataWidth,
      characterSpacing: 0.4,
    });
  cursorY += 2.5 * MM;

  // Item name — hero
  const itemName = equipment.item?.name ?? equipment.model ?? "—";
  doc
    .font("Helvetica-Bold")
    .fontSize(14)
    .fillColor("#000")
    .text(itemName, dataX, cursorY, {
      width: dataWidth,
      height: 12 * MM,
      ellipsis: true,
      lineGap: 0,
    });
  cursorY += 11 * MM;

  // Serial + Category, two-column key/value
  const halfW = (dataWidth - 2 * MM) / 2;
  drawKeyValue(
    doc,
    "SERIAL",
    equipment.serial_number,
    dataX,
    cursorY,
    halfW,
    9,
  );
  drawKeyValue(
    doc,
    "CATEGORY",
    equipment.category?.name ?? "—",
    dataX + halfW + 2 * MM,
    cursorY,
    halfW,
    9,
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

  // Manufacturer / model + next cal or maintenance
  const mfr = [equipment.manufacturer, equipment.model]
    .filter(Boolean)
    .join(" ") || "—";
  doc
    .font("Helvetica")
    .fontSize(7)
    .fillColor("#374151")
    .text(mfr, dataX, cursorY, { width: dataWidth, ellipsis: true });
  cursorY += 3 * MM;

  const nextDue =
    equipment.next_calibration_at ?? equipment.next_maintenance_at;
  const nextLabel = equipment.next_calibration_at
    ? "NEXT CAL"
    : equipment.next_maintenance_at
      ? "NEXT MAINT"
      : null;
  if (nextDue && nextLabel) {
    doc
      .font("Helvetica-Bold")
      .fontSize(6)
      .fillColor("#6b7280")
      .text(nextLabel, dataX, cursorY, {
        width: dataWidth,
        characterSpacing: 0.4,
      });
    doc
      .font("Helvetica-Bold")
      .fontSize(8)
      .fillColor("#000")
      .text(
        formatCompanyDate(nextDue, prefs),
        dataX + 14 * MM,
        cursorY - 0.4 * MM,
        { width: dataWidth - 14 * MM, ellipsis: true },
      );
  }

  // Footer — company name (bottom-right of data column)
  doc
    .font("Helvetica")
    .fontSize(6.5)
    .fillColor("#6b7280")
    .text(companyName, dataX, LABEL_HEIGHT_MM * MM - pad - 2.5 * MM, {
      width: dataWidth,
      align: "right",
    });
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
