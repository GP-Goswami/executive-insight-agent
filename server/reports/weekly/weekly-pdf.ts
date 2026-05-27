// Weekly Report PDF renderer (PDFKit). Self-contained layout toolkit so the
// weekly report stays decoupled from the legacy executive PDF generator. Uses
// only built-in Helvetica fonts + ASCII trend markers for portable rendering.
//
// Output: returns a Buffer and (optionally) writes to generated-reports/weekly/.

import PDFDocument from "pdfkit";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import type { WeeklyReportContent } from "./weekly-builder";
import type { MetricDelta } from "../shared/report-data";

// ── Palette ─────────────────────────────────────────────────────────────────
const COLOR = {
  ink: "#0f172a",
  body: "#334155",
  muted: "#64748b",
  line: "#e2e8f0",
  brand: "#0ea5e9",
  brandDark: "#0369a1",
  good: "#16a34a",
  bad: "#dc2626",
  warn: "#d97706",
  band: "#f1f5f9",
};

const PAGE = { margin: 50 };

type Doc = InstanceType<typeof PDFDocument>;

function contentWidth(doc: Doc): number {
  return doc.page.width - PAGE.margin * 2;
}
function bottom(doc: Doc): number {
  return doc.page.height - PAGE.margin;
}
function ensureSpace(doc: Doc, needed: number): void {
  if (doc.y + needed > bottom(doc)) doc.addPage();
}

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString();
}
function fmtPct(d: MetricDelta): string {
  if (d.deltaPct === null) return "n/a";
  const sign = d.deltaPct >= 0 ? "+" : "";
  return `${sign}${d.deltaPct}%`;
}
function deltaColor(d: MetricDelta, invert = false): string {
  if (d.deltaPct === null || d.deltaPct === 0) return COLOR.muted;
  const positive = invert ? d.deltaPct < 0 : d.deltaPct > 0;
  return positive ? COLOR.good : COLOR.bad;
}

// ── Section heading ───────────────────────────────────────────────────────────
function sectionHeading(doc: Doc, index: number, title: string): void {
  ensureSpace(doc, 56);
  doc.moveDown(0.8);
  const y = doc.y;
  doc.rect(PAGE.margin, y, 4, 18).fill(COLOR.brand);
  doc
    .fillColor(COLOR.ink)
    .font("Helvetica-Bold")
    .fontSize(14)
    .text(`${index}. ${title}`, PAGE.margin + 12, y - 1);
  doc.moveTo(PAGE.margin, doc.y + 4).lineTo(doc.page.width - PAGE.margin, doc.y + 4).strokeColor(COLOR.line).lineWidth(1).stroke();
  doc.moveDown(0.8);
  doc.fillColor(COLOR.body).font("Helvetica").fontSize(10);
}

function paragraph(doc: Doc, text: string): void {
  ensureSpace(doc, 30);
  doc.fillColor(COLOR.body).font("Helvetica").fontSize(10).text(text, PAGE.margin, doc.y, { width: contentWidth(doc), lineGap: 2 });
  doc.moveDown(0.4);
}

function bullets(doc: Doc, items: string[]): void {
  doc.font("Helvetica").fontSize(10).fillColor(COLOR.body);
  for (const item of items) {
    ensureSpace(doc, 22);
    const y = doc.y;
    doc.circle(PAGE.margin + 3, y + 5, 1.8).fill(COLOR.brand);
    doc.fillColor(COLOR.body).text(item, PAGE.margin + 14, y, { width: contentWidth(doc) - 14, lineGap: 2 });
    doc.moveDown(0.3);
  }
}

// ── KPI grid (3 columns) with WoW delta ─────────────────────────────────────────
function kpiGrid(
  doc: Doc,
  cards: Array<{ label: string; value: string; delta?: MetricDelta; invert?: boolean }>,
): void {
  const cols = 3;
  const gap = 12;
  const cardW = (contentWidth(doc) - gap * (cols - 1)) / cols;
  const cardH = 60;
  for (let i = 0; i < cards.length; i += cols) {
    ensureSpace(doc, cardH + 10);
    const rowY = doc.y;
    for (let c = 0; c < cols; c++) {
      const card = cards[i + c];
      if (!card) continue;
      const x = PAGE.margin + c * (cardW + gap);
      doc.roundedRect(x, rowY, cardW, cardH, 6).fillAndStroke(COLOR.band, COLOR.line);
      doc.fillColor(COLOR.muted).font("Helvetica-Bold").fontSize(8).text(card.label.toUpperCase(), x + 10, rowY + 9, { width: cardW - 20 });
      doc.fillColor(COLOR.ink).font("Helvetica-Bold").fontSize(18).text(card.value, x + 10, rowY + 22, { width: cardW - 20 });
      if (card.delta) {
        doc
          .fillColor(deltaColor(card.delta, card.invert))
          .font("Helvetica-Bold")
          .fontSize(9)
          .text(`${fmtPct(card.delta)} WoW`, x + 10, rowY + 44, { width: cardW - 20 });
      }
    }
    doc.y = rowY + cardH + 10;
  }
}

