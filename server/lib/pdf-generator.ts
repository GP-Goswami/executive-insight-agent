import PDFDocument from "pdfkit";
import type { SeoMetrics } from "./seo-metrics";
import type { Insight } from "./insight-engine";

interface TopPage {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface DailyTrends {
  ga4Daily: { date: string; users: number; sessions: number }[];
  gscDaily: { date: string; clicks: number; impressions: number }[];
}

interface KeywordDistribution {
  top3: number;
  top10: number;
  top20: number;
  top50: number;
  top100: number;
  beyond: number;
}

interface AiReferrer {
  source: string;
  totalUsers: number;
  sessions: number;
  percentOfTotal?: number;
}

export interface PdfReportData {
  domain: string;
  dateRange: { start: string; end: string };
  metrics: SeoMetrics;
  insights: Insight[];
  summary: string;
  topPages: TopPage[];
  topPagesSource: "gsc" | "ga4";
  dailyTrends: DailyTrends;
  keywordDistribution: KeywordDistribution;
  aiReferrers?: AiReferrer[];
}

const C = {
  primary: "#1e3a5f",
  accent: "#2563eb",
  positive: "#16a34a",
  warning: "#ca8a04",
  danger: "#dc2626",
  neutral: "#64748b",
  text: "#1e293b",
  textLight: "#64748b",
  textMuted: "#94a3b8",
  bg: "#f8fafc",
  cardBg: "#ffffff",
  border: "#e2e8f0",
  borderLight: "#f1f5f9",
  headerBg: "#0f172a",
  headerAccent: "#1e3a5f",
};

const PW = 595.28;
const PH = 841.89;
const M = 40;
const CW = PW - M * 2;

function sanitize(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014]/g, "--")
    .replace(/\u2026/g, "...")
    .replace(/\u2022/g, "-")
    .replace(/[\u00A0]/g, " ")
    .replace(/[^\x0A\x0D\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
  if (doc.y + needed > PH - 50) {
    doc.addPage();
    doc.y = M;
  }
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string): void {
  ensureSpace(doc, 40);
  doc.font("Helvetica-Bold").fontSize(11).fillColor(C.primary).text(title.toUpperCase(), M, doc.y, { characterSpacing: 0.8 });
  doc.y += 6;
  doc.strokeColor(C.accent).lineWidth(1.5).moveTo(M, doc.y).lineTo(M + 40, doc.y).stroke();
  doc.strokeColor(C.borderLight).lineWidth(0.5).moveTo(M + 42, doc.y).lineTo(PW - M, doc.y).stroke();
  doc.y += 14;
}

function drawKpiCard(doc: PDFKit.PDFDocument, x: number, y: number, w: number, title: string, value: string, accentColor: string, opts?: { subtitle?: string; previousValue?: string; delta?: number; deltaSuffix?: string; benchmarkPass?: boolean; lowVisibility?: boolean }): void {
  const cardH = 68;
  doc.roundedRect(x, y, w, cardH, 4).fillAndStroke(C.cardBg, C.border);
  doc.rect(x, y, 3, cardH).fill(accentColor);
  doc.font("Helvetica").fontSize(7).fillColor(C.textLight).text(title.toUpperCase(), x + 12, y + 8, { width: w - 20, characterSpacing: 0.5 });
  const isNA = value === "N/A";
  doc.font("Helvetica-Bold").fontSize(17).fillColor(isNA ? C.textMuted : C.text).text(value, x + 12, y + 20, { width: w - 20 });

  let bottomY = y + 40;
  if (opts?.delta !== undefined && opts.delta !== 0) {
    const arrow = opts.delta > 0 ? "+" : "";
    const color = opts.delta > 0 ? C.positive : C.danger;
    const suffix = opts.deltaSuffix || "%";
    doc.font("Helvetica-Bold").fontSize(7).fillColor(color).text(`${arrow}${opts.delta}${suffix}`, x + 12, bottomY, { width: w - 20, continued: false });
    bottomY += 9;
  }
  if (opts?.previousValue) {
    doc.font("Helvetica").fontSize(6).fillColor(C.textMuted).text(`Prev: ${opts.previousValue}`, x + 12, bottomY, { width: w - 20 });
    bottomY += 8;
  }
  if (opts?.benchmarkPass !== undefined) {
    const symbol = opts.benchmarkPass ? "Pass" : "Below 5%";
    const bColor = opts.benchmarkPass ? C.positive : C.warning;
    doc.font("Helvetica").fontSize(6).fillColor(bColor).text(`Benchmark: ${symbol}`, x + 12, bottomY, { width: w - 20 });
  }
  if (opts?.lowVisibility) {
    doc.font("Helvetica").fontSize(6).fillColor(C.warning).text("Low visibility", x + 12, bottomY, { width: w - 20 });
  }
  if (opts?.subtitle) {
    doc.font("Helvetica").fontSize(6).fillColor(C.textMuted).text(opts.subtitle, x + 12, bottomY, { width: w - 20 });
  }
}

function drawLineChart(
  doc: PDFKit.PDFDocument,
  x: number, y: number, w: number, h: number,
  data: { label: string; value: number }[],
  color: string,
  title: string,
  secondaryData?: { label: string; value: number }[],
  secondaryColor?: string,
  legend?: [string, string]
): void {
  if (data.length < 2) return;

  doc.font("Helvetica-Bold").fontSize(9).fillColor(C.text).text(title, x, y - 14, { width: w });
  doc.roundedRect(x, y, w, h, 4).fillAndStroke(C.cardBg, C.border);

  const padL = 40, padR = 10, padT = 20, padB = 25;
  const chartX = x + padL;
  const chartY = y + padT;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;

  const allValues = [...data.map(d => d.value), ...(secondaryData?.map(d => d.value) || [])];
  const maxVal = Math.max(...allValues, 1);
  const minVal = Math.min(...allValues, 0);
  const range = maxVal - minVal || 1;

  for (let i = 0; i <= 4; i++) {
    const gy = chartY + chartH - (chartH * i) / 4;
    doc.strokeColor(C.borderLight).lineWidth(0.3).moveTo(chartX, gy).lineTo(chartX + chartW, gy).stroke();
    const val = Math.round(minVal + (range * i) / 4);
    doc.font("Helvetica").fontSize(6).fillColor(C.textMuted).text(val.toLocaleString(), x + 2, gy - 4, { width: padL - 6, align: "right" });
  }

  const drawPath = (pts: { label: string; value: number }[], clr: string) => {
    if (pts.length < 2) return;
    const step = chartW / (pts.length - 1);
    doc.strokeColor(clr).lineWidth(1.5);
    for (let i = 0; i < pts.length; i++) {
      const px = chartX + step * i;
      const py = chartY + chartH - ((pts[i].value - minVal) / range) * chartH;
      if (i === 0) doc.moveTo(px, py);
      else doc.lineTo(px, py);
    }
    doc.stroke();
  };

  drawPath(data, color);
  if (secondaryData && secondaryColor) drawPath(secondaryData, secondaryColor);

  const labelCount = Math.min(data.length, 6);
  const labelStep = Math.max(1, Math.floor(data.length / labelCount));
  for (let i = 0; i < data.length; i += labelStep) {
    const lx = chartX + (chartW / (data.length - 1)) * i;
    const dateStr = data[i].label.slice(5);
    doc.font("Helvetica").fontSize(5.5).fillColor(C.textMuted).text(dateStr, lx - 15, chartY + chartH + 6, { width: 30, align: "center" });
  }

  if (legend && secondaryColor) {
    const ly = y + 6;
    const lx = x + w - 130;
    doc.rect(lx, ly + 1, 8, 3).fill(color);
    doc.font("Helvetica").fontSize(6).fillColor(C.text).text(legend[0], lx + 12, ly);
    doc.rect(lx + 65, ly + 1, 8, 3).fill(secondaryColor);
    doc.font("Helvetica").fontSize(6).fillColor(C.text).text(legend[1], lx + 77, ly);
  }
}

function formatDelta(val: number, suffix: string): string {
  if (val > 0) return `+${Math.abs(val)}${suffix}`;
  if (val < 0) return `-${Math.abs(val)}${suffix}`;
  return "No change";
}

export function generatePdfReport(data: PdfReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: M, bottom: M, left: M, right: M },
      bufferPages: true,
      autoFirstPage: true,
    });

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const searchValid = data.metrics.search.impressions > 0;

    // ===== TITLE BLOCK =====
    doc.font("Helvetica-Bold").fontSize(18).fillColor(C.primary)
      .text("SEO Performance Report", M, M, { width: CW });
    doc.font("Helvetica").fontSize(10).fillColor(C.textLight)
      .text(sanitize(data.domain), M, M + 26, { width: CW / 2 });
    doc.font("Helvetica").fontSize(8).fillColor(C.textMuted)
      .text(`${sanitize(data.dateRange.start)} -- ${sanitize(data.dateRange.end)}  |  Generated ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, M, M + 42, { width: CW });
    doc.y = M + 60;

    // ===== 1. KPI SECTION =====
    sectionTitle(doc, "Key Performance Indicators");

    const c3w = (CW - 20) / 3;
    const kpiY1 = doc.y;
    const trafficDelta = data.metrics.traffic.growthRate;
    drawKpiCard(doc, M, kpiY1, c3w, "Users", data.metrics.traffic.users.toLocaleString(), C.accent, {
      delta: trafficDelta !== 0 ? trafficDelta : undefined,
      deltaSuffix: "%",
    });
    drawKpiCard(doc, M + c3w + 10, kpiY1, c3w, "Sessions", data.metrics.traffic.sessions.toLocaleString(), C.primary);
    drawKpiCard(doc, M + (c3w + 10) * 2, kpiY1, c3w, "Clicks", data.metrics.search.clicks.toLocaleString(), C.positive);
    doc.y = kpiY1 + 76;

    const kpiY2 = doc.y;
    drawKpiCard(doc, M, kpiY2, c3w, "Impressions", data.metrics.search.impressions.toLocaleString(), C.warning);
    drawKpiCard(doc, M + c3w + 10, kpiY2, c3w, "CTR", searchValid ? `${data.metrics.search.ctr}%` : "N/A", C.accent, {
      subtitle: !searchValid ? "Insufficient data" : undefined,
      benchmarkPass: searchValid ? data.metrics.search.ctr >= 5 : undefined,
    });
    drawKpiCard(doc, M + (c3w + 10) * 2, kpiY2, c3w, "Avg Position", searchValid ? data.metrics.search.avgPosition.toFixed(1) : "N/A", C.primary, {
      subtitle: !searchValid ? "Insufficient data" : undefined,
      lowVisibility: searchValid && data.metrics.search.avgPosition > 20,
    });
    doc.y = kpiY2 + 76;

    const convMetrics = data.metrics.conversions;
    if (convMetrics && (convMetrics.current > 0 || convMetrics.previous > 0)) {
      const kpiY3 = doc.y;
      drawKpiCard(doc, M, kpiY3, c3w, "Conversions", convMetrics.current.toLocaleString(), C.positive, {
        delta: convMetrics.growthRate !== 0 ? convMetrics.growthRate : undefined,
        deltaSuffix: "%",
        previousValue: convMetrics.previous.toLocaleString(),
      });
      doc.y = kpiY3 + 76;
    }

    // ===== 2. EXECUTIVE SUMMARY =====
    ensureSpace(doc, 80);
    sectionTitle(doc, "Executive Summary");

    const safeSummary = sanitize(data.summary);
    const summaryTextOpts = { width: CW - 24, lineGap: 3.5, align: "left" as const };
    const summaryHeight = doc.font("Helvetica").fontSize(9).heightOfString(safeSummary, summaryTextOpts);
    const boxH = summaryHeight + 24;

    ensureSpace(doc, boxH + 10);
    const boxY = doc.y;
    doc.roundedRect(M, boxY, CW, boxH, 4).fillAndStroke(C.bg, C.border);
    doc.rect(M, boxY, 3, boxH).fill(C.accent);
    doc.font("Helvetica").fontSize(9).fillColor(C.text)
      .text(safeSummary, M + 14, boxY + 12, summaryTextOpts);
    doc.y = boxY + boxH + 16;

    // ===== 3. KEY INSIGHTS =====
    ensureSpace(doc, 60);
    sectionTitle(doc, "Key Insights");

    const risks = data.insights.filter(i => i.type === "warning");
    const opportunities = data.insights.filter(i => i.type === "positive");
    const neutral = data.insights.filter(i => i.type === "neutral");

    const drawInsightGroup = (title: string, items: Insight[], color: string) => {
      ensureSpace(doc, 30);
      doc.font("Helvetica-Bold").fontSize(9).fillColor(color).text(`${title} (${items.length})`, M + 4, doc.y);
      doc.y += 12;

      if (items.length === 0) {
        doc.font("Helvetica").fontSize(8).fillColor(C.textMuted).text("None identified for this period.", M + 18, doc.y);
        doc.y += 14;
        return;
      }

      for (const ins of items) {
        const cleanMsg = ins.message
          .replace(/[^\x20-\x7E\n]/g, "")
          .replace(/\s+/g, " ")
          .trim();
        const textOpts = { width: CW - 30, lineGap: 2 };
        const textH = doc.font("Helvetica").fontSize(8.5).heightOfString(cleanMsg, textOpts);
        ensureSpace(doc, textH + 10);
        doc.rect(M + 10, doc.y, 2, textH + 4).fill(color);
        doc.font("Helvetica").fontSize(8.5).fillColor(C.text)
          .text(cleanMsg, M + 18, doc.y + 1, textOpts);
        doc.y += textH + 8;
      }
      doc.y += 6;
    };

    drawInsightGroup("Risks", risks, C.danger);
    drawInsightGroup("Opportunities", opportunities, C.positive);
    drawInsightGroup("Observations", neutral, C.neutral);

    doc.y += 4;

    // ===== 4. WHAT CHANGED =====
    ensureSpace(doc, 90);
    sectionTitle(doc, "What Changed");

    const changes: { label: string; value: number; display: string }[] = [
      { label: "Traffic Growth", value: data.metrics.traffic.growthRate, display: formatDelta(data.metrics.traffic.growthRate, "%") },
      { label: "Keyword Net Growth", value: data.metrics.keywords.netGrowth, display: data.metrics.keywords.netGrowth !== 0 ? formatDelta(data.metrics.keywords.netGrowth, " keywords") : "Stable" },
    ];

    if (searchValid) {
      const gap = data.metrics.search.ctrGap;
      changes.push({
        label: "CTR vs Benchmark",
        value: gap <= 0 ? 1 : -1,
        display: gap <= 0 ? `+${Math.abs(gap)}% above target` : `-${gap}% below target`,
      });
    }

    if (convMetrics && (convMetrics.current > 0 || convMetrics.previous > 0)) {
      changes.push({
        label: "Conversion Growth",
        value: convMetrics.growthRate,
        display: formatDelta(convMetrics.growthRate, "%"),
      });
    }

    for (const change of changes) {
      ensureSpace(doc, 28);
      const rowY = doc.y;
      const color = change.label === "CTR vs Benchmark"
        ? (change.value > 0 ? C.positive : C.danger)
        : (change.value > 0 ? C.positive : change.value < 0 ? C.danger : C.neutral);

      doc.roundedRect(M, rowY, CW, 22, 3).fill(C.bg);
      doc.font("Helvetica").fontSize(8.5).fillColor(C.text)
        .text(change.label, M + 12, rowY + 6, { width: 150 });
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(color)
        .text(change.display, M + 170, rowY + 6, { width: CW - 180 });
      doc.y = rowY + 26;
    }

    doc.y += 10;

    // ===== 5. TOP PAGES TABLE =====
    if (data.topPages.length > 0) {
      const rowCount = Math.min(data.topPages.length, 10);
      ensureSpace(doc, 60 + rowCount * 18);
      sectionTitle(doc, "Top Pages");

      const hasGscData = data.topPagesSource === "gsc";
      const sourceLabel = hasGscData ? "Source: Search Console" : "Source: GA4";
      doc.font("Helvetica").fontSize(6.5).fillColor(C.textMuted).text(sourceLabel, M, doc.y - 10, { width: CW, align: "right" });

      const colWidths = hasGscData
        ? [CW * 0.36, CW * 0.14, CW * 0.20, CW * 0.14, CW * 0.16]
        : [CW * 0.46, CW * 0.18, CW * 0.18, CW * 0.18];
      const headers = hasGscData
        ? ["Page", "Clicks", "Impressions", "CTR", "Position"]
        : ["Page", "Sessions", "Users", "Conversions"];

      doc.roundedRect(M, doc.y, CW, 18, 2).fill(C.primary);
      let hx = M;
      for (let i = 0; i < headers.length; i++) {
        doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff")
          .text(headers[i], hx + 6, doc.y + 5, { width: colWidths[i] - 12, align: i === 0 ? "left" : "right" });
        hx += colWidths[i];
      }
      doc.y += 18;

      for (let i = 0; i < rowCount; i++) {
        ensureSpace(doc, 18);
        const p = data.topPages[i];
        const ry = doc.y;
        doc.rect(M, ry, CW, 16).fill(i % 2 === 0 ? C.bg : C.cardBg);

        let cx = M;
        const rawPage = sanitize(p.page || "");
        const pagePath = rawPage.length > 42 ? rawPage.slice(0, 42) + "..." : rawPage;

        doc.font("Helvetica").fontSize(7).fillColor(C.text)
          .text(pagePath, cx + 6, ry + 4, { width: colWidths[0] - 12 });
        cx += colWidths[0];

        if (hasGscData) {
          doc.font("Helvetica").fontSize(7).fillColor(C.text).text(p.clicks.toLocaleString(), cx + 6, ry + 4, { width: colWidths[1] - 12, align: "right" });
          cx += colWidths[1];
          doc.font("Helvetica").fontSize(7).fillColor(C.text).text(p.impressions.toLocaleString(), cx + 6, ry + 4, { width: colWidths[2] - 12, align: "right" });
          cx += colWidths[2];
          doc.font("Helvetica").fontSize(7).fillColor(C.text).text(`${p.ctr}%`, cx + 6, ry + 4, { width: colWidths[3] - 12, align: "right" });
          cx += colWidths[3];
          doc.font("Helvetica").fontSize(7).fillColor(C.text).text(p.position.toString(), cx + 6, ry + 4, { width: colWidths[4] - 12, align: "right" });
        } else {
          const ga4p = p as any;
          doc.font("Helvetica").fontSize(7).fillColor(C.text).text((ga4p.sessions || 0).toLocaleString(), cx + 6, ry + 4, { width: colWidths[1] - 12, align: "right" });
          cx += colWidths[1];
          doc.font("Helvetica").fontSize(7).fillColor(C.text).text((ga4p.users || 0).toLocaleString(), cx + 6, ry + 4, { width: colWidths[2] - 12, align: "right" });
          cx += colWidths[2];
          doc.font("Helvetica").fontSize(7).fillColor(C.text).text((ga4p.conversions || 0).toLocaleString(), cx + 6, ry + 4, { width: colWidths[3] - 12, align: "right" });
        }

        doc.y = ry + 16;
      }

      doc.y += 14;
    }

    // ===== 5b. BACKLINKS SECTION =====
    ensureSpace(doc, 60);
    sectionTitle(doc, "Backlinks");

    const bl = data.metrics.backlinks;
    if (bl && (bl.current > 0 || bl.previous > 0)) {
      const blColWidths = [CW * 0.40, CW * 0.30, CW * 0.30];
      const blHeaders = ["Metric", "Current", "Change"];

      doc.roundedRect(M, doc.y, CW, 18, 2).fill(C.primary);
      let bhx = M;
      for (let i = 0; i < blHeaders.length; i++) {
        doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff")
          .text(blHeaders[i], bhx + 6, doc.y + 5, { width: blColWidths[i] - 12, align: i === 0 ? "left" : "right" });
        bhx += blColWidths[i];
      }
      doc.y += 18;

      const blRows = [
        { label: "Total Backlinks", current: bl.current, delta: bl.delta },
        { label: "Referring Domains", current: bl.referringDomains, delta: bl.referringDomainsDelta },
      ];

      for (let i = 0; i < blRows.length; i++) {
        ensureSpace(doc, 18);
        const row = blRows[i];
        const ry = doc.y;
        doc.rect(M, ry, CW, 16).fill(i % 2 === 0 ? C.bg : C.cardBg);

        doc.font("Helvetica").fontSize(7).fillColor(C.text)
          .text(row.label, M + 6, ry + 4, { width: blColWidths[0] - 12 });
        doc.font("Helvetica").fontSize(7).fillColor(C.text)
          .text(row.current.toLocaleString(), M + blColWidths[0] + 6, ry + 4, { width: blColWidths[1] - 12, align: "right" });
        const deltaColor = row.delta > 0 ? C.positive : row.delta < 0 ? C.danger : C.neutral;
        const deltaStr = row.delta > 0 ? `+${row.delta}` : row.delta < 0 ? `${row.delta}` : "stable";
        doc.font("Helvetica-Bold").fontSize(7).fillColor(deltaColor)
          .text(deltaStr, M + blColWidths[0] + blColWidths[1] + 6, ry + 4, { width: blColWidths[2] - 12, align: "right" });

        doc.y = ry + 16;
      }
      doc.y += 14;
    } else {
      doc.font("Helvetica").fontSize(8.5).fillColor(C.textLight)
        .text("Backlink data unavailable. Verify API credentials in Settings.", M + 4, doc.y);
      doc.y += 20;
    }

    // ===== 5c. KEYWORD RANKINGS TABLE =====
    ensureSpace(doc, 80);
    sectionTitle(doc, "Keyword Rankings");

    const kw = data.metrics.keywords;
    const kwDist = data.keywordDistribution;
    const kwTotal = kwDist.top3 + kwDist.top10 + kwDist.top20 + kwDist.top50 + kwDist.top100 + kwDist.beyond;

    if (kw.total > 0 || kwTotal > 0) {
      const top3 = kwDist.top3 || 0;
      const p2Count = kwDist.top20 || 0;
      const kwColWidths = [CW * 0.40, CW * 0.30, CW * 0.30];
      const kwHeaders = ["Metric", "Value", "Detail"];

      doc.roundedRect(M, doc.y, CW, 18, 2).fill(C.primary);
      let khx = M;
      for (let i = 0; i < kwHeaders.length; i++) {
        doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff")
          .text(kwHeaders[i], khx + 6, doc.y + 5, { width: kwColWidths[i] - 12, align: i === 0 ? "left" : "right" });
        khx += kwColWidths[i];
      }
      doc.y += 18;

      const kwRows = [
        { label: "Total Tracked", value: kw.total.toLocaleString(), detail: "" },
        { label: "Top 3", value: top3.toLocaleString(), detail: "" },
        { label: "Top 10", value: kw.top10.toLocaleString(), detail: `${kw.top10Percentage}% of total` },
        { label: "Improved", value: kw.improved.toLocaleString(), detail: "" },
        { label: "Declined", value: kw.declined.toLocaleString(), detail: "" },
        { label: "Net Movement", value: kw.netGrowth >= 0 ? `+${kw.netGrowth}` : `${kw.netGrowth}`, detail: kw.netGrowth > 0 ? "Improving" : kw.netGrowth < 0 ? "Declining" : "Stable" },
        { label: "Page 2 Opportunities (11-20)", value: p2Count.toLocaleString(), detail: "Positions 11-20" },
      ];

      for (let i = 0; i < kwRows.length; i++) {
        ensureSpace(doc, 18);
        const row = kwRows[i];
        const ry = doc.y;
        doc.rect(M, ry, CW, 16).fill(i % 2 === 0 ? C.bg : C.cardBg);

        doc.font("Helvetica").fontSize(7).fillColor(C.text)
          .text(row.label, M + 6, ry + 4, { width: kwColWidths[0] - 12 });
        doc.font("Helvetica").fontSize(7).fillColor(C.text)
          .text(row.value, M + kwColWidths[0] + 6, ry + 4, { width: kwColWidths[1] - 12, align: "right" });
        if (row.detail) {
          doc.font("Helvetica").fontSize(7).fillColor(C.textMuted)
            .text(row.detail, M + kwColWidths[0] + kwColWidths[1] + 6, ry + 4, { width: kwColWidths[2] - 12, align: "right" });
        }

        doc.y = ry + 16;
      }
      doc.y += 14;
    } else {
      doc.font("Helvetica").fontSize(8.5).fillColor(C.textLight)
        .text("Keyword ranking data unavailable for this period.", M + 4, doc.y);
      doc.y += 20;
    }

    // ===== 5d. AI REFERRERS =====
    ensureSpace(doc, 60);
    sectionTitle(doc, "AI Traffic Sources");

    if (data.aiReferrers && data.aiReferrers.length > 0) {
      const aiRowCount = Math.min(data.aiReferrers.length, 10);
      ensureSpace(doc, 40 + aiRowCount * 18);

      const totalAiUsers = data.aiReferrers.reduce((s, r) => s + r.totalUsers, 0);
      const totalAiSessions = data.aiReferrers.reduce((s, r) => s + r.sessions, 0);
      doc.font("Helvetica").fontSize(7).fillColor(C.textLight)
        .text(`${totalAiUsers.toLocaleString()} users | ${totalAiSessions.toLocaleString()} sessions from ${data.aiReferrers.length} AI source${data.aiReferrers.length > 1 ? "s" : ""}`, M, doc.y, { width: CW });
      doc.y += 8;

      const aiCols = [CW * 0.34, CW * 0.20, CW * 0.22, CW * 0.24];
      const aiHeaders = ["AI Source", "Users", "Sessions", "% of Total"];

      doc.roundedRect(M, doc.y, CW, 18, 2).fill(C.primary);
      let ahx = M;
      for (let i = 0; i < aiHeaders.length; i++) {
        doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff")
          .text(aiHeaders[i], ahx + 6, doc.y + 5, { width: aiCols[i] - 12, align: i === 0 ? "left" : "right" });
        ahx += aiCols[i];
      }
      doc.y += 18;

      for (let i = 0; i < aiRowCount; i++) {
        ensureSpace(doc, 18);
        const ref = data.aiReferrers[i];
        const ary = doc.y;
        doc.rect(M, ary, CW, 16).fill(i % 2 === 0 ? C.bg : C.cardBg);

        let acx = M;
        doc.font("Helvetica").fontSize(7).fillColor(C.text)
          .text(sanitize(ref.source), acx + 6, ary + 4, { width: aiCols[0] - 12 });
        acx += aiCols[0];
        doc.font("Helvetica").fontSize(7).fillColor(C.text)
          .text(ref.totalUsers.toLocaleString(), acx + 6, ary + 4, { width: aiCols[1] - 12, align: "right" });
        acx += aiCols[1];
        doc.font("Helvetica").fontSize(7).fillColor(C.text)
          .text(ref.sessions.toLocaleString(), acx + 6, ary + 4, { width: aiCols[2] - 12, align: "right" });
        acx += aiCols[2];
        const pctStr = ref.percentOfTotal != null ? `${ref.percentOfTotal}%` : "--";
        doc.font("Helvetica").fontSize(7).fillColor(C.text)
          .text(pctStr, acx + 6, ary + 4, { width: aiCols[3] - 12, align: "right" });
        doc.y = ary + 16;
      }

      doc.y += 14;
    } else {
      doc.font("Helvetica").fontSize(8.5).fillColor(C.textLight)
        .text("No AI platform traffic detected this period.", M + 4, doc.y);
      doc.y += 20;
    }

    // ===== 6. CHART =====
    const chartH = 120;
    const hasTrafficChart = data.dailyTrends.ga4Daily.length > 1;
    const hasSearchChart = data.dailyTrends.gscDaily.length > 1;

    if (hasTrafficChart) {
      ensureSpace(doc, chartH + 30);
      sectionTitle(doc, "Trend Analysis");
      const usersData = data.dailyTrends.ga4Daily.map(d => ({ label: d.date, value: d.users }));
      const sessionsData = data.dailyTrends.ga4Daily.map(d => ({ label: d.date, value: d.sessions }));
      drawLineChart(doc, M, doc.y + 14, CW, chartH, usersData, C.accent, "Traffic Trend", sessionsData, C.primary, ["Users", "Sessions"]);
      doc.y += chartH + 28;
    } else if (hasSearchChart) {
      ensureSpace(doc, chartH + 30);
      sectionTitle(doc, "Trend Analysis");
      const clicksData = data.dailyTrends.gscDaily.map(d => ({ label: d.date, value: d.clicks }));
      const impData = data.dailyTrends.gscDaily.map(d => ({ label: d.date, value: d.impressions }));
      drawLineChart(doc, M, doc.y + 14, CW, chartH, clicksData, C.positive, "Search Performance", impData, C.warning, ["Clicks", "Impressions"]);
      doc.y += chartH + 28;
    } else {
      ensureSpace(doc, 50);
      sectionTitle(doc, "Trend Analysis");
      doc.roundedRect(M, doc.y, CW, 36, 4).fillAndStroke(C.bg, C.border);
      doc.font("Helvetica").fontSize(8.5).fillColor(C.textLight)
        .text("Not enough data to display trend", M, doc.y + 12, { width: CW, align: "center" });
      doc.y += 44;
    }

    // ===== DATA AVAILABILITY TABLE =====
    ensureSpace(doc, 120);
    sectionTitle(doc, "Data Availability");

    const hasGA4Data = data.metrics.traffic.users > 0 || data.metrics.traffic.sessions > 0;
    const hasGSCData = data.metrics.search.clicks > 0 || data.metrics.search.impressions > 0;
    const hasSemrushData = data.metrics.keywords.total > 0;
    const hasDataForSEO = bl && (bl.current > 0 || bl.previous > 0);
    const hasAiMentions = data.aiReferrers && data.aiReferrers.length > 0;

    const statusRows = [
      { label: "Google Analytics 4", connected: hasGA4Data },
      { label: "Google Search Console", connected: hasGSCData },
      { label: "SEMrush", connected: hasSemrushData },
      { label: "DataForSEO", connected: hasDataForSEO },
      { label: "AI Mentions", connected: hasAiMentions, altLabels: ["Active", "Not configured"] },
    ];

    const daCols = [CW * 0.55, CW * 0.45];
    doc.roundedRect(M, doc.y, CW, 18, 2).fill(C.primary);
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff")
      .text("Data Source", M + 6, doc.y + 5, { width: daCols[0] - 12 });
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff")
      .text("Status", M + daCols[0] + 6, doc.y + 5, { width: daCols[1] - 12, align: "right" });
    doc.y += 18;

    for (let i = 0; i < statusRows.length; i++) {
      ensureSpace(doc, 18);
      const row = statusRows[i];
      const ry = doc.y;
      doc.rect(M, ry, CW, 16).fill(i % 2 === 0 ? C.bg : C.cardBg);

      doc.font("Helvetica").fontSize(7).fillColor(C.text)
        .text(row.label, M + 6, ry + 4, { width: daCols[0] - 12 });

      const connLabel = row.altLabels
        ? (row.connected ? row.altLabels[0] : row.altLabels[1])
        : (row.connected ? "Connected" : "No data");
      const connColor = row.connected ? C.positive : C.textMuted;
      doc.font("Helvetica").fontSize(7).fillColor(connColor)
        .text(connLabel, M + daCols[0] + 6, ry + 4, { width: daCols[1] - 12, align: "right" });

      doc.y = ry + 16;
    }

    doc.y += 10;

    doc.end();
  });
}

export function buildPdfFilename(domain: string): string {
  const cleanDomain = domain
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[^a-zA-Z0-9.-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const now = new Date();
  const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const dateStr = `${monthNames[now.getMonth()]}-${now.getFullYear()}`;

  return `${cleanDomain}-seo-report-${dateStr}.pdf`;
}
