import "server-only";
import PDFDocument from "pdfkit";
import {
  formatCompanyDate,
  formatCompanyMoney,
  formatCompanyNumber,
  type FormatPrefs,
} from "../format/company";
import type { BOM } from "./types";

interface RenderInput {
  bom: BOM;
  companyName: string;
  prefs: FormatPrefs;
}

/**
 * Render the BOM as a printable PDF. A4 portrait, header + parts
 * table + total + version history. Uses Helvetica only (PDF
 * standard font) so we don't ship font files.
 *
 * Mirrors the layout pattern of the stock label PDF — same pdfkit
 * pipeline, same buffer-collection idiom — so the Next.js Route
 * Handler can stream it inline.
 */
export async function renderBOMPdf(input: RenderInput): Promise<Buffer> {
  const { bom, companyName, prefs } = input;
  const doc = new PDFDocument({
    size: "A4",
    margin: 40,
    info: {
      Title: bom.code ?? `BOM ${bom.id}`,
      Author: companyName,
      Subject: "Bill of Materials",
    },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve) =>
    doc.on("end", () => resolve()),
  );

  drawHeader(doc, bom, companyName, prefs);
  drawParts(doc, bom, prefs);
  drawVersions(doc, bom, prefs);

  doc.end();
  await finished;
  return Buffer.concat(chunks);
}

function drawHeader(
  doc: PDFKit.PDFDocument,
  bom: BOM,
  companyName: string,
  prefs: FormatPrefs,
) {
  doc
    .font("Helvetica-Bold")
    .fontSize(16)
    .fillColor("#000")
    .text(bom.name);

  doc
    .moveDown(0.2)
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#374151")
    .text(
      [
        bom.code ? `BOM ${bom.code}` : `BOM #${bom.id}`,
        bom.item ? `Output: ${bom.item.name}` : null,
        bom.item?.code ? `(${bom.item.code})` : null,
        bom.is_primary ? "Primary recipe" : null,
        !bom.is_active ? "Archived" : null,
      ]
        .filter(Boolean)
        .join("  ·  "),
    );

  if (bom.notes) {
    doc
      .moveDown(0.4)
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#374151")
      .text(bom.notes, { width: doc.page.width - 80 });
  }

  doc
    .moveDown(0.8)
    .strokeColor("#000")
    .lineWidth(0.3)
    .opacity(0.2)
    .moveTo(40, doc.y)
    .lineTo(doc.page.width - 40, doc.y)
    .stroke()
    .opacity(1)
    .moveDown(0.6);

  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor("#6b7280")
    .text(`Generated ${formatCompanyDate(new Date().toISOString(), prefs)} · ${companyName}`);

  doc.moveDown(0.8);
}