// ── Table ─────────────────────────────────────────────────────────────────────
interface Column {
  header: string;
  width: number; // fraction of content width
  align?: "left" | "right";
  color?: (row: string[]) => string;
}
function table(doc: Doc, columns: Column[], rows: string[][]): void {
  const totalW = contentWidth(doc);
  const widths = columns.map((c) => c.width * totalW);
  const rowH = 18;

  const drawHeader = () => {
    const y = doc.y;
    doc.rect(PAGE.margin, y, totalW, rowH).fill(COLOR.brandDark);
    let x = PAGE.margin;
    columns.forEach((col, i) => {
      doc
        .fillColor("#ffffff")
        .font("Helvetica-Bold")
        .fontSize(8.5)
        .text(col.header.toUpperCase(), x + 6, y + 5, { width: widths[i] - 12, align: col.align ?? "left" });
      x += widths[i];
    });
    doc.y = y + rowH;
  };

  ensureSpace(doc, rowH * 2);
  drawHeader();
  rows.forEach((row, r) => {
    if (doc.y + rowH > bottom(doc)) {
      doc.addPage();
      drawHeader();
    }
    const y = doc.y;
    if (r % 2 === 1) doc.rect(PAGE.margin, y, totalW, rowH).fill(COLOR.band);
    let x = PAGE.margin;
    columns.forEach((col, i) => {
      doc
        .fillColor(col.color ? col.color(row) : COLOR.body)
        .font("Helvetica")
        .fontSize(9)
        .text(row[i] ?? "", x + 6, y + 5, { width: widths[i] - 12, align: col.align ?? "left", ellipsis: true, lineBreak: false });
      x += widths[i];
    });
    doc.y = y + rowH;
  });
  doc.moveDown(0.5);
}

function noteLine(doc: Doc, text: string): void {
  ensureSpace(doc, 20);
  doc.fillColor(COLOR.muted).font("Helvetica-Oblique").fontSize(9).text(text, PAGE.margin, doc.y, { width: contentWidth(doc) });
  doc.moveDown(0.4);
}

// ── Cover header ────────────────────────────────────────────────────────────────
function coverHeader(doc: Doc, content: WeeklyReportContent): void {
  const { meta } = content;
  doc.rect(0, 0, doc.page.width, 110).fill(COLOR.brandDark);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(22).text("Weekly SEO Report", PAGE.margin, 32);
  doc
    .font("Helvetica")
    .fontSize(11)
    .fillColor("#e0f2fe")
    .text(`${meta.domain}  ·  Week ${meta.weekNumber}  ·  ${meta.current.start} to ${meta.current.end}`, PAGE.margin, 64);
  doc
    .fontSize(8.5)
    .fillColor("#bae6fd")
    .text(`Generated ${new Date(meta.generatedAt).toLocaleString()}  ·  vs ${meta.previous.start} to ${meta.previous.end}`, PAGE.margin, 82);
  doc.y = 130;
  doc.fillColor(COLOR.body);
}

