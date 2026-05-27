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
  getMaxDataDate,
  buildMonthlyPeriods,
  loadTrafficSnapshot,
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

export class MonthlyReportAgent extends BaseAgent {
  readonly agentId = "A14";
  readonly model = MONTHLY_MODEL;

  protected async computeInputHash(tenantId: string): Promise<string | undefined> {
    return this.sha256({ tenantId, kind: "monthly", month: new Date().toISOString().slice(0, 7) });
  }

  async run(tenantId: string): Promise<AgentResult> {
    const prop = await resolveProperty(tenantId);
    if (!prop) {
      const empty = { error: `No property found for tenant "${tenantId}".` };
      await this.writeScratchpad(empty);
      return this.result(empty);
    }

    const content = await this.assemble(prop, tenantId);

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

  async assemble(prop: ResolvedProperty, tenantId: string): Promise<MonthlyReportContent> {
    const maxDate = await getMaxDataDate(prop.propertyId);
    const { current, previous, yearAgo } = buildMonthlyPeriods(maxDate);

    // MoM and YoY snapshots (current is shared; comparison differs).
    const [mom, yoy, topPages, actions, agentRuns, healthTrend] = await Promise.all([
      loadTrafficSnapshot(prop.propertyId, current, previous),
      loadTrafficSnapshot(prop.propertyId, current, yearAgo),
      loadContentHighlights(prop, current, 12),
      loadRecommendations(tenantId, 8),
      loadAgentRunIds(tenantId, 40),
      this.buildHealthTrend(prop.propertyId, maxDate),
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

  /** Technical health score across the three trailing 30-day windows. */
  private async buildHealthTrend(propertyId: string, maxDate: Date): Promise<HealthTrendPoint[]> {
    const points: HealthTrendPoint[] = [];
    for (let i = 2; i >= 0; i--) {
      const end = new Date(maxDate);
      end.setDate(end.getDate() - 30 * i);
      const start = new Date(end);
      start.setDate(start.getDate() - 29);
      const period: PeriodRange = {
        start: start.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10),
        label: i === 0 ? "This month" : `${i} month(s) ago`,
      };
      const snap = await loadTrafficSnapshot(propertyId, period, period);
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

export function runMonthlyReport(tenantId: string): Promise<AgentResult> {
  return new MonthlyReportAgent().execute(tenantId);
}

// ── helpers ───────────────────────────────────────────────────────────────────

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
