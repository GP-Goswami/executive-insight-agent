// Monthly Strategic Report builder (PDF spec — monthly variant). Produces:
//   1. Executive narrative (GPT-4.1 authored prose)
//   2. MoM + YoY for all KPIs
//   3. Content portfolio health
//   4. Technical SEO health-score trend
//   5. 30-day strategic roadmap (GPT-4.1 authored)
//   6. Appendix with agent run IDs
//
// Runs as agent A14 (monthly composition) via BaseAgent — logged to agent_runs,
// persisted to report_drafts (reportType "monthly"). YoY degrades to "insufficient
// history" when no data exists a year back.

import OpenAI from "openai";
import { db } from "../../db";
import { reportDrafts, type InsertReportDraft } from "@shared/schema";
import { BaseAgent, type AgentResult } from "../../agents/base-agent";
import {
  resolveProperty,
  loadContentHighlights,
  computeTechnicalHealth,
  loadRecommendations,
  loadAgentRunIds,
  type PeriodRange,
  type MetricDelta,
  type ContentRow,
  type RecommendationRow,
  type ResolvedProperty,
} from "../shared/report-data";
import { liveSnapshot, withGscOverride } from "../shared/live-snapshot";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const MONTHLY_MODEL = process.env.MONTHLY_REPORT_MODEL || "gpt-4.1";

export interface KpiMoMYoY {
  key: string;
  label: string;
  current: number;
  unit: "num" | "pct" | "position";
  mom: MetricDelta;
  yoy: MetricDelta;
  yoyAvailable: boolean;
}

export interface ContentPortfolio {
  topPages: ContentRow[];
  totalPages: number;
  concentrationPct: number; // share of users held by the single top page
  signals: Array<{ label: string; value: string; status: "good" | "warn" | "bad" }>;
}

export interface HealthTrendPoint {
  period: string; // yyyy-MM-dd (window end)
  label: string;
  score: number;
  status: string;
}

export interface RoadmapItem {
  timeframe: string;
  focus: string;
  actions: string[];
}

export interface MonthlyReportContent {
  meta: {
    reportType: "monthly";
    domain: string;
    propertyName: string;
    tenantId: string;
    current: PeriodRange;
    previous: PeriodRange;
    yearAgo: PeriodRange;
    generatedAt: string;
    runId: string | null;
  };
  executiveNarrative: string[];
  kpis: KpiMoMYoY[];
  contentPortfolio: ContentPortfolio;
  technicalHealthTrend: HealthTrendPoint[];
  roadmap: RoadmapItem[];
  appendix: {
    agentRuns: Array<{ agentId: string; runId: string; status: string; startedAt: string | null }>;
    sourceRunId: string | null;
    generatedAt: string;
  };
}

/** Optional explicit "current" window for the report. When omitted the report
 *  anchors on the latest available data date (last 30 days). */
export interface MonthlyRunOpts {
  start?: string; // yyyy-MM-dd (inclusive)
  end?: string;   // yyyy-MM-dd (inclusive)
  gscSiteUrl?: string; // override when the property record has no GSC site URL
}

export class MonthlyReportAgent extends BaseAgent {
  readonly agentId = "A14";
  readonly model = MONTHLY_MODEL;

  /** Set before execute() to report on a specific date range instead of the default. */
  runOpts?: MonthlyRunOpts;

  protected async computeInputHash(tenantId: string): Promise<string | undefined> {
    const range = this.runOpts?.start && this.runOpts?.end
      ? `${this.runOpts.start}_${this.runOpts.end}`
      : new Date().toISOString().slice(0, 7);
    return this.sha256({ tenantId, kind: "monthly", range });
  }

