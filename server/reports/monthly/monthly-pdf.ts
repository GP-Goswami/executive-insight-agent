// Monthly Strategic Report PDF renderer (PDFKit). Self-contained layout toolkit,
// built-in Helvetica fonts + ASCII trend markers. Output: Buffer + optional save
// to generated-reports/monthly/.

import PDFDocument from "pdfkit";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import type { MonthlyReportContent, KpiMoMYoY } from "./monthly-builder";

const COLOR = {
  ink: "#0f172a",
  body: "#334155",
  muted: "#64748b",
  line: "#e2e8f0",
  brand: "#7c3aed",
  brandDark: "#5b21b6",
  good: "#16a34a",
  bad: "#dc2626",
  warn: "#d97706",
  band: "#f5f3ff",
};

const PAGE = { margin: 50 };
type Doc = InstanceType<typeof PDFDocument>;

const cw = (doc: Doc) => doc.page.width - PAGE.margin * 2;
const bottom = (doc: Doc) => doc.page.height - PAGE.margin;
const ensure = (doc: Doc, n: number) => {
  if (doc.y + n > bottom(doc)) doc.addPage();
};
const num = (n: number) => Math.round(n).toLocaleString();
const deltaText = (pct: number | null) => (pct === null ? "n/a" : `${pct >= 0 ? "+" : ""}${pct}%`);
function deltaColor(pct: number | null, invert = false): string {
  if (pct === null || pct === 0) return COLOR.muted;
  const positive = invert ? pct < 0 : pct > 0;
  return positive ? COLOR.good : COLOR.bad;
}

function sectionHeading(doc: Doc, index: number, title: string): void {
  ensure(doc, 56);
  doc.moveDown(0.8);
  const y = doc.y;
  doc.rect(PAGE.margin, y, 4, 18).fill(COLOR.brand);
  doc.fillColor(COLOR.ink).font("Helvetica-Bold").fontSize(14).text(`${index}. ${title}`, PAGE.margin + 12, y - 1);
  doc.moveTo(PAGE.margin, doc.y + 4).lineTo(doc.page.width - PAGE.margin, doc.y + 4).strokeColor(COLOR.line).lineWidth(1).stroke();
  doc.moveDown(0.8);
  doc.fillColor(COLOR.body).font("Helvetica").fontSize(10);
}

function paragraph(doc: Doc, text: string): void {
  ensure(doc, 36);
  doc.fillColor(COLOR.body).font("Helvetica").fontSize(10).text(text, PAGE.margin, doc.y, { width: cw(doc), lineGap: 3, align: "justify" });
  doc.moveDown(0.6);
}

function noteLine(doc: Doc, text: string): void {
  ensure(doc, 20);
  doc.fillColor(COLOR.muted).font("Helvetica-Oblique").fontSize(9).text(text, PAGE.margin, doc.y, { width: cw(doc) });
  doc.moveDown(0.4);
}

// KPI table with MoM + YoY columns.
function kpiTable(doc: Doc, kpis: KpiMoMYoY[], yoyAvailable: boolean): void {
  const totalW = cw(doc);
  const widths = [0.34, 0.22, 0.22, 0.22].map((f) => f * totalW);
  const headers = ["Metric", "This month", "MoM", yoyAvailable ? "YoY" : "YoY (n/a)"];
  const rowH = 20;

  const drawHeader = () => {
    const y = doc.y;
    doc.rect(PAGE.margin, y, totalW, rowH).fill(COLOR.brandDark);
    let x = PAGE.margin;
    headers.forEach((h, i) => {
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8.5).text(h.toUpperCase(), x + 6, y + 6, { width: widths[i] - 12, align: i === 0 ? "left" : "right" });
      x += widths[i];
    });
    doc.y = y + rowH;
  };

  ensure(doc, rowH * 3);
  drawHeader();
  kpis.forEach((k, r) => {
    if (doc.y + rowH > bottom(doc)) {
      doc.addPage();
      drawHeader();
    }
    const y = doc.y;
    if (r % 2 === 1) doc.rect(PAGE.margin, y, totalW, rowH).fill(COLOR.band);
    const valueStr = `${num(k.current)}${k.unit === "pct" ? "%" : ""}`;
    const invert = k.unit === "position";
    let x = PAGE.margin;
    doc.fillColor(COLOR.ink).font("Helvetica-Bold").fontSize(9).text(k.label, x + 6, y + 6, { width: widths[0] - 12 });
    x += widths[0];
    doc.fillColor(COLOR.body).font("Helvetica").fontSize(9).text(valueStr, x + 6, y + 6, { width: widths[1] - 12, align: "right" });
    x += widths[1];
    doc.fillColor(deltaColor(k.mom.deltaPct, invert)).font("Helvetica-Bold").fontSize(9).text(deltaText(k.mom.deltaPct), x + 6, y + 6, { width: widths[2] - 12, align: "right" });
    x += widths[2];
    const yoyStr = yoyAvailable ? deltaText(k.yoy.deltaPct) : "—";
    doc.fillColor(yoyAvailable ? deltaColor(k.yoy.deltaPct, invert) : COLOR.muted).font("Helvetica-Bold").fontSize(9).text(yoyStr, x + 6, y + 6, { width: widths[3] - 12, align: "right" });
    doc.y = y + rowH;
  });
  doc.moveDown(0.5);
}

