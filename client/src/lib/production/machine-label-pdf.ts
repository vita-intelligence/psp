import "server-only";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { formatCompanyDate, type FormatPrefs } from "../format/company";
import type { Machine } from "./types";

// 1 mm in PDF points (72 dpi / 25.4 mm). Same units as the lot label
// so a mixed roll of "lot + machine" labels prints identically.
const MM = 2.83464567;
const LABEL_WIDTH_MM = 100;
const LABEL_HEIGHT_MM = 60;

interface LabelInput {
  machine: Machine;
  companyName: string;
  /** Absolute URL encoded in the QR. Same scheme as the lot label —
   *  points at the desktop URL; the mobile scanner regex rewrites it
   *  to `/m/machines/<uuid>` on the phone. */
  machineUrl: string;
  copies: number;
  prefs: FormatPrefs;
}

/**
 * Render a thermal-label PDF for `machine`, repeating it `copies`
 * times. Mirrors `stock/label-pdf.ts` — same 100×60mm page + QR-on-
 * the-left layout so operators can print machine + lot labels on the
 * same Zebra / Brother roll without swapping media.
 *
 * Layout: QR on the left (~32mm square), data column on the right
 * with the machine name in big type, asset tag under the QR, and
 * calibration due + attached workstation in the data column.
 */
export async function renderMachineLabelPdf(
  input: LabelInput,
): Promise<Buffer> {
  const { machine, companyName, machineUrl, copies, prefs } = input;

  const qrPng = await QRCode.toBuffer(machineUrl, {
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
      Title: machine.name,
      Author: companyName,
      Subject: "Machine label",
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
    drawLabel(doc, machine, companyName, qrPng, prefs);
  }

  doc.end();
  await finished;
  return Buffer.concat(chunks);
}

function drawLabel(
  doc: PDFKit.PDFDocument,
  machine: Machine,
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

  // Asset tag caption under QR — the human-readable ID an operator
  // uses when radioing / logging. Falls back to a shortened UUID so
  // there's always something to say.
  doc
    .font("Helvetica-Bold")
    .fontSize(7)
    .fillColor("#000")
    .text(
      machine.asset_tag ?? machine.uuid.slice(0, 8).toUpperCase(),
      qrX,
      qrY + qrSize + 1.5 * MM,
      { width: qrSize, align: "center" },
    );

  // ---- right column ----
  let cursorY = pad;

  // MACHINE label
  doc
    .font("Helvetica-Bold")
    .fontSize(6)
    .fillColor("#6b7280")
    .text("MACHINE", dataX, cursorY, {
      width: dataWidth,
      characterSpacing: 0.4,
    });
  cursorY += 2.5 * MM;

  // Machine name — hero. Auto-shrinks with two lines allowed then
  // ellipsis, so long product names ("Sartorius MSU3202S-CE") still
  // fit without spilling into the meta row.
  doc
    .font("Helvetica-Bold")
    .fontSize(16)
    .fillColor("#000")
    .text(machine.name, dataX, cursorY, {
      width: dataWidth,
      height: 12 * MM,
      ellipsis: true,
      lineGap: 0,
    });
  cursorY += 12 * MM;

  // Workstation attachment + calibration status, two columns
  const halfW = (dataWidth - 2 * MM) / 2;
  drawKeyValue(
    doc,
    "WORKSTATION",
    machine.workstation?.name ?? "—",
    dataX,
    cursorY,
    halfW,
    10,
  );
  drawKeyValue(
    doc,
    "CAL DUE",
    machine.next_calibration_due_at
      ? formatCompanyDate(machine.next_calibration_due_at, prefs)
      : "—",
    dataX + halfW + 2 * MM,
    cursorY,
    halfW,
    10,
    machine.calibration_overdue ? "#b91c1c" : "#000",
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

  // Manufacturer + model on one line
  const makeModel = [machine.manufacturer, machine.model]
    .filter(Boolean)
    .join(" ");
  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor("#000")
    .text(makeModel || "—", dataX, cursorY, {
      width: dataWidth,
      height: 6 * MM,
      ellipsis: true,
      lineGap: 0,
    });
  cursorY += 6 * MM;

  // asset · serial · rate
  const rate = machine.hourly_rate_enabled && machine.hourly_rate
    ? `${machine.hourly_rate}/h`
    : "no rate";
  const parts = [
    machine.asset_tag ?? "no tag",
    machine.serial_number ? `S/N ${machine.serial_number}` : null,
    rate,
  ].filter(Boolean);
  doc
    .font("Courier")
    .fontSize(7)
    .fillColor("#374151")
    .text(parts.join(" · "), dataX, cursorY, {
      width: dataWidth,
      ellipsis: true,
    });

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
  valueColor = "#000",
) {
  doc
    .font("Helvetica-Bold")
    .fontSize(6)
    .fillColor("#6b7280")
    .text(label, x, y, { width, characterSpacing: 0.4 });
  doc
    .font("Helvetica-Bold")
    .fontSize(valuePt)
    .fillColor(valueColor)
    .text(value, x, y + 2.5 * MM, { width, ellipsis: true });
}