  async run(tenantId: string): Promise<AgentResult> {
    const prop = await resolveProperty(tenantId);
    if (!prop) {
      const empty = { error: `No property found for tenant "${tenantId}".` };
      await this.writeScratchpad(empty);
      return this.result(empty);
    }

    const content = await this.assemble(prop, tenantId, this.runOpts);

    const row: InsertReportDraft = {
      tenantId,
      reportType: "monthly",
      weekNumber: null,
      content: content as unknown as Record<string, unknown>,
      status: "pending_analyst",
      pdfUrl: null,
      analystNotes: null,
      approvedAt: null,
    };
    const [inserted] = await db.insert(reportDrafts).values(row).returning({ id: reportDrafts.id });
    content.meta.runId = this.runId;

    await this.writeScratchpad({ reportDraftId: inserted.id, reportType: "monthly" });
    this.log(`monthly report draft ${inserted.id} created`);
    return this.result({ reportDraftId: inserted.id, reportType: "monthly", content });
  }

  async assemble(prop: ResolvedProperty, tenantId: string, opts?: MonthlyRunOpts): Promise<MonthlyReportContent> {
    // Anchor the report on an explicit range when provided, else the latest data date.
    let current: PeriodRange, previous: PeriodRange, yearAgo: PeriodRange, anchorEnd: Date;
    if (opts?.start && opts?.end) {
      ({ current, previous, yearAgo } = buildPeriodsFromRange(opts.start, opts.end));
      anchorEnd = new Date(`${opts.end}T00:00:00.000Z`);
    } else {
      // Default = the last COMPLETE calendar month. Run on the 1st of a month and
      // you get the previous month's report (e.g. in June → May 1–31), with MoM
      // comparing against the month before (April).
      ({ current, previous, yearAgo } = buildLastCalendarMonthPeriods());
      anchorEnd = new Date(`${current.end}T00:00:00.000Z`);
    }

    // Use the caller-supplied GSC site URL when the stored property has none —
    // this is what makes the search KPIs populate (the property record is often
    // missing gscSiteUrl even though the dashboard knows it).
    const effectiveProp = withGscOverride(prop, opts?.gscSiteUrl);
    this.log(`monthly assemble: ga4=${effectiveProp.ga4PropertyId || "none"}, gsc=${effectiveProp.gscSiteUrl || "NONE — search KPIs will be 0"}, period ${current.start}..${current.end}`);

    // MoM and YoY snapshots (current is shared; comparison differs).
    // Uses live GA4/GSC so search KPIs are real even when the daily tables are unsynced.
    const [mom, yoy, topPages, actions, agentRuns, healthTrend] = await Promise.all([
      liveSnapshot(effectiveProp, current, previous),
      liveSnapshot(effectiveProp, current, yearAgo),
      loadContentHighlights(effectiveProp, current, 12),
      loadRecommendations(tenantId, 8),
      loadAgentRunIds(tenantId, 40),
      this.buildHealthTrend(effectiveProp, anchorEnd),
    ]);

    const yoyAvailable = yoy.users.previous > 0 || yoy.clicks.previous > 0 || yoy.impressions.previous > 0;

    const kpis: KpiMoMYoY[] = [
      kpi("users", "Users", "num", mom.users, yoy.users, yoyAvailable),
      kpi("sessions", "Sessions", "num", mom.sessions, yoy.sessions, yoyAvailable),
      kpi("conversions", "Conversions", "num", mom.conversions, yoy.conversions, yoyAvailable),
      kpi("engagedSessions", "Engaged Sessions", "num", mom.engagedSessions, yoy.engagedSessions, yoyAvailable),
      kpi("clicks", "Search Clicks", "num", mom.clicks, yoy.clicks, yoyAvailable),
      kpi("impressions", "Impressions", "num", mom.impressions, yoy.impressions, yoyAvailable),
      kpi("ctr", "CTR", "pct", mom.ctr, yoy.ctr, yoyAvailable),
      kpi("avgPosition", "Avg Position", "position", mom.avgPosition, yoy.avgPosition, yoyAvailable),
    ];

    const contentPortfolio = buildContentPortfolio(topPages);
    const executiveNarrative = await this.generateNarrative({ domain: prop.name, current, kpis, yoyAvailable, topPages, health: healthTrend[healthTrend.length - 1] });
    const roadmap = await this.generateRoadmap({ domain: prop.name, kpis, actions, contentPortfolio });

    return {
      meta: {
        reportType: "monthly",
        domain: prop.name,
        propertyName: prop.name,
        tenantId,
        current,
        previous,
        yearAgo,
        generatedAt: new Date().toISOString(),
        runId: this.runId,
      },
      executiveNarrative,
      kpis,
      contentPortfolio,
      technicalHealthTrend: healthTrend,
      roadmap,
      appendix: {
        agentRuns,
        sourceRunId: this.runId,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  /** Technical health score across the current report month and the two
   *  preceding calendar months (e.g. May → April → March). */
  private async buildHealthTrend(prop: ResolvedProperty, currentMonthEnd: Date): Promise<HealthTrendPoint[]> {
    const points: HealthTrendPoint[] = [];
    const baseY = currentMonthEnd.getUTCFullYear();
    const baseM = currentMonthEnd.getUTCMonth(); // month of the current report period
    for (let i = 2; i >= 0; i--) {
      // i calendar months before the current report month.
      const monthStart = new Date(Date.UTC(baseY, baseM - i, 1));
      const monthEnd = new Date(Date.UTC(baseY, baseM - i + 1, 0)); // last day of that month
      const period: PeriodRange = {
        start: monthStart.toISOString().slice(0, 10),
        end: monthEnd.toISOString().slice(0, 10),
        label: i === 0 ? "This month" : `${i} month(s) ago`,
      };
      const snap = await liveSnapshot(prop, period, period);
      const health = computeTechnicalHealth(snap);
      points.push({ period: period.end, label: period.label, score: health.score, status: health.status });
    }
    return points;
  }

  private async generateNarrative(input: {
    domain: string;
    current: PeriodRange;
    kpis: KpiMoMYoY[];
    yoyAvailable: boolean;
    topPages: ContentRow[];
    health?: HealthTrendPoint;
  }): Promise<string[]> {
    const kpiLines = input.kpis
      .map((k) => `${k.label}: ${k.current}${k.unit === "pct" ? "%" : ""} (MoM ${deltaText(k.mom.deltaPct)}${input.yoyAvailable ? `, YoY ${deltaText(k.yoy.deltaPct)}` : ""})`)
      .join("\n");
    const system =
      "You are a senior SEO strategist writing the executive narrative that opens a monthly client report. " +
      "Write 3-4 tight paragraphs of strategic prose (not bullets). Reference specific numbers and the story they tell — " +
      "momentum, risks, and what it means for the business. Confident, no filler, no generic advice.";
    const user =
      `Domain: ${input.domain}\nPeriod: ${input.current.start} to ${input.current.end}\n\n` +
      `KPIs (month-over-month${input.yoyAvailable ? " and year-over-year" : "; YoY not yet available — first year of data"}):\n${kpiLines}\n\n` +
      (input.health ? `Technical health score: ${input.health.score}/100 (${input.health.status}).\n` : "") +
      (input.topPages[0] ? `Top content: ${input.topPages[0].page} (${input.topPages[0].users} users).\n` : "") +
      `\nReturn ONLY a JSON array of 3-4 paragraph strings. No markdown, no preamble.`;
    try {
      const resp = await openai.chat.completions.create({
        model: MONTHLY_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      this.trackTokens(resp.usage?.prompt_tokens ?? 0, resp.usage?.completion_tokens ?? 0);
      const parsed = parseJsonArray(resp.choices[0]?.message?.content ?? "[]");
      if (parsed.length >= 2) return parsed.slice(0, 5);
    } catch (err) {
      this.logError(`narrative failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return [
      `Over ${input.current.start} to ${input.current.end}, ${input.domain} recorded ${input.kpis[0].current.toLocaleString()} users and ${input.kpis[4].current.toLocaleString()} search clicks.`,
      `Month-over-month, search clicks moved ${deltaText(input.kpis[4].mom.deltaPct)} while CTR sits at ${input.kpis[6].current}%.`,
      input.health ? `Technical health is ${input.health.score}/100 (${input.health.status}); see the roadmap for prioritised remediation.` : `See the roadmap for prioritised next steps.`,
    ];
  }

  private async generateRoadmap(input: {
    domain: string;
    kpis: KpiMoMYoY[];
    actions: RecommendationRow[];
    contentPortfolio: ContentPortfolio;
  }): Promise<RoadmapItem[]> {
    const system =
      "You are an SEO strategy lead building a 30-day execution roadmap for the next month. " +
      "Produce 4 sequential timeframes (Week 1 through Week 4). Each has a clear focus and 2-3 concrete actions. " +
      "Ground actions in the provided data and existing recommendations. Be specific.";
    const user =
      `Domain: ${input.domain}\n` +
      `KPI movement (MoM): ${input.kpis.map((k) => `${k.label} ${deltaText(k.mom.deltaPct)}`).join(", ")}\n` +
      `Existing recommendations: ${input.actions.map((a) => a.statement).join(" | ") || "none"}\n` +
      `Content concentration: top page holds ${input.contentPortfolio.concentrationPct}% of users across ${input.contentPortfolio.totalPages} tracked pages.\n\n` +
      `Return ONLY JSON: {"roadmap":[{"timeframe":"Week 1","focus":"...","actions":["...","..."]}]} with exactly 4 items.`;
    try {
      const resp = await openai.chat.completions.create({
        model: MONTHLY_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      this.trackTokens(resp.usage?.prompt_tokens ?? 0, resp.usage?.completion_tokens ?? 0);
      const parsed = parseJsonObject(resp.choices[0]?.message?.content ?? "{}");
      const list = Array.isArray(parsed?.roadmap) ? parsed!.roadmap : [];
      const items = list
        .map((r) => ({
          timeframe: String((r as RoadmapItem).timeframe ?? "").trim(),
          focus: String((r as RoadmapItem).focus ?? "").trim(),
          actions: Array.isArray((r as RoadmapItem).actions) ? (r as RoadmapItem).actions.map(String).filter(Boolean) : [],
        }))
        .filter((r) => r.timeframe && r.focus);
      if (items.length >= 2) return items.slice(0, 4);
    } catch (err) {
      this.logError(`roadmap failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    // Fallback: derive from existing recommendations.
    const fallback: RoadmapItem[] = [];
    const chunks = chunk(input.actions, 2);
    chunks.slice(0, 4).forEach((group, i) => {
      fallback.push({
        timeframe: `Week ${i + 1}`,
        focus: group[0]?.statement.slice(0, 60) ?? "Maintain momentum",
        actions: group.map((a) => a.statement),
      });
    });
    return fallback.length ? fallback : [{ timeframe: "Week 1", focus: "Establish baseline", actions: ["Run anomaly detection and recommendation synthesis to seed next month's actions."] }];
  }
}

export function runMonthlyReport(tenantId: string, opts?: MonthlyRunOpts): Promise<AgentResult> {
  const agent = new MonthlyReportAgent();
  agent.runOpts = opts;
  return agent.execute(tenantId);
}

// ── helpers ───────────────────────────────────────────────────────────────────

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(d: Date): string {
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Build windows for the last COMPLETE calendar month (current = previous month),
 *  with previous = the month before it and yearAgo = the same month last year. */
function buildLastCalendarMonthPeriods(): { current: PeriodRange; previous: PeriodRange; yearAgo: PeriodRange } {
  const toYmd = (d: Date) => d.toISOString().slice(0, 10);
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // current month index

  // current = previous calendar month
  const curStart = new Date(Date.UTC(y, m - 1, 1));
  const curEnd = new Date(Date.UTC(y, m, 0)); // last day of previous month
  // previous = the month before current
  const prevStart = new Date(Date.UTC(y, m - 2, 1));
  const prevEnd = new Date(Date.UTC(y, m - 1, 0));
  // year-ago = same month, previous year
  const yaStart = new Date(Date.UTC(y - 1, m - 1, 1));
  const yaEnd = new Date(Date.UTC(y - 1, m, 0));

  return {
    current: { start: toYmd(curStart), end: toYmd(curEnd), label: monthLabel(curStart) },
    previous: { start: toYmd(prevStart), end: toYmd(prevEnd), label: monthLabel(prevStart) },
    yearAgo: { start: toYmd(yaStart), end: toYmd(yaEnd), label: monthLabel(yaStart) },
  };
}

/** Build current/previous/year-ago windows from an explicit inclusive date range.
 *  Previous = the equal-length window immediately before current; year-ago = current shifted -365d. */
function buildPeriodsFromRange(start: string, end: string): { current: PeriodRange; previous: PeriodRange; yearAgo: PeriodRange } {
  const toYmd = (d: Date) => d.toISOString().slice(0, 10);
  const shift = (s: string, days: number) => {
    const d = new Date(`${s}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return toYmd(d);
  };
  const s = new Date(`${start}T00:00:00.000Z`);
  const e = new Date(`${end}T00:00:00.000Z`);
  const lenDays = Math.max(0, Math.round((e.getTime() - s.getTime()) / 86_400_000)); // inclusive span - 1

  const prevEnd = shift(start, -1);
  const prevStart = shift(prevEnd, -lenDays);
  const yaStart = shift(start, -365);
  const yaEnd = shift(end, -365);

  return {
    current: { start, end, label: "Selected period" },
    previous: { start: prevStart, end: prevEnd, label: "Previous period" },
    yearAgo: { start: yaStart, end: yaEnd, label: "Same period last year" },
  };
}

function kpi(key: string, label: string, unit: KpiMoMYoY["unit"], mom: MetricDelta, yoy: MetricDelta, yoyAvailable: boolean): KpiMoMYoY {
  return { key, label, unit, current: mom.current, mom, yoy, yoyAvailable };
}

function buildContentPortfolio(topPages: ContentRow[]): ContentPortfolio {
  const totalUsers = topPages.reduce((s, p) => s + p.users, 0);
  const concentrationPct = totalUsers > 0 ? Math.round((topPages[0]?.users ?? 0) / totalUsers * 100) : 0;
  const withConversions = topPages.filter((p) => p.conversions > 0).length;
  const signals: ContentPortfolio["signals"] = [];

  if (concentrationPct >= 60) signals.push({ label: "Traffic concentration", value: `${concentrationPct}% on one page`, status: "bad" });
  else if (concentrationPct >= 40) signals.push({ label: "Traffic concentration", value: `${concentrationPct}% on top page`, status: "warn" });
  else signals.push({ label: "Traffic concentration", value: `${concentrationPct}% on top page`, status: "good" });

  const convShare = topPages.length ? Math.round((withConversions / topPages.length) * 100) : 0;
  signals.push({
    label: "Pages driving conversions",
    value: `${withConversions}/${topPages.length} (${convShare}%)`,
    status: convShare >= 50 ? "good" : convShare >= 25 ? "warn" : "bad",
  });

  signals.push({ label: "Tracked top pages", value: String(topPages.length), status: topPages.length >= 8 ? "good" : "warn" });

  return { topPages, totalPages: topPages.length, concentrationPct, signals };
}

function deltaText(pct: number | null): string {
  if (pct === null) return "n/a";
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function parseJsonArray(text: string): string[] {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start >= 0 && end > start) {
      try {
        const arr = JSON.parse(cleaned.slice(start, end + 1));
        if (Array.isArray(arr)) return arr.map(String).filter(Boolean);
      } catch {
        /* ignore */
      }
    }
  }
  return [];
}

function parseJsonObject(text: string): { roadmap?: unknown[] } | null {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}