function genericTable(doc: Doc, headers: Array<{ label: string; width: number; align?: "left" | "right" }>, rows: string[][]): void {
  const totalW = cw(doc);
  const widths = headers.map((h) => h.width * totalW);
  const rowH = 18;
  const drawHeader = () => {
    const y = doc.y;
    doc.rect(PAGE.margin, y, totalW, rowH).fill(COLOR.brandDark);
    let x = PAGE.margin;
    headers.forEach((h, i) => {
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8.5).text(h.label.toUpperCase(), x + 6, y + 5, { width: widths[i] - 12, align: h.align ?? "left" });
      x += widths[i];
    });
    doc.y = y + rowH;
  };
  ensure(doc, rowH * 2);
  drawHeader();
  rows.forEach((row, r) => {
    if (doc.y + rowH > bottom(doc)) {
      doc.addPage();
      drawHeader();
    }
    const y = doc.y;
    if (r % 2 === 1) doc.rect(PAGE.margin, y, totalW, rowH).fill(COLOR.band);
    let x = PAGE.margin;
    headers.forEach((h, i) => {
      doc.fillColor(COLOR.body).font("Helvetica").fontSize(9).text(row[i] ?? "", x + 6, y + 5, { width: widths[i] - 12, align: h.align ?? "left", ellipsis: true, lineBreak: false });
      x += widths[i];
    });
    doc.y = y + rowH;
  });
  doc.moveDown(0.5);
}

function coverHeader(doc: Doc, content: MonthlyReportContent): void {
  const { meta } = content;
  doc.rect(0, 0, doc.page.width, 110).fill(COLOR.brandDark);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(22).text("Monthly Strategic SEO Report", PAGE.margin, 32);
  doc.font("Helvetica").fontSize(11).fillColor("#ede9fe").text(`${meta.domain}  ·  ${meta.current.start} to ${meta.current.end}`, PAGE.margin, 64);
  doc.fontSize(8.5).fillColor("#ddd6fe").text(`Generated ${new Date(meta.generatedAt).toLocaleString()}  ·  MoM vs ${meta.previous.start}–${meta.previous.end}  ·  YoY vs ${meta.yearAgo.start}–${meta.yearAgo.end}`, PAGE.margin, 82);
  doc.y = 130;
  doc.fillColor(COLOR.body);
}