// ── Main ────────────────────────────────────────────────────────────────────────
export function generateWeeklyPdf(content: WeeklyReportContent): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: PAGE.margin, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const s = content.trafficSnapshot;
      coverHeader(doc, content);

      // 1. Executive Summary
      sectionHeading(doc, 1, "Executive Summary");
      if (content.executiveSummary.length) bullets(doc, content.executiveSummary);
      else paragraph(doc, "No executive summary available for this period.");

      // 2. Traffic Snapshot (WoW)
      sectionHeading(doc, 2, "Traffic Snapshot (Week-over-Week)");
      kpiGrid(doc, [
        { label: "Users", value: fmtNum(s.users.current), delta: s.users },
        { label: "Sessions", value: fmtNum(s.sessions.current), delta: s.sessions },
        { label: "Conversions", value: fmtNum(s.conversions.current), delta: s.conversions },
        { label: "GSC Clicks", value: fmtNum(s.clicks.current), delta: s.clicks },
        { label: "Impressions", value: fmtNum(s.impressions.current), delta: s.impressions },
        { label: "CTR", value: `${s.ctr.current}%`, delta: s.ctr },
        { label: "Avg Position", value: `${s.avgPosition.current}`, delta: s.avgPosition, invert: true },
        { label: "Engaged Sess.", value: fmtNum(s.engagedSessions.current), delta: s.engagedSessions },
      ]);
      noteLine(doc, "Deltas compare the report week against the prior 7 days. Green = favourable movement.");

      // 3. Ranking Movement
      sectionHeading(doc, 3, "Ranking Movement (Search Console)");
      if (content.rankingMovement.length) {
        table(
          doc,
          [
            { header: "Query", width: 0.4 },
            { header: "Clicks", width: 0.12, align: "right" },
            { header: "Impr.", width: 0.14, align: "right" },
            { header: "Pos.", width: 0.12, align: "right" },
            {
              header: "Move",
              width: 0.22,
              align: "right",
              color: (row) => (row[4].startsWith("up") ? COLOR.good : row[4].startsWith("down") ? COLOR.bad : COLOR.muted),
            },
          ],
          content.rankingMovement.map((r) => [
            r.query,
            fmtNum(r.clicks),
            fmtNum(r.impressions),
            String(r.position),
            r.positionDelta === null ? "new" : r.positionDelta > 0 ? `up ${r.positionDelta}` : r.positionDelta < 0 ? `down ${Math.abs(r.positionDelta)}` : "flat",
          ]),
        );
      } else {
        paragraph(doc, "No ranking data available for this period.");
      }

      // 4. Technical Health
      sectionHeading(doc, 4, "Technical Health");
      paragraph(doc, `Overall technical health score: ${content.technicalHealth.score}/100 — ${content.technicalHealth.status}.`);
      table(
        doc,
        [
          { header: "Signal", width: 0.6 },
          { header: "Value", width: 0.22, align: "right" },
          {
            header: "Status",
            width: 0.18,
            align: "right",
            color: (row) => (row[2] === "GOOD" ? COLOR.good : row[2] === "WARN" ? COLOR.warn : COLOR.bad),
          },
        ],
        content.technicalHealth.signals.map((sig) => [sig.label, sig.value, sig.status.toUpperCase()]),
      );

      // 5. Content Highlights
      sectionHeading(doc, 5, "Content Highlights (Top Pages)");
      if (content.contentHighlights.length) {
        table(
          doc,
          [
            { header: "Page", width: 0.52 },
            { header: "Users", width: 0.16, align: "right" },
            { header: "Sessions", width: 0.16, align: "right" },
            { header: "Conv.", width: 0.16, align: "right" },
          ],
          content.contentHighlights.map((p) => [p.page, fmtNum(p.users), fmtNum(p.sessions), fmtNum(p.conversions)]),
        );
      } else {
        paragraph(doc, "No GA4 page data available for this period.");
      }

      // 6. Backlink Summary
      sectionHeading(doc, 6, "Backlink Summary");
      kpiGrid(doc, [
        { label: "Total Backlinks", value: fmtNum(content.backlinks.backlinks) },
        { label: "Referring Domains", value: fmtNum(content.backlinks.referringDomains) },
        { label: "Domain Rank", value: fmtNum(content.backlinks.domainRank) },
      ]);
      if (content.backlinks.note) noteLine(doc, content.backlinks.note);

      // 7. AEO Snapshot
      sectionHeading(doc, 7, "AEO Snapshot (AI Assistant Referrals)");
      if (content.aeo.sources.length) {
        paragraph(doc, `Total AI-assistant referred users this week: ${fmtNum(content.aeo.totalAiUsers)}.`);
        table(
          doc,
          [
            { header: "AI Source", width: 0.6 },
            { header: "Users", width: 0.2, align: "right" },
            { header: "Sessions", width: 0.2, align: "right" },
          ],
          content.aeo.sources.map((a) => [a.source, fmtNum(a.users), fmtNum(a.sessions)]),
        );
      } else {
        paragraph(doc, content.aeo.note ?? "No AI-assistant referral traffic detected this period.");
      }

      // 8. This Week's Actions
      sectionHeading(doc, 8, "This Week's Actions");
      if (content.actions.length) {
        for (const a of content.actions) {
          ensureSpace(doc, 40);
          const y = doc.y;
          doc.fillColor(COLOR.brandDark).font("Helvetica-Bold").fontSize(10).text(`P${a.priority}.`, PAGE.margin, y, { continued: true });
          doc.fillColor(COLOR.ink).font("Helvetica-Bold").text(` ${a.statement}`, { width: contentWidth(doc) });
          doc
            .fillColor(COLOR.muted)
            .font("Helvetica")
            .fontSize(8.5)
            .text(`Effort: ${a.effort}  ·  Impact: ${a.impact}  ·  Owner: ${a.ownerRole}`, PAGE.margin + 14, doc.y + 1);
          doc.moveDown(0.6);
        }
      } else {
        paragraph(doc, "No recommendations available. Run the recommendation synthesis agent (A09) to populate actions.");
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/** Generate and persist the weekly PDF under generated-reports/weekly/. */
export async function saveWeeklyPdf(content: WeeklyReportContent): Promise<{ buffer: Buffer; filePath: string; fileName: string }> {
  const buffer = await generateWeeklyPdf(content);
  const dir = path.resolve(process.cwd(), "generated-reports", "weekly");
  await mkdir(dir, { recursive: true });
  const safeDomain = content.meta.domain.replace(/[^a-z0-9.-]/gi, "-");
  const fileName = `${safeDomain}-weekly-w${content.meta.weekNumber}-${content.meta.current.end}.pdf`;
  const filePath = path.join(dir, fileName);
  await writeFile(filePath, buffer);
  return { buffer, filePath, fileName };
}
