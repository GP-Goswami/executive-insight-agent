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
  avgEngagementTimeSeconds?: number;
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
  rootCauses?: Array<{ rank: number; name: string; confidence: number; evidence: string }>;
  brandSplit?: { brandClicks: number; nonBrandClicks: number; brandPct: number; nonBrandPct: number } | null;
  ctrOpportunities?: Array<{ page: string; impressions: number; currentCtr: number; potentialClicks: number; clickGap: number; isQuickWin: boolean }>;
  dataHealth?: { score: number; issues: string[]; warnings: string[]; confidence: number };
  siteHealth?: {
    overallScore: number;
    status: string;
    statusColor: string;
    backlinksIncluded: boolean;
    pillars: Array<{ name: string; score: number; available: boolean; insight: string }>;
  } | null;
  executiveVerdict?: { status: string; keyInsight: string; decisions: string[] } | null;
  competitiveSOV?: {
    truefirmsSOV: number;
    gap: number;
    monthlyClicksNeeded: number;
    competitors?: Array<{ domain: string; sov: number; isReal: boolean; label?: string; organicTraffic?: number }>;
    dataSource?: "semrush" | "fallback";
    semrushAvailable?: boolean;
  } | null;
  forecast?: {
    noAction:   { users: number; clicks: number; changePercent?: number; insight?: string };
    withAction: { users: number; clicks: number; changePercent?: number; additionalClicks?: number; insight?: string };
    confidence?: number;
    methodology?: { rawDeclineRate: number | null; trendDecline: number; ctrImprovementRate: number; dataSource: "trend-based" | "default" };
  } | null;
  /** Optional AI-generated sections from A10 — appended after all existing sections. */
  aiDraft?: AISectionReportDraft;
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
  ensureSpace(doc, 46);
  const ty = doc.y;
  // Full-width dark bar with white title — clearly separates sections
  doc.rect(M, ty, CW, 22).fill(C.primary);
  doc.rect(M, ty, 4, 22).fill(C.accent);
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#ffffff")
    .text(title.toUpperCase(), M + 12, ty + 6, { width: CW - 24, characterSpacing: 0.7 });
  doc.y = ty + 28;
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
    bottomY += 8;
  }
  if (opts?.lowVisibility) {
    doc.font("Helvetica").fontSize(6).fillColor(C.warning).text("Low visibility", x + 12, bottomY, { width: w - 20 });
    bottomY += 8;
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

function cleanText(text: string): string {
  return text.replace(/[^\x20-\x7E]/g, "").trim();
}

// Mirrors computeDataHealth() from report-preview.tsx exactly.
// 3 checks only — no CTR/position/growth penalties — so the PDF score
// matches the number the user sees on the preview page.
function pdfDataHealth(m: SeoMetrics): { score: number; label: string; color: string; issues: string[] } {
  const hasTraffic   = m.traffic.users > 0 || m.traffic.sessions > 0;
  const hasSearch    = m.search.impressions > 0;
  const hasBacklinks = m.backlinks.current > 0 || m.backlinks.referringDomains > 0;
  let score = 100;
  const issues: string[] = [];

  if (!hasTraffic)   { score -= 20; issues.push("GA4 traffic data is missing"); }
  if (!hasSearch)    { score -= 20; issues.push("Google Search Console data is missing"); }
  if (!hasBacklinks) { score -= 15; issues.push("Backlink data unavailable"); }

  score = Math.max(0, score);
  const label = score >= 80 ? "Healthy" : score >= 60 ? "At Risk" : "Critical";
  const color = score >= 80 ? "#16a34a" : score >= 60 ? "#ca8a04" : "#dc2626";
  return { score, label, color, issues };
}

// Recompute executive verdict purely from metrics (mirrors frontend logic)
function pdfVerdict(m: SeoMetrics): { status: string; color: string; keyInsight: string; decisions: string[] } {
  const hasSearch    = m.search.impressions > 0;
  const hasTraffic   = m.traffic.users > 0 || m.traffic.sessions > 0;
  const hasBacklinks = m.backlinks.current > 0 || m.backlinks.referringDomains > 0;
  const ctr    = m.search.ctr;
  const growth = m.traffic.growthRate;

  let status = "Healthy";
  let color  = "#16a34a";
  if ((hasSearch && ctr < 1) || (hasTraffic && growth < -50)) { status = "Critical"; color = "#dc2626"; }
  else if ((hasSearch && ctr < 3) || (hasTraffic && growth < -20)) { status = "At Risk"; color = "#ca8a04"; }

  const decisions: string[] = [];
  if (hasSearch && ctr < 3)       decisions.push("Optimize meta titles and descriptions to improve CTR.");
  if (hasTraffic && growth < -20) decisions.push("Investigate and address the root cause of traffic decline.");
  if (!hasBacklinks)               decisions.push("Configure backlink tracking for a complete data picture.");
  const filler = [
    "Review top-performing pages and replicate success patterns.",
    "Monitor keyword positions and capitalize on page-2 opportunities.",
    "Audit internal linking to strengthen authority distribution.",
  ];
  while (decisions.length < 3) decisions.push(filler[decisions.length] ?? filler[filler.length - 1]);

  let keyInsight = "Performance metrics are within expected range.";
  if (status === "Critical") {
    keyInsight = hasSearch && ctr < 1
      ? `CTR is critically low at ${ctr}% -- impressions are not converting to clicks.`
      : `Traffic dropped ${Math.abs(growth)}% -- immediate investigation required.`;
  } else if (status === "At Risk") {
    keyInsight = hasSearch && ctr < 3
      ? `CTR of ${ctr}% is below the 3% target -- title and meta optimisation can unlock more clicks.`
      : `Traffic declined ${Math.abs(growth)}% -- monitor trends closely and identify root causes.`;
  }
  return { status, color, keyInsight, decisions: decisions.slice(0, 3) };
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

    // ===== TITLE BLOCK =====
    doc.font("Helvetica-Bold").fontSize(18).fillColor(C.primary)
      .text("SEO Performance Report", M, M, { width: CW });
    doc.font("Helvetica").fontSize(10).fillColor(C.textLight)
      .text(sanitize(data.domain), M, M + 26, { width: CW / 2 });
    doc.font("Helvetica").fontSize(8).fillColor(C.textMuted)
      .text(`${sanitize(data.dateRange.start)} -- ${sanitize(data.dateRange.end)}  |  Generated ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, M, M + 42, { width: CW });
    doc.y = M + 60;

    // ===== 0a. DATA HEALTH SCORE + EXECUTIVE VERDICT =====
    try {
      const rawHealth = data.dataHealth ?? pdfDataHealth(data.metrics);
      const healthLabel = rawHealth.score >= 75 ? "Good" : rawHealth.score >= 50 ? "At Risk" : rawHealth.score >= 25 ? "Poor" : "Critical";
      const healthColor = rawHealth.score >= 75 ? "#16a34a" : rawHealth.score >= 50 ? "#ca8a04" : "#dc2626";
      const health = { score: rawHealth.score, label: healthLabel, color: healthColor, issues: rawHealth.issues };
      const rawVerdict = data.executiveVerdict ?? pdfVerdict(data.metrics);
      const verdict = {
        status: rawVerdict.status,
        keyInsight: rawVerdict.keyInsight,
        decisions: rawVerdict.decisions,
        color: rawVerdict.status === "Critical" ? "#dc2626" : rawVerdict.status === "At Risk" ? "#ca8a04" : "#16a34a",
      };
      ensureSpace(doc, 140);

      const hvW  = (CW - 16) / 2;
      const hvH  = 175;
      const hvY  = doc.y;

      // ─── LEFT CARD: Data Health Score ───────────────────────────────────
      doc.roundedRect(M, hvY, hvW, hvH, 5).fillAndStroke(C.cardBg, C.border);
      // Header bar
      doc.rect(M, hvY, hvW, 22).fill(C.headerBg);
      doc.rect(M, hvY, 4, 22).fill(health.color);
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#ffffff")
        .text("DATA HEALTH SCORE", M + 10, hvY + 7, { width: hvW - 20, characterSpacing: 0.5 });

      // Big score number
      doc.font("Helvetica-Bold").fontSize(38).fillColor(health.color)
        .text(`${health.score}`, M + 10, hvY + 28, { width: 58, lineBreak: false });
      doc.font("Helvetica").fontSize(9).fillColor(C.textMuted)
        .text("/ 100", M + 60, hvY + 46, { width: 36 });

      // Status badge
      doc.roundedRect(M + 10, hvY + 70, 52, 14, 3).fill(health.color);
      doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff")
        .text(health.label.toUpperCase(), M + 10, hvY + 74, { width: 52, align: "center" });

      // Issues list (right of score)
      if (health.issues.length === 0) {
        doc.font("Helvetica").fontSize(8).fillColor(health.color)
          .text("All data sources connected", M + 72, hvY + 36, { width: hvW - 84 });
      } else {
        let iy = hvY + 28;
        const issW = hvW - 84;
        for (const iss of health.issues.slice(0, 3)) {
          const issText = `- ${sanitize(iss)}`;
          doc.font("Helvetica").fontSize(7.5).fillColor(C.text)
            .text(issText, M + 72, iy, { width: issW });
          iy += doc.heightOfString(issText, { width: issW }) + 4;
        }
      }

      // ─── RIGHT CARD: Executive Verdict ──────────────────────────────────
      const vx = M + hvW + 16;
      doc.roundedRect(vx, hvY, hvW, hvH, 5).fillAndStroke(C.cardBg, C.border);
      // Header bar
      doc.rect(vx, hvY, hvW, 22).fill(C.headerBg);
      doc.rect(vx, hvY, 4, 22).fill(verdict.color);
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#ffffff")
        .text("EXECUTIVE VERDICT", vx + 10, hvY + 7, { width: hvW - 20, characterSpacing: 0.5 });

      // Status badge
      doc.roundedRect(vx + 10, hvY + 28, 64, 16, 3).fill(verdict.color);
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff")
        .text(verdict.status.toUpperCase(), vx + 10, hvY + 32, { width: 64, align: "center" });

      // Key insight
      const kiOpts = { width: hvW - 24, lineGap: 2 };
      doc.font("Helvetica").fontSize(8);
      const kiH = doc.heightOfString(sanitize(verdict.keyInsight), kiOpts);
      doc.fillColor(C.text).text(sanitize(verdict.keyInsight), vx + 10, hvY + 50, kiOpts);

      // Top 3 Decisions — mirrors the preview page's numbered list
      let decY = hvY + 50 + kiH + 8;
      doc.font("Helvetica").fontSize(6.5).fillColor(C.textMuted)
        .text("TOP 3 DECISIONS", vx + 10, decY, { width: hvW - 24, characterSpacing: 0.4 });
      decY += 11;
      for (let d = 0; d < verdict.decisions.length && d < 3; d++) {
        const decText = sanitize(verdict.decisions[d]);
        const decOpts = { width: hvW - 28, lineGap: 1 };
        const dH = doc.font("Helvetica").fontSize(7).heightOfString(decText, decOpts);
        doc.font("Helvetica-Bold").fontSize(7).fillColor(verdict.color)
          .text(`${d + 1}.`, vx + 10, decY, { width: 10, lineBreak: false });
        doc.font("Helvetica").fontSize(7).fillColor(C.text)
          .text(decText, vx + 22, decY, decOpts);
        decY += dH + 4;
      }

      doc.y = hvY + hvH + 14;
    } catch (err: any) {
      doc.fontSize(9).fillColor("#E53E3E").text(`[Health/Verdict failed: ${err.message}]`, M, doc.y);
      doc.y += 14;
    }

    // ===== 1. KPI SNAPSHOT =====
    // 2-row grid: Row 1 — Users (GA4), Sessions (GA4), Clicks (GSC)
    //             Row 2 — Impressions (GSC), CTR (GSC), Avg Position (GSC)
    sectionTitle(doc, "1. KPI Snapshot");

    const c3w = (CW - 20) / 3;
    const kpiY1 = doc.y;
    drawKpiCard(doc, M,                  kpiY1, c3w, "Users",       data.metrics.traffic.users.toLocaleString(),    C.accent,   { subtitle: "GA4", delta: data.metrics.traffic.growthRate, deltaSuffix: "%" });
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

    // ===== SITE HEALTH SCORE =====
    try {
      ensureSpace(doc, 180);
      sectionTitle(doc, "Site Health Score");

      const shM = data.metrics;
      const shHasSearch    = shM.search.impressions > 0;
      const shHasTraffic   = shM.traffic.users > 0 || shM.traffic.sessions > 0;
      const shHasBacklinks = shM.backlinks.current > 0 || shM.backlinks.referringDomains > 0;
      const shColorFn = (s: number) => s >= 80 ? "#38A169" : s >= 60 ? "#D69E2E" : s >= 40 ? "#DD6B20" : "#E53E3E";

      let shPillars: { name: string; score: number; available: boolean; insight: string }[] = [];

      // Pillar 1: Search Visibility
      if (shHasSearch) {
        const ctr = shM.search.ctr;
        const pos = shM.search.avgPosition;
        const ctrScore = ctr >= 5 ? 100 : ctr >= 3 ? 75 : ctr >= 1 ? 50 : 25;
        const posBonus = pos <= 10 ? 25 : pos <= 20 ? 15 : pos <= 30 ? 5 : 0;
        shPillars.push({
          name: "Search Visibility", score: Math.min(100, ctrScore + posBonus), available: true,
          insight: ctr < 1 ? "CTR critically low" : ctr < 3 ? "CTR below target" : pos > 20 ? "Good CTR, deep rankings" : "Performing well",
        });
      } else {
        shPillars.push({ name: "Search Visibility", score: 0, available: false, insight: "No GSC data" });
      }

      // Pillar 2: Content Quality
      const ts = data.trafficSummary;
      if (ts && shHasTraffic) {
        const er = ts.engagementRate;
        const et = ts.avgEngagementTimeSeconds ?? 0;
        const erScore = er >= 60 ? 50 : er >= 40 ? 35 : er >= 20 ? 20 : 10;
        const etScore = et >= 120 ? 50 : et >= 60 ? 35 : et >= 30 ? 20 : 10;
        shPillars.push({
          name: "Content Quality", score: Math.min(100, erScore + etScore), available: true,
          insight: er < 40 ? "Low engagement" : et < 30 ? "Short dwell time" : "Engaging content",
        });
      } else if (shHasTraffic) {
        shPillars.push({ name: "Content Quality", score: 60, available: true, insight: "Partial score" });
      } else {
        shPillars.push({ name: "Content Quality", score: 0, available: false, insight: "No GA4 data" });
      }

      // Pillar 3: Data Integrity
      const shDH = pdfDataHealth(shM);
      shPillars.push({
        name: "Data Integrity", score: shDH.score, available: true,
        insight: shDH.score >= 80 ? "All sources connected" : sanitize(shDH.issues[0] || "Missing sources"),
      });

      // Pillar 4: Traffic Health
      if (shHasTraffic) {
        const gr = shM.traffic.growthRate;
        const trendScore = gr >= 20 ? 75 : gr >= 0 ? 60 : gr >= -20 ? 40 : 15;
        const mmR = shHasSearch && shM.search.clicks > 0 && shM.traffic.users > 0 ? shM.search.clicks / shM.traffic.users : 1;
        const mmBonus = mmR < 2 ? 25 : mmR < 5 ? 15 : 5;
        shPillars.push({
          name: "Traffic Health", score: Math.min(100, trendScore + mmBonus), available: true,
          insight: gr < -50 ? "Severe decline" : gr < -20 ? "Traffic declining" : gr >= 0 ? "Stable/growing" : "Slight dip",
        });
      } else {
        shPillars.push({ name: "Traffic Health", score: 0, available: false, insight: "No GA4 data" });
      }

      // Pillar 5: Authority (Backlinks)
      if (shHasBacklinks) {
        const bd = shM.backlinks.delta;
        const rdd = shM.backlinks.referringDomainsDelta;
        const ds = bd > 50 ? 60 : bd > 0 ? 45 : bd > -20 ? 30 : 10;
        const rds = rdd > 0 ? 40 : rdd === 0 ? 25 : 10;
        shPillars.push({
          name: "Authority (Backlinks)", score: Math.min(100, ds + rds), available: true,
          insight: bd < 0 ? "Losing backlinks" : bd > 0 ? "Profile growing" : "Profile stable",
        });
      } else {
        shPillars.push({ name: "Authority (Backlinks)", score: 0, available: false, insight: "Configure backlink tracking" });
      }

      // Use passed computed values if available, otherwise recompute
      if (data.siteHealth) {
        shPillars = data.siteHealth.pillars;
      }
      const shAvail  = shPillars.filter(p => p.available);
      const shWeight = shAvail.length > 0 ? 1 / shAvail.length : 0;
      const shScore  = data.siteHealth?.overallScore
        ?? Math.round(shPillars.reduce((s, p) => s + (p.available ? p.score * shWeight : 0), 0));
      const shStatus = data.siteHealth?.status
        ?? (shScore >= 80 ? "Excellent" : shScore >= 60 ? "Healthy" : shScore >= 40 ? "Needs Work" : "Critical");
      const shStatusColorMap: Record<string, string> = {
        Healthy: "#38A169", "At Risk": "#D69E2E", Poor: "#DD6B20", Critical: "#E53E3E",
      };
      const shMainColor = data.siteHealth
        ? (shStatusColorMap[shStatus] ?? shColorFn(shScore))
        : shColorFn(shScore);

      // ─── Score + status badge ───────────────────────────────────────────────
      const shY = doc.y;
      doc.font("Helvetica-Bold").fontSize(32).fillColor(shMainColor)
        .text(`${shScore}`, M, shY, { width: 56, lineBreak: false });
      doc.font("Helvetica").fontSize(9).fillColor(C.textMuted)
        .text("/ 100", M + 50, shY + 16, { width: 36, lineBreak: false });
      doc.roundedRect(M + 96, shY + 4, 60, 16, 3).fill(shMainColor);
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#ffffff")
        .text(shStatus.toUpperCase(), M + 96, shY + 8, { width: 60, align: "center" });

      const shWorst = shAvail.reduce<{ name: string; score: number } | undefined>((w, p) => (!w || p.score < w.score ? p : w), undefined);
      const shSummary = shAvail.length === 0
        ? "No data available."
        : `${shAvail.length} of 5 pillars active. Weakest: ${shWorst?.name ?? ""} (${shWorst?.score ?? 0}/100)`;
      doc.font("Helvetica").fontSize(7.5).fillColor(C.textLight)
        .text(sanitize(shSummary), M + 168, shY + 10, { width: CW - 176 });
      doc.y = shY + 44;

      // ─── Full-width progress bar ────────────────────────────────────────────
      doc.rect(M, doc.y, CW, 6).fill(C.borderLight);
      doc.rect(M, doc.y, Math.round(CW * shScore / 100), 6).fill(shMainColor);
      doc.y += 14;

      // ─── Pillar rows ────────────────────────────────────────────────────────
      const shPillarY = doc.y;
      const shRowH = 24;
      for (let i = 0; i < shPillars.length; i++) {
        const p = shPillars[i];
        const py = shPillarY + i * (shRowH + 4);
        const pColor = p.available ? shColorFn(p.score) : C.textMuted;
        doc.rect(M, py, CW, shRowH).fill(i % 2 === 0 ? C.bg : C.cardBg);
        doc.font("Helvetica").fontSize(7.5).fillColor(p.available ? C.text : C.textMuted)
          .text(sanitize(p.name), M + 6, py + 8, { width: 148, lineBreak: false });
        doc.font("Helvetica-Bold").fontSize(8).fillColor(pColor)
          .text(p.available ? `${p.score}` : "--", M + 158, py + 8, { width: 36, align: "right", lineBreak: false });
        if (p.available) {
          doc.rect(M + 200, py + 10, 180, 5).fill(C.borderLight);
          doc.rect(M + 200, py + 10, Math.round(180 * p.score / 100), 5).fill(pColor);
        }
        doc.font("Helvetica").fontSize(7).fillColor(C.textLight)
          .text(sanitize(p.insight), M + 390, py + 8, { width: CW - 398, lineBreak: false });
      }
      doc.y = shPillarY + shPillars.length * (shRowH + 4) + 10;
    } catch (err: any) {
      doc.fontSize(9).fillColor("#E53E3E").text(`[Site Health failed: ${err.message}]`, M, doc.y);
      doc.y += 14;
    }

    // ===== WHY THIS HAPPENED (Root Cause Analysis) =====
    try {
      const rcData = data.rootCauses || [];
      ensureSpace(doc, 60);
      sectionTitle(doc, "Why This Happened");
      if (rcData.length === 0) {
        ensureSpace(doc, 30);
        doc.roundedRect(M, doc.y, CW, 28, 4).fillAndStroke(C.cardBg, C.border);
        doc.rect(M, doc.y, 3, 28).fill(C.positive);
        doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C.positive)
          .text("No anomalies detected -- data looks healthy", M + 12, doc.y + 8, { width: CW - 28 });
        doc.y += 36;
      } else {
        for (const cause of rcData) {
          ensureSpace(doc, 52);
          const rcY = doc.y;
          const barH = 44;
          doc.roundedRect(M, rcY, CW, barH, 3).fillAndStroke(C.cardBg, C.border);
          // rank badge
          doc.circle(M + 18, rcY + 14, 8).fill(C.headerBg);
          doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff")
            .text(`${cause.rank}`, M + 14, rcY + 10, { width: 8, align: "center" });
          // name + confidence badge
          const confColor = cause.confidence > 75 ? C.positive : cause.confidence >= 50 ? C.warning : C.danger;
          doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C.text)
            .text(sanitize(cause.name), M + 34, rcY + 6, { width: CW - 120 });
          doc.roundedRect(CW - 44, rcY + 6, 72, 12, 3).fill(confColor);
          doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#ffffff")
            .text(`${cause.confidence}% confident`, CW - 44, rcY + 9, { width: 72, align: "center" });
          // confidence bar
          doc.rect(M + 34, rcY + 20, CW - 78, 3).fill(C.borderLight);
          doc.rect(M + 34, rcY + 20, Math.round((CW - 78) * cause.confidence / 100), 3).fill(confColor);
          // evidence
          doc.font("Helvetica").fontSize(7.5).fillColor(C.textLight)
            .text(sanitize(cause.evidence), M + 34, rcY + 27, { width: CW - 78 });
          doc.y = rcY + barH + 6;
        }
      }
      doc.y += 6;
    } catch (err: any) {
      doc.fontSize(9).fillColor("#E53E3E").text(`[Root Cause failed: ${err.message}]`, M, doc.y);
      doc.y += 14;
    }

    // ===== TRAFFIC BREAKDOWN (Brand vs Non-Brand) =====
    try {
      ensureSpace(doc, 80);
      sectionTitle(doc, "Traffic Breakdown");
      const bs = data.brandSplit;
      if (!bs || (bs.brandClicks === 0 && bs.nonBrandClicks === 0)) {
        doc.font("Helvetica").fontSize(8.5).fillColor(C.textLight)
          .text("Brand split unavailable -- keyword-level click data required.", M + 4, doc.y);
        doc.y += 20;
      } else {
        // Two stat boxes side by side
        const bsBoxW = (CW - 16) / 2;
        const bsBoxY = doc.y;
        // Brand box
        doc.roundedRect(M, bsBoxY, bsBoxW, 56, 4).fillAndStroke(C.cardBg, C.border);
        doc.font("Helvetica").fontSize(7).fillColor(C.textMuted)
          .text("BRAND", M + 8, bsBoxY + 7, { characterSpacing: 0.5 });
        doc.font("Helvetica-Bold").fontSize(22).fillColor("#9333ea")
          .text(`${bs.brandPct}%`, M + 8, bsBoxY + 18);
        doc.font("Helvetica").fontSize(7.5).fillColor(C.textMuted)
          .text(`${bs.brandClicks.toLocaleString()} clicks`, M + 8, bsBoxY + 43);
        // Non-brand box
        doc.roundedRect(M + bsBoxW + 16, bsBoxY, bsBoxW, 56, 4).fillAndStroke(C.cardBg, C.border);
        doc.font("Helvetica").fontSize(7).fillColor(C.textMuted)
          .text("NON-BRAND", M + bsBoxW + 24, bsBoxY + 7, { characterSpacing: 0.5 });
        doc.font("Helvetica-Bold").fontSize(22).fillColor("#0d9488")
          .text(`${bs.nonBrandPct}%`, M + bsBoxW + 24, bsBoxY + 18);
        doc.font("Helvetica").fontSize(7.5).fillColor(C.textMuted)
          .text(`${bs.nonBrandClicks.toLocaleString()} clicks`, M + bsBoxW + 24, bsBoxY + 43);
        doc.y = bsBoxY + 64;
        // Stacked bar
        const barTotalW = CW;
        const brandBarW = Math.round(barTotalW * bs.brandPct / 100);
        const nonBrandBarW = barTotalW - brandBarW;
        if (brandBarW > 0)    doc.rect(M, doc.y, brandBarW, 10).fill("#9333ea");
        if (nonBrandBarW > 0) doc.rect(M + brandBarW, doc.y, nonBrandBarW, 10).fill("#0d9488");
        doc.y += 18;
        // Interpretation
        const bsMsg = bs.nonBrandPct < 30
          ? "Heavy brand dependency -- non-brand acquisition is weak"
          : bs.nonBrandPct <= 60
          ? "Balanced traffic mix"
          : "Strong non-brand acquisition";
        const bsMsgColor = bs.nonBrandPct < 30 ? C.warning : bs.nonBrandPct <= 60 ? C.accent : C.positive;
        doc.font("Helvetica-Bold").fontSize(8.5).fillColor(bsMsgColor)
          .text(sanitize(bsMsg), M + 4, doc.y);
        doc.y += 18;
      }
    } catch (err: any) {
      doc.fontSize(9).fillColor("#E53E3E").text(`[Brand Split failed: ${err.message}]`, M, doc.y);
      doc.y += 14;
    }

    // ===== CTR OPPORTUNITIES =====
    try {
      ensureSpace(doc, 60);
      sectionTitle(doc, "CTR Opportunities");
      const ctrOpps = data.ctrOpportunities || [];
      if (ctrOpps.length === 0) {
        doc.font("Helvetica").fontSize(8.5).fillColor(C.textLight)
          .text("No high-impression, low-CTR pages found -- site CTR is performing well.", M + 4, doc.y);
        doc.y += 20;
      } else {
        const ctrCols  = [CW * 0.34, CW * 0.14, CW * 0.14, CW * 0.14, CW * 0.10, CW * 0.14];
        const ctrHdrs  = ["Page", "Impressions", "Current CTR", "Potential", "Gap", "Quick Win"];
        doc.roundedRect(M, doc.y, CW, 18, 2).fill(C.primary);
        const ctrHdrY = doc.y;
        let ctrHx = M;
        for (let i = 0; i < ctrHdrs.length; i++) {
          doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff")
            .text(ctrHdrs[i], ctrHx + 5, ctrHdrY + 5, { width: ctrCols[i] - 10, align: i === 0 ? "left" : "right" });
          ctrHx += ctrCols[i];
        }
        doc.y = ctrHdrY + 18;
        for (let i = 0; i < ctrOpps.length; i++) {
          ensureSpace(doc, 16);
          const op = ctrOpps[i];
          const ry = doc.y;
          doc.rect(M, ry, CW, 16).fill(i % 2 === 0 ? C.bg : C.cardBg);
          let cx = M;
          const pg = sanitize(op.page);
          doc.font("Helvetica").fontSize(7).fillColor(C.text)
            .text(pg.length > 35 ? pg.slice(0, 35) + "..." : pg, cx + 5, ry + 4, { width: ctrCols[0] - 10 });
          cx += ctrCols[0];
          doc.font("Helvetica").fontSize(7).fillColor(C.text)
            .text(op.impressions.toLocaleString(), cx + 5, ry + 4, { width: ctrCols[1] - 10, align: "right" });
          cx += ctrCols[1];
          const ctrColor = op.currentCtr < 0.5 ? C.danger : op.currentCtr < 2 ? C.warning : C.positive;
          doc.font("Helvetica-Bold").fontSize(7).fillColor(ctrColor)
            .text(`${op.currentCtr.toFixed(2)}%`, cx + 5, ry + 4, { width: ctrCols[2] - 10, align: "right" });
          cx += ctrCols[2];
          doc.font("Helvetica").fontSize(7).fillColor(C.positive)
            .text(`+${op.potentialClicks.toLocaleString()}`, cx + 5, ry + 4, { width: ctrCols[3] - 10, align: "right" });
          cx += ctrCols[3];
          doc.font("Helvetica").fontSize(7).fillColor(C.text)
            .text(`+${op.clickGap.toLocaleString()}`, cx + 5, ry + 4, { width: ctrCols[4] - 10, align: "right" });
          cx += ctrCols[4];
          doc.font("Helvetica-Bold").fontSize(7).fillColor(op.isQuickWin ? C.warning : C.textMuted)
            .text(op.isQuickWin ? "YES" : "--", cx + 5, ry + 4, { width: ctrCols[5] - 10, align: "right" });
          doc.y = ry + 16;
        }
        const totalGain = ctrOpps.reduce((s, o) => s + o.clickGap, 0);
        doc.y += 6;
        doc.roundedRect(M, doc.y, CW, 20, 3).fill("#064e3b");
        doc.font("Helvetica-Bold").fontSize(8).fillColor("#34d399")
          .text(`Total opportunity: +${totalGain.toLocaleString()} clicks if top ${ctrOpps.length} page${ctrOpps.length > 1 ? "s" : ""} reach 5% CTR`, M + 12, doc.y + 5, { width: CW - 24 });
        doc.y += 28;
      }
    } catch (err: any) {
      doc.fontSize(9).fillColor("#E53E3E").text(`[CTR Opportunities failed: ${err.message}]`, M, doc.y);
      doc.y += 14;
    }

    // ===== 2. AI SEARCH VISIBILITY =====
    try {
      ensureSpace(doc, 80);
      sectionTitle(doc, "AI Search Visibility");


      const aiRefs     = data.aiReferrers || [];
      const aiTotalU   = aiRefs.reduce((s, r) => s + (r.totalUsers ?? 0), 0);
      const aiTotalS   = aiRefs.reduce((s, r) => s + (r.sessions ?? 0), 0);

      if (aiRefs.length === 0) {
        ensureSpace(doc, 80);
        const aiBoxY = doc.y;
        doc.roundedRect(M, aiBoxY, CW, 72, 4).strokeColor(C.border).stroke();
        doc.rect(M, aiBoxY, 3, 72).fill(C.accent);
        doc.font("Helvetica-Bold").fontSize(10).fillColor(C.text)
          .text("AI mention tracking not yet configured", M + 14, aiBoxY + 12, { width: CW - 28 });
        doc.font("Helvetica").fontSize(8.5).fillColor(C.textLight)
          .text(
            "Set up prompt sets in AI Mentions to track visibility in ChatGPT, Gemini and Perplexity.",
            M + 14, aiBoxY + 30, { width: CW - 28 }
          );
        doc.font("Helvetica").fontSize(8.5).fillColor(C.textMuted)
          .text(
            "Coverage data will appear here once prompt runs are complete.",
            M + 14, aiBoxY + 50, { width: CW - 28 }
          );
        doc.y = aiBoxY + 80;
      } else {
        // Stat blocks
        ensureSpace(doc, 52);
        const aiStatW = (CW - 20) / 2;
        const aiStatY = doc.y;
        doc.roundedRect(M, aiStatY, aiStatW, 42, 3).fillAndStroke(C.cardBg, C.border);
        doc.font("Helvetica").fontSize(7).fillColor(C.textLight)
          .text("TOTAL AI USERS", M + 8, aiStatY + 6, { characterSpacing: 0.4 });
        doc.font("Helvetica-Bold").fontSize(15).fillColor(C.text)
          .text(aiTotalU.toLocaleString(), M + 8, aiStatY + 18);
        doc.roundedRect(M + aiStatW + 20, aiStatY, aiStatW, 42, 3).fillAndStroke(C.cardBg, C.border);
        doc.font("Helvetica").fontSize(7).fillColor(C.textLight)
          .text("AI SESSIONS", M + aiStatW + 28, aiStatY + 6, { characterSpacing: 0.4 });
        doc.font("Helvetica-Bold").fontSize(15).fillColor(C.text)
          .text(aiTotalS.toLocaleString(), M + aiStatW + 28, aiStatY + 18);
        doc.y = aiStatY + 52;

        // Referrers table
        ensureSpace(doc, 18 + aiRefs.length * 15);
        const aiHdrY = doc.y;
        doc.roundedRect(M, aiHdrY, CW, 16, 2).fill(C.primary);
        const aiColW = [CW * 0.45, CW * 0.25, CW * 0.30];
        const aiColX = [M, M + aiColW[0], M + aiColW[0] + aiColW[1]];
        const aiHdrs = ["AI Source", "Users", "% of Total"];
        for (let i = 0; i < aiHdrs.length; i++) {
          doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff")
            .text(aiHdrs[i], aiColX[i] + 5, aiHdrY + 4, { width: aiColW[i] - 10, align: i === 0 ? "left" : "right" });
        }
        doc.y = aiHdrY + 16;

        for (let i = 0; i < aiRefs.length; i++) {
          ensureSpace(doc, 15);
          const ref = aiRefs[i];
          const ry  = doc.y;
          doc.rect(M, ry, CW, 14).fill(i % 2 === 0 ? C.bg : C.cardBg);
          doc.font("Helvetica").fontSize(7).fillColor(C.text)
            .text(sanitize(ref.source), aiColX[0] + 5, ry + 3, { width: aiColW[0] - 10 });
          doc.font("Helvetica").fontSize(7).fillColor(C.text)
            .text((ref.totalUsers ?? 0).toLocaleString(), aiColX[1] + 5, ry + 3, { width: aiColW[1] - 10, align: "right" });
          const pctStr = ref.percentOfTotal != null ? `${ref.percentOfTotal.toFixed(1)}%` : "--";
          doc.font("Helvetica").fontSize(7).fillColor(C.text)
            .text(pctStr, aiColX[2] + 5, ry + 3, { width: aiColW[2] - 10, align: "right" });
          doc.y = ry + 14;
        }
        doc.y += 10;
      }
    } catch (err: any) {
      doc.fontSize(9).fillColor("#E53E3E").text(`[Section failed to render: ${err.message}]`, M, doc.y);
      doc.y += 14;
    }

    // ===== 3. COMPETITIVE SHARE OF VOICE =====
    try {
      ensureSpace(doc, 140);
      sectionTitle(doc, "Competitive Share of Voice");

      const sovClicks    = data.metrics.search.clicks ?? 0;
      const sovImps      = data.metrics.search.impressions ?? 0;
      const truefirmsSOV = data.competitiveSOV?.truefirmsSOV
        ?? (sovImps > 0 ? Math.min(Math.round((sovClicks / (sovImps * 0.05)) * 100), 100) : 0);
      const isRealData   = data.competitiveSOV?.semrushAvailable ?? false;
      const sovBarMaxW   = 300;

      // Data source indicator
      const srcLabel = isRealData ? "Live SEMrush data" : "Estimated data";
      const srcColor = isRealData ? C.positive : C.warning;
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor(srcColor)
        .text(`• ${srcLabel}`, M, doc.y, { width: CW });
      doc.y += 12;

      // Build rows: always TrueFirms first, then passed competitors or hardcoded fallback
      const passedComps = data.competitiveSOV?.competitors;
      type SovRow = { label: string; sov: number; color: string; estimated: boolean; organicTraffic?: number };
      const sovRows: SovRow[] = [
        { label: "TrueFirms", sov: truefirmsSOV, color: "#6B46C1", estimated: false },
      ];
      if (passedComps && passedComps.length > 0) {
        for (const comp of passedComps) {
          sovRows.push({
            label:         comp.isReal ? comp.domain : (comp.label ?? comp.domain),
            sov:           comp.sov,
            color:         "#718096",
            estimated:     !comp.isReal,
            organicTraffic: comp.isReal ? comp.organicTraffic : undefined,
          });
        }
      } else {
        sovRows.push({ label: "Clutch",     sov: 72, color: "#718096", estimated: true });
        sovRows.push({ label: "GoodFirms",  sov: 65, color: "#718096", estimated: true });
      }

      const sovStartY = doc.y;
      let sovOffsetY = 0;
      for (const row of sovRows) {
        const rowY = sovStartY + sovOffsetY;
        const barW = Math.round((row.sov / 100) * sovBarMaxW);
        doc.font("Helvetica").fontSize(8.5).fillColor(C.text)
          .text(row.label, M, rowY + 4, { width: 84 });
        doc.roundedRect(M + 88, rowY + 2, sovBarMaxW, 14, 3).fill("#E2E8F0");
        if (barW > 0) doc.roundedRect(M + 88, rowY + 2, barW, 14, 3).fill(row.color);
        doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C.text)
          .text(`${row.sov}%`, M + 88 + sovBarMaxW + 8, rowY + 4, { width: 32 });
        if (row.estimated) {
          doc.font("Helvetica").fontSize(7).fillColor(C.textMuted)
            .text("(est.)", M + 88 + sovBarMaxW + 44, rowY + 5, { width: 34 });
        }
        sovOffsetY += 20;
        if (row.organicTraffic) {
          doc.font("Helvetica").fontSize(6.5).fillColor(C.textMuted)
            .text(`${row.organicTraffic.toLocaleString()} monthly visits`, M + 88, sovStartY + sovOffsetY, { width: sovBarMaxW });
          sovOffsetY += 11;
        } else {
          sovOffsetY += 8;
        }
      }
      doc.y = sovStartY + sovOffsetY + 6;

      // Gap analysis
      const topComp = sovRows[1];
      const gap = data.competitiveSOV?.gap ?? Math.max(0, (topComp?.sov ?? 72) - truefirmsSOV);
      const monthlyClicks = data.competitiveSOV?.monthlyClicksNeeded
        ?? (sovImps > 0 ? Math.round((Math.abs((topComp?.sov ?? 72) - truefirmsSOV) / 100) * sovImps * 0.05) : 0);
      const topLabel = topComp?.label ?? "Clutch";
      const estNote  = topComp?.estimated ? " (estimated)" : "";
      const gapText  = (topComp?.sov ?? 72) > truefirmsSOV
        ? `TrueFirms is ${gap}pp below ${topLabel}${estNote} -- closing this gap requires ~${monthlyClicks.toLocaleString()} more clicks/month`
        : `Share of Voice (${truefirmsSOV}%) meets or exceeds the ${topLabel} benchmark`;
      doc.font("Helvetica").fontSize(8.5).fillColor(C.textLight)
        .text(sanitize(gapText), M + 4, doc.y, { width: CW - 8 });
      doc.y += 18;
      if (!isRealData) {
        doc.font("Helvetica-Oblique").fontSize(7.5).fillColor(C.textMuted)
          .text("Competitor data is industry benchmark estimates, not live figures.", M + 4, doc.y, { width: CW - 8 });
        doc.y += 16;
      }
    } catch (err: any) {
      doc.fontSize(9).fillColor("#E53E3E").text(`[Section failed to render: ${err.message}]`, M, doc.y);
      doc.y += 14;
    }

    // ===== 4. FORECAST & GROWTH PROJECTION =====
    try {
      ensureSpace(doc, 170);
      sectionTitle(doc, "Forecast & Growth Projection");

      const fUsers    = data.metrics.traffic.users ?? 0;
      const fClicks   = data.metrics.search.clicks ?? 0;
      const fNoActU   = data.forecast?.noAction?.users        ?? Math.round(fUsers  * 0.88);
      const fNoActC   = data.forecast?.noAction?.clicks       ?? Math.round(fClicks * 0.88);
      const fNoActPct = data.forecast?.noAction?.changePercent ?? -12;
      const fWithU    = data.forecast?.withAction?.users       ?? Math.round(fUsers  * 1.28);
      const fWithC    = data.forecast?.withAction?.clicks      ?? Math.round(fClicks * 1.28);
      const fWithPct  = data.forecast?.withAction?.changePercent ?? 28;
      const fAddC     = data.forecast?.withAction?.additionalClicks ?? (fWithC - fClicks);
      const fConf     = data.forecast?.confidence ?? 72;
      const fNoActIns = sanitize(data.forecast?.noAction?.insight  ?? "Extrapolating current trajectory without optimization.");
      const fWithIns  = sanitize(data.forecast?.withAction?.insight ?? "Applying CTR fixes, ranking optimizations, and content improvements.");
      const fDataSrc  = data.forecast?.methodology?.dataSource ?? "default";
      const fConfColor = fConf >= 70 ? "#38A169" : fConf >= 50 ? "#D69E2E" : "#DD6B20";
      const fDisclaimer = fDataSrc === "trend-based"
        ? "Forecast based on actual site trend data, dampened for realistic next-period projection."
        : "Limited historical data available. Using conservative default assumptions.";

      const fcBoxW = 220;
      const fcBoxH = 130;
      const fcBox1X = M;
      const fcBox2X = M + fcBoxW + 20;
      const fcBoxY  = doc.y;

      // Left: no action (red border)
      doc.roundedRect(fcBox1X, fcBoxY, fcBoxW, fcBoxH, 4).strokeColor("#E53E3E").stroke();
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#E53E3E")
        .text("If no action taken", fcBox1X + 12, fcBoxY + 12, { width: fcBoxW - 24 });
      doc.font("Helvetica").fontSize(9).fillColor(C.text)
        .text(`Projected users:  ${fNoActU.toLocaleString()} (${fNoActPct}%)`, fcBox1X + 12, fcBoxY + 30, { width: fcBoxW - 24 });
      doc.font("Helvetica").fontSize(9).fillColor(C.text)
        .text(`Projected clicks: ${fNoActC.toLocaleString()} (${fNoActPct}%)`, fcBox1X + 12, fcBoxY + 46, { width: fcBoxW - 24 });
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#E53E3E")
        .text("v  Trending down", fcBox1X + 12, fcBoxY + 62, { width: fcBoxW - 24 });
      doc.font("Helvetica").fontSize(7).fillColor(C.textMuted)
        .text(fNoActIns, fcBox1X + 12, fcBoxY + 78, { width: fcBoxW - 24 });

      // Right: with actions (green border)
      doc.roundedRect(fcBox2X, fcBoxY, fcBoxW, fcBoxH, 4).strokeColor("#38A169").stroke();
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#38A169")
        .text("If top 5 actions applied", fcBox2X + 12, fcBoxY + 12, { width: fcBoxW - 24 });
      doc.font("Helvetica").fontSize(9).fillColor(C.text)
        .text(`Projected users:  ${fWithU.toLocaleString()} (+${fWithPct}%)`, fcBox2X + 12, fcBoxY + 30, { width: fcBoxW - 24 });
      doc.font("Helvetica").fontSize(9).fillColor(C.text)
        .text(`Projected clicks: ${fWithC.toLocaleString()} (+${fWithPct}%)`, fcBox2X + 12, fcBoxY + 46, { width: fcBoxW - 24 });
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#38A169")
        .text(`+${fAddC.toLocaleString()} additional clicks`, fcBox2X + 12, fcBoxY + 62, { width: fcBoxW - 24 });
      doc.font("Helvetica").fontSize(7).fillColor(C.textMuted)
        .text(fWithIns, fcBox2X + 12, fcBoxY + 78, { width: fcBoxW - 24 });

      doc.y = fcBoxY + fcBoxH + 14;

      // Confidence badge — dynamic color and %
      ensureSpace(doc, 40);
      const badgeY = doc.y;
      doc.roundedRect(M, badgeY, 120, 16, 3).fill(fConfColor);
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#ffffff")
        .text(`${fConf}% CONFIDENCE`, M, badgeY + 3, { width: 120, align: "center" });
      doc.y = badgeY + 22;

      doc.font("Helvetica").fontSize(8).fillColor(C.textMuted)
        .text(sanitize(fDisclaimer), M + 4, doc.y, { width: CW - 8 });
      doc.y += 24;
    } catch (err: any) {
      doc.fontSize(9).fillColor("#E53E3E").text(`[Section failed to render: ${err.message}]`, M, doc.y);
      doc.y += 14;
    }

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
      const safeTitle = cleanText(title);
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(color).text(safeTitle, M + 4, doc.y);
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

    drawBulletBlock("+ Wins / Positive Signals", C.positive, positives.map(i => i.message));
    drawBulletBlock("! Risks / Problems",        C.danger,   risks.map(i => i.message));

    const recommendations = risks.map(r => {
      switch (r.category) {
        case "ctr":      return "Improve on-page titles and meta descriptions to lift CTR.";
        case "keywords": return "Prioritize page-2 keywords for quick ranking gains.";
        case "traffic":  return "Investigate traffic source decline and diversify acquisition channels.";
        case "backlinks":return "Launch a targeted outreach campaign to rebuild referring domains.";
        default:            return r.message;
      }
    });
    drawBulletBlock("* Recommendations", C.accent, recommendations);

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
      const gscSubY = doc.y;
      doc.font("Helvetica").fontSize(7).fillColor(C.textMuted)
        .text(`TOP PAGES  ·  ${hasGscData ? "SEARCH CONSOLE" : "GA4"}`, M, gscSubY, { characterSpacing: 0.5 });
      doc.y = gscSubY + 12;

      const colWidths = hasGscData
        ? [CW * 0.36, CW * 0.14, CW * 0.20, CW * 0.14, CW * 0.16]
        : [CW * 0.55, CW * 0.22, CW * 0.23];
      const headers = hasGscData
        ? ["Page", "Clicks", "Impressions", "CTR", "Position"]
        : ["Page", "Sessions", "Users"];

      doc.roundedRect(M, doc.y, CW, 18, 2).fill(C.primary);
      const hdrY = doc.y;
      let hx = M;
      for (let i = 0; i < headers.length; i++) {
        doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff")
          .text(headers[i], hx + 6, hdrY + 5, { width: colWidths[i] - 12, align: i === 0 ? "left" : "right" });
        hx += colWidths[i];
      }
      doc.y = hdrY + 18;

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
          doc.font("Helvetica").fontSize(7).fillColor(C.text).text((ga4p.sessions || 0).toLocaleString(), cx + 6, ry + 4, { width: colWidths[1] - 12, align: "right" }); cx += colWidths[1];
          doc.font("Helvetica").fontSize(7).fillColor(C.text).text((ga4p.users    || 0).toLocaleString(), cx + 6, ry + 4, { width: colWidths[2] - 12, align: "right" });
        }
        doc.y = ry + 16;
      }
      doc.y += 12;
    }

    // ── 4d. Top Pages GA4 (Extended) ──
    if (data.ga4TopPages && data.ga4TopPages.length > 0) {
      const g4Pages = data.ga4TopPages.slice(0, 10);
      ensureSpace(doc, 60 + g4Pages.length * 16);
      const g4SubY = doc.y;
      doc.font("Helvetica").fontSize(7).fillColor(C.textMuted).text("TOP PAGES (GA4 - PAGE VIEWS)", M, g4SubY, { characterSpacing: 0.5 });
      doc.y = g4SubY + 12;

      const g4Cols    = [CW * 0.30, CW * 0.13, CW * 0.12, CW * 0.12, CW * 0.16, CW * 0.17];
      const g4Headers = ["Page", "Page Views", "Users", "Sessions", "Eng. Rate", "Avg Eng. Time"];

      doc.roundedRect(M, doc.y, CW, 18, 2).fill(C.primary);
      const g4HdrY = doc.y;
      let g4Hx = M;
      for (let i = 0; i < g4Headers.length; i++) {
        doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff")
          .text(g4Headers[i], g4Hx + 5, g4HdrY + 5, { width: g4Cols[i] - 10, align: i === 0 ? "left" : "right" });
        g4Hx += g4Cols[i];
      }
      doc.y = g4HdrY + 18;

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
      const kwHdrY = doc.y;
      let kwHx = M;
      for (let i = 0; i < kwHeaders.length; i++) {
        doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff")
          .text(kwHeaders[i], kwHx + 5, kwHdrY + 5, { width: kwCols[i] - 10, align: i === 0 ? "left" : i === kwHeaders.length - 1 ? "left" : "right" });
        kwHx += kwCols[i];
      }
      doc.y = kwHdrY + 18;

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
      const blHdrY = doc.y;
      let bhx = M;
      for (let i = 0; i < blHeaders.length; i++) {
        doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff")
          .text(blHeaders[i], bhx + 6, blHdrY + 5, { width: blColWidths[i] - 12, align: i === 0 ? "left" : "right" });
        bhx += blColWidths[i];
      }
      doc.y = blHdrY + 18;
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
    const daHdrY = doc.y;
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff").text("Data Source",   M + 6,            daHdrY + 5, { width: daCols[0] - 12 });
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff").text("Status",        M + daCols[0] + 6, daHdrY + 5, { width: daCols[1] - 12, align: "right" });
    doc.y = daHdrY + 18;

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

    if (data.aiDraft) addAIGeneratedSections(doc, data.aiDraft);
    doc.end();
  });
}

// ── A10 AI-generated sections (appended after existing PDF content) ───────────
// These functions are called AFTER generatePdfReport() writes its last page.
// computedMetrics must always come from the frontend — never recomputed here.

export interface AISectionReportDraft {
  content: {
    executiveSummary?: string[];
    anomaliesSection?: {
      count?: number;
      p0Count?: number;
      p1Count?: number;
      summary?: string;
      items?: Array<{ metric?: string; severity?: string; summary?: string; rootCause?: string }>;
    };
    recommendationsSection?: {
      count?: number;
      items?: Array<{ priority?: number | null; statement?: string; effort?: string | null; impact?: string | null; ownerRole?: string | null }>;
    };
    appendix?: {
      weekNumber?: number;
      generatedAt?: string;
      sourceRunIds?: string[];
    };
  };
}

export function addAIGeneratedSections(
  doc: InstanceType<typeof PDFDocument>,
  reportDraft: AISectionReportDraft,
): void {
  const M = 40;
  const W = doc.page.width - M * 2;

  function addSectionHeading(title: string) {
    doc.addPage();
    doc
      .rect(0, 0, doc.page.width, 60)
      .fill("#0f172a");
    doc
      .fillColor("#ffffff")
      .font("Helvetica-Bold")
      .fontSize(16)
      .text(cleanText(title), M, 20, { width: W });
    doc.y = 80;
    doc.fillColor("#1e293b");
  }

  // Executive Summary
  const bullets = reportDraft.content.executiveSummary ?? [];
  if (bullets.length > 0) {
    addSectionHeading("AI Executive Summary");
    doc.fillColor("#0f172a").font("Helvetica").fontSize(10);
    for (const bullet of bullets) {
      doc
        .fillColor("#334155")
        .text("•  " + cleanText(bullet), M, doc.y, { width: W, lineGap: 4 });
      doc.moveDown(0.5);
    }
  }

  // Anomalies
  const anom = reportDraft.content.anomaliesSection;
  if (anom && (anom.count ?? 0) > 0) {
    addSectionHeading("Anomalies This Week");
    doc.fillColor("#334155").font("Helvetica").fontSize(10);
    if (anom.summary) {
      doc.text(cleanText(anom.summary), M, doc.y, { width: W, lineGap: 4 });
      doc.moveDown(0.5);
    }
    const items = anom.items ?? [];
    for (const item of items.slice(0, 8)) {
      const sev = item.severity ?? "P2";
      const sevColor = sev === "P0" ? "#dc2626" : sev === "P1" ? "#ca8a04" : "#64748b";
      doc
        .fillColor(sevColor)
        .font("Helvetica-Bold")
        .fontSize(9)
        .text(`[${sev}] ${cleanText(item.metric ?? "")}`, M, doc.y);
      if (item.summary ?? item.rootCause) {
        doc
          .fillColor("#475569")
          .font("Helvetica")
          .fontSize(9)
          .text(cleanText(item.summary ?? item.rootCause ?? ""), M + 12, doc.y, { width: W - 12, lineGap: 3 });
      }
      doc.moveDown(0.4);
    }
  }

  // Recommendations
  const recs = reportDraft.content.recommendationsSection;
  if (recs && (recs.count ?? 0) > 0) {
    addSectionHeading("This Week's Actions");
    const items = recs.items ?? [];
    for (const rec of items.slice(0, 5)) {
      const priority = rec.priority ?? "-";
      const effort = rec.effort ?? "medium";
      const impact = rec.impact ?? "medium";
      const impactColor = impact === "high" ? "#16a34a" : impact === "low" ? "#94a3b8" : "#ca8a04";

      doc
        .fillColor("#0f172a")
        .font("Helvetica-Bold")
        .fontSize(10)
        .text(`${priority}. ${cleanText(rec.statement ?? "")}`, M, doc.y, { width: W });
      doc
        .fillColor(impactColor)
        .font("Helvetica")
        .fontSize(8)
        .text(`Effort: ${effort}  |  Impact: ${impact}  |  Owner: ${cleanText(rec.ownerRole ?? "—")}`, M, doc.y, { width: W });
      doc.moveDown(0.6);
    }
  }

  // Appendix
  const app = reportDraft.content.appendix;
  if (app) {
    addSectionHeading("Appendix — Data Sources");
    doc.fillColor("#475569").font("Helvetica").fontSize(9);
    if (app.weekNumber) doc.text(`ISO Week: ${app.weekNumber}`, M, doc.y, { width: W });
    if (app.generatedAt) doc.text(`Generated: ${cleanText(app.generatedAt)}`, M, doc.y, { width: W });
    if (app.sourceRunIds?.length) {
      doc.moveDown(0.5);
      doc.text("Source agent run IDs:", M, doc.y, { width: W });
      for (const id of app.sourceRunIds) {
        doc.text(`  ${cleanText(id)}`, M, doc.y, { width: W, lineGap: 2 });
      }
    }
  }
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