export function generateMonthlyPdf(content: MonthlyReportContent): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: PAGE.margin, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      coverHeader(doc, content);

      // 1. Executive Narrative
      sectionHeading(doc, 1, "Executive Narrative");
      if (content.executiveNarrative.length) content.executiveNarrative.forEach((p) => paragraph(doc, p));
      else paragraph(doc, "No narrative available for this period.");

      // 2. KPI Performance (MoM + YoY)
      sectionHeading(doc, 2, "KPI Performance — Month-over-Month & Year-over-Year");
      const yoyAvailable = content.kpis.some((k) => k.yoyAvailable);
      kpiTable(doc, content.kpis, yoyAvailable);
      if (!yoyAvailable) noteLine(doc, "Year-over-year comparison not yet available — this is the first year of tracked data.");

      // 3. Content Portfolio Health
      sectionHeading(doc, 3, "Content Portfolio Health");
      genericTable(
        doc,
        [
          { label: "Signal", width: 0.55 },
          { label: "Value", width: 0.3, align: "right" },
          { label: "Status", width: 0.15, align: "right" },
        ],
        content.contentPortfolio.signals.map((s) => [s.label, s.value, s.status.toUpperCase()]),
      );
      doc.moveDown(0.2);
      if (content.contentPortfolio.topPages.length) {
        genericTable(
          doc,
          [
            { label: "Top Page", width: 0.55 },
            { label: "Users", width: 0.15, align: "right" },
            { label: "Sessions", width: 0.15, align: "right" },
            { label: "Conv.", width: 0.15, align: "right" },
          ],
          content.contentPortfolio.topPages.map((p) => [p.page, num(p.users), num(p.sessions), num(p.conversions)]),
        );
      }

      // 4. Technical SEO Health Trend
      sectionHeading(doc, 4, "Technical SEO Health Trend");
      genericTable(
        doc,
        [
          { label: "Window", width: 0.4 },
          { label: "Ending", width: 0.3, align: "right" },
          { label: "Score", width: 0.15, align: "right" },
          { label: "Status", width: 0.15, align: "right" },
        ],
        content.technicalHealthTrend.map((h) => [h.label, h.period, `${h.score}/100`, h.status]),
      );
      const first = content.technicalHealthTrend[0];
      const last = content.technicalHealthTrend[content.technicalHealthTrend.length - 1];
      if (first && last) {
        const dir = last.score > first.score ? "improving" : last.score < first.score ? "declining" : "stable";
        noteLine(doc, `Trend over the last 3 windows: ${dir} (${first.score} -> ${last.score}).`);
      }

      // 5. 30-Day Strategic Roadmap
      sectionHeading(doc, 5, "30-Day Strategic Roadmap");
      for (const item of content.roadmap) {
        ensure(doc, 50);
        doc.fillColor(COLOR.brandDark).font("Helvetica-Bold").fontSize(11).text(item.timeframe, PAGE.margin, doc.y);
        doc.fillColor(COLOR.ink).font("Helvetica-Bold").fontSize(9.5).text(item.focus, PAGE.margin, doc.y + 1, { width: cw(doc) });
        doc.moveDown(0.2);
        for (const action of item.actions) {
          ensure(doc, 18);
          const y = doc.y;
          doc.circle(PAGE.margin + 6, y + 5, 1.8).fill(COLOR.brand);
          doc.fillColor(COLOR.body).font("Helvetica").fontSize(9.5).text(action, PAGE.margin + 16, y, { width: cw(doc) - 16, lineGap: 1 });
          doc.moveDown(0.2);
        }
        doc.moveDown(0.4);
      }

      // 6. Appendix — Agent Run IDs
      sectionHeading(doc, 6, "Appendix — Agent Run IDs");
      paragraph(doc, "Traceability anchor: every figure in this report derives from the agent runs below. Run IDs are queryable in the Agent Console.");
      genericTable(
        doc,
        [
          { label: "Agent", width: 0.15 },
          { label: "Run ID", width: 0.45 },
          { label: "Status", width: 0.18, align: "right" },
          { label: "Started", width: 0.22, align: "right" },
        ],
        content.appendix.agentRuns.map((r) => [r.agentId, r.runId, r.status, (r.startedAt ?? "").slice(0, 19).replace("T", " ")]),
      );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

export async function saveMonthlyPdf(content: MonthlyReportContent): Promise<{ buffer: Buffer; filePath: string; fileName: string }> {
  const buffer = await generateMonthlyPdf(content);
  const dir = path.resolve(process.cwd(), "generated-reports", "monthly");
  await mkdir(dir, { recursive: true });
  const safeDomain = content.meta.domain.replace(/[^a-z0-9.-]/gi, "-");
  const month = content.meta.current.end.slice(0, 7);
  const fileName = `${safeDomain}-monthly-${month}.pdf`;
  const filePath = path.join(dir, fileName);
  await writeFile(filePath, buffer);
  return { buffer, filePath, fileName };
}
