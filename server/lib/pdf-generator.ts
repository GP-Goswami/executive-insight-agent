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

interface GscKeyword {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface TrafficSummary {
  users: number;
  sessions: number;
  engagedSessions: number;
  engagementRate: number;
  avgEngagementTimeFormatted: string;
}

interface Ga4ExtendedPage {
  page: string;
  screenPageViews: number;
  totalUsers: number;
  sessions: number;
  engagementRate: number;
  avgEngagementTimeFormatted: string;
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
  keywords?: GscKeyword[];
  trafficSummary?: TrafficSummary;
  ga4TopPages?: Ga4ExtendedPage[];
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
    const bl = data.metrics.backlinks;
    const convMetrics = data.metrics.conversions;

    // ===== TITLE BLOCK =====
    doc.font("Helvetica-Bold").fontSize(18).fillColor(C.primary)
      .text("SEO Performance Report", M, M, { width: CW });
    doc.font("Helvetica").fontSize(10).fillColor(C.textLight)
      .text(sanitize(data.domain), M, M + 26, { width: CW / 2 });
    doc.font("Helvetica").fontSize(8).fillColor(C.textMuted)
      .text(`${sanitize(data.dateRange.start)} -- ${sanitize(data.dateRange.end)}  |  Generated ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, M, M + 42, { width: CW });
    doc.y = M + 60;

    // ===== 1. KPI SNAPSHOT =====
    // 2-row grid: Row 1 — Users (GA4), Sessions (GA4), Clicks (GSC)
    //             Row 2 — Impressions (GSC), CTR (GSC), Avg Position (GSC)
    sectionTitle(doc, "1. KPI Snapshot");

    const c3w = (CW - 20) / 3;
    const kpiY1 = doc.y;
    drawKpiCard(doc, M,                  kpiY1, c3w, "Users",       data.metrics.traffic.users.toLocaleString(),    C.accent,   { subtitle: "GA4" });
    drawKpiCard(doc, M + c3w + 10,       kpiY1, c3w, "Sessions",    data.metrics.traffic.sessions.toLocaleString(), C.primary,  { subtitle: "GA4" });
    drawKpiCard(doc, M + (c3w + 10) * 2, kpiY1, c3w, "Clicks",      data.metrics.search.clicks.toLocaleString(),   C.positive, { subtitle: "GSC" });
    doc.y = kpiY1 + 76;

    const kpiY2 = doc.y;
    drawKpiCard(doc, M,                  kpiY2, c3w, "Impressions", data.metrics.search.impressions.toLocaleString(), C.warning, { subtitle: "GSC" });
    drawKpiCard(doc, M + c3w + 10,       kpiY2, c3w, "CTR",         searchValid ? `${data.metrics.search.ctr}%` : "N/A", C.accent, {
      subtitle: "GSC",
      benchmarkPass: searchValid ? data.metrics.search.ctr >= 5 : undefined,
    });
    drawKpiCard(doc, M + (c3w + 10) * 2, kpiY2, c3w, "Avg Position", searchValid ? data.metrics.search.avgPosition.toFixed(1) : "N/A", C.primary, {
      subtitle: "GSC",
      lowVisibility: searchValid && data.metrics.search.avgPosition > 20,
    });
    doc.y = kpiY2 + 76;

    // ===== 2. EXECUTIVE SUMMARY =====
    ensureSpace(doc, 80);
    sectionTitle(doc, "2. Executive Summary");

    if (data.summary) {
      const safeSummary = sanitize(data.summary);
      const summaryTextOpts = { width: CW - 24, lineGap: 3.5, align: "left" as const };
      const summaryHeight = doc.font("Helvetica").fontSize(9).heightOfString(safeSummary, summaryTextOpts);
      const boxH = summaryHeight + 24;
      ensureSpace(doc, boxH + 10);
      const boxY = doc.y;
      doc.roundedRect(M, boxY, CW, boxH, 4).fillAndStroke(C.bg, C.border);
      doc.rect(M, boxY, 3, boxH).fill(C.accent);
      doc.font("Helvetica").fontSize(9).fillColor(C.text).text(safeSummary, M + 14, boxY + 12, summaryTextOpts);
      doc.y = boxY + boxH + 12;
    }

    // Wins / Risks / Recommendations bullets
    const risks    = data.insights.filter(i => i.type === "warning");
    const positives = data.insights.filter(i => i.type === "positive");
    const neutral   = data.insights.filter(i => i.type === "neutral");

    const drawBulletBlock = (title: string, color: string, items: string[]) => {
      if (items.length === 0) return;
      ensureSpace(doc, 30 + items.length * 18);
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(color).text(title, M + 4, doc.y);
      doc.y += 10;
      for (const msg of items) {
        const clean = msg.replace(/[^\x20-\x7E\n]/g, "").replace(/\s+/g, " ").trim();
        const opts = { width: CW - 28, lineGap: 2 };
        const h = doc.font("Helvetica").fontSize(8).heightOfString(clean, opts);
        ensureSpace(doc, h + 8);
        doc.rect(M + 8, doc.y, 2, h + 2).fill(color);
        doc.font("Helvetica").fontSize(8).fillColor(C.text).text(clean, M + 16, doc.y + 1, opts);
        doc.y += h + 6;
      }
      doc.y += 6;
    };

    drawBulletBlock("✓ Wins / Positive Signals", C.positive, positives.map(i => i.message));
    drawBulletBlock("⚠ Risks / Problems",        C.danger,   risks.map(i => i.message));

    const recommendations = risks.map(r => {
      switch (r.category) {
        case "ctr":         return "Improve on-page titles and meta descriptions to lift CTR.";
        case "keywords":    return "Prioritize page-2 keywords for quick ranking gains.";
        case "traffic":     return "Investigate traffic source decline and diversify acquisition channels.";
        case "conversions": return "Audit landing pages and conversion funnels for friction points.";
        case "backlinks":   return "Launch a targeted outreach campaign to rebuild referring domains.";
        default:            return r.message;
      }
    });
    drawBulletBlock("💡 Recommendations", C.accent, recommendations);

    // ===== 3. KEY INSIGHTS =====
    ensureSpace(doc, 60);
    sectionTitle(doc, "3. Key Insights");

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
        const clean = ins.message.replace(/[^\x20-\x7E\n]/g, "").replace(/\s+/g, " ").trim();
        const opts = { width: CW - 30, lineGap: 2 };
        const h = doc.font("Helvetica").fontSize(8.5).heightOfString(clean, opts);
        ensureSpace(doc, h + 10);
        doc.rect(M + 10, doc.y, 2, h + 4).fill(color);
        doc.font("Helvetica").fontSize(8.5).fillColor(C.text).text(clean, M + 18, doc.y + 1, opts);
        doc.y += h + 8;
      }
      doc.y += 6;
    };

    drawInsightGroup("Opportunities", positives, C.positive);
    drawInsightGroup("Observations",  neutral,   C.neutral);

    doc.y += 4;

    // ===== 4. TRAFFIC TREND =====
    sectionTitle(doc, "4. Traffic Trend");

    // ── 4a. Traffic Summary (GA4) ──
    if (data.trafficSummary) {
      const ts = data.trafficSummary;
      ensureSpace(doc, 80);
      doc.font("Helvetica").fontSize(7).fillColor(C.textMuted).text("TRAFFIC SUMMARY  ·  GA4", M, doc.y, { characterSpacing: 0.5 });
      doc.y += 10;

      const tsColW = (CW - 30) / 5;
      const tsY = doc.y;
      const tsItems = [
        { label: "Users",              value: ts.users.toLocaleString() },
        { label: "Sessions",           value: ts.sessions.toLocaleString() },
        { label: "Engaged Sessions",   value: ts.engagedSessions.toLocaleString() },
        { label: "Engagement Rate",    value: `${ts.engagementRate}%` },
        { label: "Avg Engagement Time",value: ts.avgEngagementTimeFormatted },
      ];
      const tsAccents = [C.accent, C.primary, C.positive, C.warning, C.accent];
      for (let i = 0; i < tsItems.length; i++) {
        const tx = M + i * (tsColW + 7.5);
        doc.roundedRect(tx, tsY, tsColW, 52, 3).fillAndStroke(C.cardBg, C.border);
        doc.rect(tx, tsY, 3, 52).fill(tsAccents[i]);
        doc.font("Helvetica").fontSize(6.5).fillColor(C.textLight)
          .text(tsItems[i].label.toUpperCase(), tx + 8, tsY + 7, { width: tsColW - 16, characterSpacing: 0.3 });
        doc.font("Helvetica-Bold").fontSize(12).fillColor(C.text)
          .text(tsItems[i].value, tx + 8, tsY + 20, { width: tsColW - 16 });
      }
      doc.y = tsY + 60;
    }

    // ── 4b. Daily Trend Chart ──
    const chartH = 120;
    const hasTrafficChart = data.dailyTrends.ga4Daily.length > 1;
    const hasSearchChart  = data.dailyTrends.gscDaily.length > 1;

    ensureSpace(doc, chartH + 30);
    doc.font("Helvetica").fontSize(7).fillColor(C.textMuted).text("DAILY TREND", M, doc.y, { characterSpacing: 0.5 });
    doc.y += 6;
    if (hasTrafficChart) {
      const usersData    = data.dailyTrends.ga4Daily.map(d => ({ label: d.date, value: d.users }));
      const sessionsData = data.dailyTrends.ga4Daily.map(d => ({ label: d.date, value: d.sessions }));
      drawLineChart(doc, M, doc.y + 14, CW, chartH, usersData, C.accent, "Traffic Trend (Users / Sessions)", sessionsData, C.primary, ["Users", "Sessions"]);
      doc.y += chartH + 28;
    } else if (hasSearchChart) {
      const clicksData = data.dailyTrends.gscDaily.map(d => ({ label: d.date, value: d.clicks }));
      const impData    = data.dailyTrends.gscDaily.map(d => ({ label: d.date, value: d.impressions }));
      drawLineChart(doc, M, doc.y + 14, CW, chartH, clicksData, C.positive, "Search Performance (Clicks / Impressions)", impData, C.warning, ["Clicks", "Impressions"]);
      doc.y += chartH + 28;
    } else {
      doc.roundedRect(M, doc.y, CW, 36, 4).fillAndStroke(C.bg, C.border);
      doc.font("Helvetica").fontSize(8.5).fillColor(C.textLight)
        .text("Not enough daily data to display trend.", M, doc.y + 12, { width: CW, align: "center" });
      doc.y += 44;
    }

    // ── 4c. Top Pages from GSC ──
    if (data.topPages.length > 0) {
      const rowCount  = Math.min(data.topPages.length, 10);
      const hasGscData = data.topPagesSource === "gsc";
      ensureSpace(doc, 60 + rowCount * 18);
      doc.font("Helvetica").fontSize(7).fillColor(C.textMuted)
        .text(`TOP PAGES  ·  ${hasGscData ? "SEARCH CONSOLE" : "GA4"}`, M, doc.y, { characterSpacing: 0.5 });
      doc.y += 8;

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
        const p   = data.topPages[i];
        const ry  = doc.y;
        doc.rect(M, ry, CW, 16).fill(i % 2 === 0 ? C.bg : C.cardBg);
        let cx = M;
        const rawPage  = sanitize(p.page || "");
        const pagePath = rawPage.length > 42 ? rawPage.slice(0, 42) + "..." : rawPage;
        doc.font("Helvetica").fontSize(7).fillColor(C.text).text(pagePath, cx + 6, ry + 4, { width: colWidths[0] - 12 });
        cx += colWidths[0];
        if (hasGscData) {
          doc.font("Helvetica").fontSize(7).fillColor(C.text).text(p.clicks.toLocaleString(),      cx + 6, ry + 4, { width: colWidths[1] - 12, align: "right" }); cx += colWidths[1];
          doc.font("Helvetica").fontSize(7).fillColor(C.text).text(p.impressions.toLocaleString(), cx + 6, ry + 4, { width: colWidths[2] - 12, align: "right" }); cx += colWidths[2];
          doc.font("Helvetica").fontSize(7).fillColor(C.text).text(`${p.ctr}%`,                   cx + 6, ry + 4, { width: colWidths[3] - 12, align: "right" }); cx += colWidths[3];
          doc.font("Helvetica").fontSize(7).fillColor(C.text).text(p.position.toString(),          cx + 6, ry + 4, { width: colWidths[4] - 12, align: "right" });
        } else {
          const ga4p = p as any;
          doc.font("Helvetica").fontSize(7).fillColor(C.text).text((ga4p.sessions    || 0).toLocaleString(), cx + 6, ry + 4, { width: colWidths[1] - 12, align: "right" }); cx += colWidths[1];
          doc.font("Helvetica").fontSize(7).fillColor(C.text).text((ga4p.users       || 0).toLocaleString(), cx + 6, ry + 4, { width: colWidths[2] - 12, align: "right" }); cx += colWidths[2];
          doc.font("Helvetica").fontSize(7).fillColor(C.text).text((ga4p.conversions || 0).toLocaleString(), cx + 6, ry + 4, { width: colWidths[3] - 12, align: "right" });
        }
        doc.y = ry + 16;
      }
      doc.y += 12;
    }

    // ── 4d. Top Pages GA4 (Extended) ──
    if (data.ga4TopPages && data.ga4TopPages.length > 0) {
      const g4Pages = data.ga4TopPages.slice(0, 10);
      ensureSpace(doc, 60 + g4Pages.length * 16);
      doc.font("Helvetica").fontSize(7).fillColor(C.textMuted).text("TOP PAGES (GA4 — PAGE VIEWS)", M, doc.y, { characterSpacing: 0.5 });
      doc.y += 8;

      const g4Cols    = [CW * 0.30, CW * 0.13, CW * 0.12, CW * 0.12, CW * 0.16, CW * 0.17];
      const g4Headers = ["Page", "Page Views", "Users", "Sessions", "Eng. Rate", "Avg Eng. Time"];

      doc.roundedRect(M, doc.y, CW, 18, 2).fill(C.primary);
      let g4Hx = M;
      for (let i = 0; i < g4Headers.length; i++) {
        doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff")
          .text(g4Headers[i], g4Hx + 5, doc.y + 5, { width: g4Cols[i] - 10, align: i === 0 ? "left" : "right" });
        g4Hx += g4Cols[i];
      }
      doc.y += 18;

      for (let i = 0; i < g4Pages.length; i++) {
        ensureSpace(doc, 18);
        const p  = g4Pages[i];
        const ry = doc.y;
        doc.rect(M, ry, CW, 16).fill(i % 2 === 0 ? C.bg : C.cardBg);
        let cx = M;
        const pg = sanitize(p.page);
        doc.font("Helvetica").fontSize(7).fillColor(C.text).text(pg.length > 30 ? pg.slice(0, 30) + "..." : pg, cx + 5, ry + 4, { width: g4Cols[0] - 10 }); cx += g4Cols[0];
        doc.font("Helvetica").fontSize(7).fillColor(C.text).text(p.screenPageViews.toLocaleString(),  cx + 5, ry + 4, { width: g4Cols[1] - 10, align: "right" }); cx += g4Cols[1];
        doc.font("Helvetica").fontSize(7).fillColor(C.text).text(p.totalUsers.toLocaleString(),        cx + 5, ry + 4, { width: g4Cols[2] - 10, align: "right" }); cx += g4Cols[2];
        doc.font("Helvetica").fontSize(7).fillColor(C.text).text(p.sessions.toLocaleString(),          cx + 5, ry + 4, { width: g4Cols[3] - 10, align: "right" }); cx += g4Cols[3];
        doc.font("Helvetica").fontSize(7).fillColor(C.text).text(`${p.engagementRate}%`,               cx + 5, ry + 4, { width: g4Cols[4] - 10, align: "right" }); cx += g4Cols[4];
        doc.font("Helvetica").fontSize(7).fillColor(C.text).text(p.avgEngagementTimeFormatted,         cx + 5, ry + 4, { width: g4Cols[5] - 10, align: "right" });
        doc.y = ry + 16;
      }
      doc.y += 12;
    }

    // ===== 5. KEYWORD PERFORMANCE =====
    if (data.keywords && data.keywords.length > 0) {
      const kws = data.keywords.slice(0, 10);
      ensureSpace(doc, 60 + kws.length * 16);
      sectionTitle(doc, "5. Keyword Performance (Top 10)");

      const kwCols    = [CW * 0.34, CW * 0.12, CW * 0.16, CW * 0.10, CW * 0.12, CW * 0.16];
      const kwHeaders = ["Keyword", "Clicks", "Impressions", "CTR", "Position", "Impact"];

      doc.roundedRect(M, doc.y, CW, 18, 2).fill(C.primary);
      let kwHx = M;
      for (let i = 0; i < kwHeaders.length; i++) {
        doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff")
          .text(kwHeaders[i], kwHx + 5, doc.y + 5, { width: kwCols[i] - 10, align: i === 0 ? "left" : i === kwHeaders.length - 1 ? "left" : "right" });
        kwHx += kwCols[i];
      }
      doc.y += 18;

      for (let i = 0; i < kws.length; i++) {
        ensureSpace(doc, 18);
        const kw = kws[i];
        const ry = doc.y;
        doc.rect(M, ry, CW, 16).fill(i % 2 === 0 ? C.bg : C.cardBg);
        let cx = M;
        const kwText = sanitize(kw.query);
        doc.font("Helvetica").fontSize(7).fillColor(C.text).text(kwText.length > 35 ? kwText.slice(0, 35) + "..." : kwText, cx + 5, ry + 4, { width: kwCols[0] - 10 }); cx += kwCols[0];
        doc.font("Helvetica").fontSize(7).fillColor(C.text).text(kw.clicks.toLocaleString(),      cx + 5, ry + 4, { width: kwCols[1] - 10, align: "right" }); cx += kwCols[1];
        doc.font("Helvetica").fontSize(7).fillColor(C.text).text(kw.impressions.toLocaleString(), cx + 5, ry + 4, { width: kwCols[2] - 10, align: "right" }); cx += kwCols[2];
        doc.font("Helvetica").fontSize(7).fillColor(C.text).text(`${kw.ctr}%`,                   cx + 5, ry + 4, { width: kwCols[3] - 10, align: "right" }); cx += kwCols[3];
        doc.font("Helvetica").fontSize(7).fillColor(C.text).text(kw.position.toFixed(1),          cx + 5, ry + 4, { width: kwCols[4] - 10, align: "right" }); cx += kwCols[4];
        let impact = "Tracking keyword.";
        if      (kw.position <= 3  && kw.ctr >= 5)                          impact = "Strong top-3 — driving traffic.";
        else if (kw.position >= 11 && kw.position <= 20 && kw.impressions >= 200) impact = "Page 2 — push for quick win.";
        else if (kw.impressions >= 500 && kw.ctr < 2)                        impact = "High impressions, low CTR.";
        else if (kw.position <= 10 && kw.clicks >= 50)                       impact = "Solid page-1 ranking.";
        else if (kw.position > 20)                                            impact = "Low visibility — needs content.";
        doc.font("Helvetica").fontSize(6.5).fillColor(C.textMuted).text(impact, cx + 5, ry + 4, { width: kwCols[5] - 10 });
        doc.y = ry + 16;
      }
      doc.y += 12;
    } else {
      ensureSpace(doc, 50);
      sectionTitle(doc, "5. Keyword Performance");
      doc.font("Helvetica").fontSize(8.5).fillColor(C.textLight)
        .text("No keyword data available for this period.", M + 4, doc.y);
      doc.y += 20;
    }

    // ===== 6. BACKLINKS =====
    ensureSpace(doc, 60);
    sectionTitle(doc, "6. Backlinks");

    if (bl && (bl.current > 0 || bl.previous > 0)) {
      const blColWidths = [CW * 0.40, CW * 0.30, CW * 0.30];
      const blHeaders   = ["Metric", "Current", "Change"];
      doc.roundedRect(M, doc.y, CW, 18, 2).fill(C.primary);
      let bhx = M;
      for (let i = 0; i < blHeaders.length; i++) {
        doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff")
          .text(blHeaders[i], bhx + 6, doc.y + 5, { width: blColWidths[i] - 12, align: i === 0 ? "left" : "right" });
        bhx += blColWidths[i];
      }
      doc.y += 18;
      const blRows = [
        { label: "Total Backlinks",   current: bl.current,         delta: bl.delta },
        { label: "Referring Domains", current: bl.referringDomains, delta: bl.referringDomainsDelta },
      ];
      for (let i = 0; i < blRows.length; i++) {
        ensureSpace(doc, 18);
        const row = blRows[i];
        const ry  = doc.y;
        doc.rect(M, ry, CW, 16).fill(i % 2 === 0 ? C.bg : C.cardBg);
        doc.font("Helvetica").fontSize(7).fillColor(C.text).text(row.label, M + 6, ry + 4, { width: blColWidths[0] - 12 });
        doc.font("Helvetica").fontSize(7).fillColor(C.text).text(row.current.toLocaleString(), M + blColWidths[0] + 6, ry + 4, { width: blColWidths[1] - 12, align: "right" });
        const dColor = row.delta > 0 ? C.positive : row.delta < 0 ? C.danger : C.neutral;
        const dStr   = row.delta > 0 ? `+${row.delta}` : row.delta < 0 ? `${row.delta}` : "stable";
        doc.font("Helvetica-Bold").fontSize(7).fillColor(dColor).text(dStr, M + blColWidths[0] + blColWidths[1] + 6, ry + 4, { width: blColWidths[2] - 12, align: "right" });
        doc.y = ry + 16;
      }
      doc.y += 14;
    } else {
      doc.font("Helvetica").fontSize(8.5).fillColor(C.textLight)
        .text("Backlink data unavailable. Configure SEMrush or DataForSEO API.", M + 4, doc.y);
      doc.y += 20;
    }

    // ===== 7. WHAT CHANGED =====
    ensureSpace(doc, 90);
    sectionTitle(doc, "7. What Changed");

    const changes: { label: string; value: number; display: string }[] = [
      { label: "Traffic Growth",     value: data.metrics.traffic.growthRate, display: formatDelta(data.metrics.traffic.growthRate, "%") },
      { label: "Keyword Net Growth", value: data.metrics.keywords.netGrowth, display: data.metrics.keywords.netGrowth !== 0 ? formatDelta(data.metrics.keywords.netGrowth, " keywords") : "Stable" },
    ];
    if (searchValid) {
      const gap = data.metrics.search.ctrGap;
      changes.push({ label: "CTR vs Benchmark", value: gap <= 0 ? 1 : -1, display: gap <= 0 ? `+${Math.abs(gap)}% above target` : `-${gap}% below target` });
    }
    if (convMetrics && (convMetrics.current > 0 || convMetrics.previous > 0)) {
      changes.push({ label: "Conversion Growth", value: convMetrics.growthRate, display: formatDelta(convMetrics.growthRate, "%") });
    }

    for (const change of changes) {
      ensureSpace(doc, 28);
      const rowY  = doc.y;
      const color = change.label === "CTR vs Benchmark"
        ? (change.value > 0 ? C.positive : C.danger)
        : (change.value > 0 ? C.positive : change.value < 0 ? C.danger : C.neutral);
      doc.roundedRect(M, rowY, CW, 22, 3).fill(C.bg);
      doc.font("Helvetica").fontSize(8.5).fillColor(C.text).text(change.label, M + 12, rowY + 6, { width: 150 });
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(color).text(change.display, M + 170, rowY + 6, { width: CW - 180 });
      doc.y = rowY + 26;
    }
    doc.y += 10;

    // ===== 8. DATA AVAILABILITY =====
    ensureSpace(doc, 120);
    sectionTitle(doc, "8. Data Availability");

    const hasGA4Data  = data.metrics.traffic.users > 0 || data.metrics.traffic.sessions > 0;
    const hasGSCData  = data.metrics.search.clicks > 0 || data.metrics.search.impressions > 0;
    const hasKwData   = (data.keywords && data.keywords.length > 0) || data.metrics.keywords.total > 0;
    const hasBLData   = bl && (bl.current > 0 || bl.previous > 0);
    const hasAiData   = data.aiReferrers && data.aiReferrers.length > 0;

    const statusRows = [
      { label: "Google Analytics 4 (Users, Sessions)",           connected: hasGA4Data },
      { label: "Google Search Console (Clicks, Impressions, CTR, Position)", connected: hasGSCData },
      { label: "GSC Keywords (Top Queries)",                     connected: hasKwData },
      { label: "Backlinks (SEMrush / DataForSEO)",               connected: !!hasBLData },
      { label: "AI Referrer Traffic",                            connected: !!hasAiData },
    ];

    const daCols = [CW * 0.70, CW * 0.30];
    doc.roundedRect(M, doc.y, CW, 18, 2).fill(C.primary);
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff").text("Data Source",   M + 6,            doc.y + 5, { width: daCols[0] - 12 });
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff").text("Status",        M + daCols[0] + 6, doc.y + 5, { width: daCols[1] - 12, align: "right" });
    doc.y += 18;

    for (let i = 0; i < statusRows.length; i++) {
      ensureSpace(doc, 18);
      const row   = statusRows[i];
      const ry    = doc.y;
      doc.rect(M, ry, CW, 16).fill(i % 2 === 0 ? C.bg : C.cardBg);
      doc.font("Helvetica").fontSize(7).fillColor(C.text).text(row.label, M + 6, ry + 4, { width: daCols[0] - 12 });
      const connLabel = row.connected ? "Connected" : "Unavailable";
      const connColor = row.connected ? C.positive : C.textMuted;
      doc.font("Helvetica").fontSize(7).fillColor(connColor).text(connLabel, M + daCols[0] + 6, ry + 4, { width: daCols[1] - 12, align: "right" });
      doc.y = ry + 16;
    }

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