function drawParts(doc: PDFKit.PDFDocument, bom: BOM, prefs: FormatPrefs) {
  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor("#000")
    .text("Parts");

  doc.moveDown(0.3);

  const tableTop = doc.y;
  const pageWidth = doc.page.width - 80;
  // Column layout (mm-ish): #, Part, UoM, Qty, Fixed, Avg cost
  const cols = {
    no: { x: 40, w: 24 },
    part: { x: 64, w: pageWidth * 0.46 },
    uom: { x: 64 + pageWidth * 0.46, w: pageWidth * 0.08 },
    qty: { x: 64 + pageWidth * 0.54, w: pageWidth * 0.12 },
    fixed: { x: 64 + pageWidth * 0.66, w: pageWidth * 0.08 },
    cost: { x: 64 + pageWidth * 0.74, w: pageWidth * 0.22 },
  };

  // Header row
  doc
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor("#6b7280");
  doc.text("#", cols.no.x, tableTop, { width: cols.no.w });
  doc.text("PART", cols.part.x, tableTop, { width: cols.part.w });
  doc.text("UoM", cols.uom.x, tableTop, { width: cols.uom.w });
  doc.text("QTY", cols.qty.x, tableTop, {
    width: cols.qty.w,
    align: "right",
  });
  doc.text("FIXED", cols.fixed.x, tableTop, {
    width: cols.fixed.w,
    align: "center",
  });
  doc.text("AVG COST", cols.cost.x, tableTop, {
    width: cols.cost.w,
    align: "right",
  });

  let y = tableTop + 14;
  doc
    .strokeColor("#000")
    .lineWidth(0.3)
    .opacity(0.25)
    .moveTo(40, y - 4)
    .lineTo(doc.page.width - 40, y - 4)
    .stroke()
    .opacity(1);

  doc.font("Helvetica").fontSize(9).fillColor("#000");
  let total = 0;
  bom.lines.forEach((line, idx) => {
    const partLabel =
      `${line.part?.name ?? `Item #${line.part_id}`}` +
      (line.part?.code ? `\n${line.part.code}` : "");
    const uom =
      line.unit_of_measurement?.symbol ??
      line.part?.stock_uom?.symbol ??
      "—";
    const qty = formatCompanyNumber(line.qty, prefs);
    const fixed = line.is_fixed ? "Yes" : "—";
    const cost = computeLineCost(line);
    if (cost != null) total += cost;

    doc.text(String(idx + 1), cols.no.x, y, { width: cols.no.w });
    doc.text(partLabel, cols.part.x, y, { width: cols.part.w });
    doc.text(uom, cols.uom.x, y, { width: cols.uom.w });
    doc.text(qty, cols.qty.x, y, { width: cols.qty.w, align: "right" });
    doc.text(fixed, cols.fixed.x, y, {
      width: cols.fixed.w,
      align: "center",
    });
    doc.text(
      cost != null ? formatCompanyMoney(String(cost), prefs) : "—",
      cols.cost.x,
      y,
      { width: cols.cost.w, align: "right" },
    );

    y += line.part?.code ? 24 : 14;
    // Wrap to a new page if running off the bottom — pdfkit's text
    // wrapper does not autopaginate when we're positioning manually.
    if (y > doc.page.height - 100) {
      doc.addPage();
      y = doc.y;
    }
  });

  // Total row
  y += 4;
  doc
    .strokeColor("#000")
    .lineWidth(0.3)
    .opacity(0.25)
    .moveTo(40, y)
    .lineTo(doc.page.width - 40, y)
    .stroke()
    .opacity(1);
  y += 6;

  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor("#000")
    .text("Total", cols.fixed.x - 80, y, {
      width: cols.fixed.w + 80,
      align: "right",
    });
  doc.text(
    total > 0 ? formatCompanyMoney(String(total), prefs) : "—",
    cols.cost.x,
    y,
    { width: cols.cost.w, align: "right" },
  );

  doc.x = 40;
  doc.y = y + 24;
}

function drawVersions(
  doc: PDFKit.PDFDocument,
  bom: BOM,
  prefs: FormatPrefs,
) {
  if (!bom.versions || bom.versions.length === 0) return;

  if (doc.y > doc.page.height - 160) doc.addPage();

  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor("#000")
    .text("Version history");

  doc.moveDown(0.3);

  doc.font("Helvetica").fontSize(9).fillColor("#000");
  bom.versions.forEach((v, idx) => {
    const isCurrent = idx === 0;
    const label = `v${v.version_no}${isCurrent ? " (current)" : ""}`;
    const when = formatCompanyDate(v.inserted_at, prefs);
    const who = v.created_by?.name ?? "—";
    const notes = v.notes ? ` — ${v.notes}` : "";
    doc.text(`${label}  ·  ${when}  ·  ${who}${notes}`, {
      width: doc.page.width - 80,
    });
  });
  doc.moveDown(0.8);
}

function computeLineCost(line: BOM["lines"][number]): number | null {
  const cost = line.average_unit_cost;
  if (cost == null) return null;
  const qty = Number(line.qty);
  const unit = Number(cost);
  if (!Number.isFinite(qty) || !Number.isFinite(unit)) return null;
  return qty * unit;
}
