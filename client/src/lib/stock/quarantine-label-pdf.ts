import "server-only";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import {
  formatCompanyDate,
  formatCompanyNumber,
  type FormatPrefs,
} from "../format/company";

// 1 mm in PDF points (72 dpi / 25.4 mm). Matches `label-pdf.ts`.
const MM = 2.83464567;
const LABEL_WIDTH_MM = 100;
const LABEL_HEIGHT_MM = 60;

export interface QuarantineLabelInput {
  inspectionCode: string | null;
  inspectionUuid: string;
  inspectionDate: string | null;
  poCode: string | null;
  vendorName: string | null;
  itemName: string;
  itemCode: string | null;
  qty: string;
  uomSymbol: string | null;
  packIndex: number;
  packCount: number;
  packLengthMm: number;
  packWidthMm: number;
  packHeightMm: number;
  packWeightKg: string;
  supplierBatchNo: string | null;
  companyName: string;
  /** Public URL to the inspection — encoded into the QR. */
  inspectionUrl: string;
  copies: number;
  prefs: FormatPrefs;
}

/**
 * Render a quarantine-status label PDF for one pack on a goods-in
 * inspection. Repeats `copies` times. Same physical 100×60 mm sheet
 * as the regular stock label so it lands on the same Zebra / Brother
 * roll.
 *
 * Visual difference: an amber-on-black "QUARANTINE — DO NOT USE"
 * banner across the top, the inspection + pack identity replacing
 * the lot code (lots don't exist yet — they're created on QC
 * approval). Once QC approves, a regular `label-pdf` print covers
 * the released lot.
 */
export async function renderQuarantineLabelPdf(
  input: QuarantineLabelInput,
): Promise<Buffer> {
  const qrPng = await QRCode.toBuffer(input.inspectionUrl, {
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
      Title: `Quarantine ${input.inspectionCode ?? input.inspectionUuid.slice(0, 8)} · pack ${input.packIndex + 1}`,
      Author: input.companyName,
      Subject: "Quarantine label",
    },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve) => doc.on("end", () => resolve()));

  for (let i = 0; i < input.copies; i++) {
    doc.addPage({
      size: [LABEL_WIDTH_MM * MM, LABEL_HEIGHT_MM * MM],
      margin: 0,
    });
    drawQuarantineLabel(doc, input, qrPng);
  }

  doc.end();
  await finished;
  return Buffer.concat(chunks);
}

function drawQuarantineLabel(
  doc: PDFKit.PDFDocument,
  input: QuarantineLabelInput,
  qrPng: Buffer,
) {
  const pad = 3 * MM;
  const bannerH = 7 * MM;
  const labelW = LABEL_WIDTH_MM * MM;
  const labelH = LABEL_HEIGHT_MM * MM;

  // Top banner — high-contrast amber so the operator can spot a
  // quarantine pack across the dock at a glance.
  doc
    .rect(0, 0, labelW, bannerH)
    .fillColor("#b45309")
    .fill();
  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor("#fff")
    .text("QUARANTINE — DO NOT USE", 0, 1.8 * MM, {
      width: labelW,
      align: "center",
      characterSpacing: 0.6,
    });

  // Body layout: QR on left, data column on right.
  const bodyTop = bannerH + pad;
  const qrSize = 25 * MM;
  const qrX = pad;
  const qrY = bodyTop;
  const dataX = qrX + qrSize + 3 * MM;
  const dataWidth = labelW - dataX - pad;

  doc.image(qrPng, qrX, qrY, { width: qrSize, height: qrSize });

  // GI code under QR
  doc
    .font("Helvetica-Bold")
    .fontSize(6.5)
    .fillColor("#000")
    .text(input.inspectionCode ?? "GI —", qrX, qrY + qrSize + 1.2 * MM, {
      width: qrSize,
      align: "center",
    });

  // Right column
  let cy = bodyTop;

  // Item name — hero
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor("#000")
    .text(input.itemName, dataX, cy, {
      width: dataWidth,
      height: 6 * MM,
      ellipsis: true,
    });
  cy += 5.5 * MM;

  // Item code · vendor
  doc
    .font("Courier")
    .fontSize(6.5)
    .fillColor("#374151")
    .text(
      [input.itemCode, input.vendorName].filter(Boolean).join(" · ") || "—",
      dataX,
      cy,
      { width: dataWidth, ellipsis: true },
    );
  cy += 3.5 * MM;

  // Big qty + pack-of-pack
  const qtyLine = `${formatCompanyNumber(input.qty, input.prefs)}${input.uomSymbol ? " " + input.uomSymbol : ""}`;
  doc
    .font("Helvetica-Bold")
    .fontSize(14)
    .fillColor("#000")
    .text(qtyLine, dataX, cy, { width: dataWidth });
  cy += 6 * MM;

  doc
    .font("Helvetica")
    .fontSize(7)
    .fillColor("#374151")
    .text(
      `Pack ${input.packIndex + 1} of ${input.packCount} · ${input.packLengthMm}×${input.packWidthMm}×${input.packHeightMm} mm · ${formatCompanyNumber(input.packWeightKg, input.prefs)} kg`,
      dataX,
      cy,
      { width: dataWidth, ellipsis: true },
    );
  cy += 3.5 * MM;

  // PO + batch + date
  const meta = [
    input.poCode ? `PO ${input.poCode}` : null,
    input.supplierBatchNo ? `Batch ${input.supplierBatchNo}` : null,
    input.inspectionDate ? formatCompanyDate(input.inspectionDate, input.prefs) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  doc
    .font("Courier")
    .fontSize(6.5)
    .fillColor("#6b7280")
    .text(meta || "—", dataX, cy, { width: dataWidth, ellipsis: true });

  // Footer — company name, bottom-right of label
  doc
    .font("Helvetica")
    .fontSize(6)
    .fillColor("#6b7280")
    .text(
      input.companyName,
      pad,
      labelH - pad - 2.5 * MM,
      { width: labelW - 2 * pad, align: "right" },
    );
}
