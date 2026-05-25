// A09 — Recommendation Synthesis Agent.
// Spec: specs/A09-recommendation-synthesis.md
//
// Reads this week's upstream agent findings (A08 anomalies) from the scratchpad
// plus existing GA4/GSC summary data from the DB, asks a strategy-tier model to
// synthesise 3-5 prioritised, evidence-backed recommendations as structured
// JSON, then writes them to BOTH the recommendations table (UI/report) and the
// agent_scratchpad (agent bus). Run logging / token tracking / retry come from
// BaseAgent.
//
// Model (CLAUDE.md "Model Routing" — strategy tier, overridable via env so the
// same code works against OpenAI or a gateway that proxies Claude):
//   A09_SYNTHESIS_MODEL  (default gpt-4.1; set to e.g. claude-opus-* if proxied)

import OpenAI from "openai";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { ga4DailyMetrics, gscDaily, recommendations, properties, type InsertRecommendation } from "@shared/schema";
import { BaseAgent, type AgentResult } from "./base-agent";
import { readFromScratchpad } from "../orchestrator/scratchpad";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const SYNTHESIS_MODEL = process.env.A09_SYNTHESIS_MODEL || "gpt-4.1";

// Default strategic goals (no tenant-goals config table exists yet — see spec).
const DEFAULT_GOALS = { primaryKPI: "conversions", targetKeywords: [] as string[], industry: "general" };

type Level = "low" | "medium" | "high";

interface SynthRecommendation {
  priority: number;
  statement: string;
  evidence: string;
  effort: Level;
  effort_hours: number | null;
  impact: Level;
  impact_description: string;
  owner_role: string;
  agent_run_ids: string[];
}

export class RecommendationSynthesisAgent extends BaseAgent {
  readonly agentId = "A09";
  readonly model = SYNTHESIS_MODEL;

  protected async computeInputHash(tenantId: string): Promise<string | undefined> {
    return this.sha256({ tenantId, week: getISOWeek(new Date()) });
  }

  async run(tenantId: string): Promise<AgentResult> {
    const week = getISOWeek(new Date());

    // ── Read upstream A08 anomaly findings from this week's scratchpad ─────────
    const a08Entries = await readFromScratchpad("A08", tenantId, week);
    const a08 = a08Entries[0]?.findings as { anomalies?: unknown[]; summary?: string } | undefined;
    const anomalies = a08?.anomalies ?? [];
    const sourceRunIds = a08Entries.map((e) => `A08:${e.runId ?? "unknown"}`);
    if (a08Entries.length === 0) {
      this.log(`no A08 scratchpad found for week ${week} — synthesising from GA4/GSC summary only`);
    }

    // ── Read existing GA4 + GSC summary from the DB ───────────────────────────
    const resolved = await this.resolvePropertyId(tenantId);
    const summary = resolved
      ? await this.loadSummary(resolved.propertyId)
      : { ga4: { sessions: 0, users: 0, conversions: 0, engagedSessions: 0 }, gsc: { clicks: 0, impressions: 0, ctr: 0, avgPosition: 0 } };
    if (resolved) this.log(`tenant "${tenantId}" → property ${resolved.propertyId} (${resolved.via})`);

    // ── Synthesise via the strategy-tier model ────────────────────────────────
    const recs = await this.synthesise({
      tenantId,
      week,
      industry: DEFAULT_GOALS.industry,
      anomalies,
      anomalySummary: a08?.summary ?? "",
      traffic: summary.ga4,
      gsc: summary.gsc,
      goals: DEFAULT_GOALS,
    });

    // ── Persist to recommendations table ──────────────────────────────────────
    // Extra spec fields (effort_hours, impact_description, agent_run_ids) are
    // packed into the evidence JSONB column to keep the table schema unchanged.
    const rows: InsertRecommendation[] = recs.map((rec, i) => ({
      tenantId,
      runId: this.runId,
      priority: Number(rec.priority) || i + 1,
      statement: rec.statement,
      evidence: {
        text: rec.evidence,
        effortHours: rec.effort_hours,
        impactDescription: rec.impact_description,
        agentRunIds: rec.agent_run_ids?.length ? rec.agent_run_ids : sourceRunIds,
      },
      effort: rec.effort,
      impact: rec.impact,
      ownerRole: rec.owner_role,
      status: "pending_review",
      analystEdit: null,
    }));
    if (rows.length > 0) await db.insert(recommendations).values(rows);

    // ── Write to scratchpad (agent bus) ───────────────────────────────────────
    const findings: Record<string, unknown> = {
      recommendations: recs,
      sources_read: sourceRunIds,
      deduplication_notes: `Synthesised ${recs.length} recommendations from ${sourceRunIds.length} upstream source(s) + GA4/GSC summary.`,
    };
    await this.writeScratchpad(findings);

    this.log(`generated ${recs.length} recommendations`);
    return this.result(findings);
  }

  /** Resolve tenant id → internal property UUID (mirrors A08). */
  private async resolvePropertyId(tenantId: string): Promise<{ propertyId: string; via: string } | null> {
    const [direct] = await db.select({ id: properties.id }).from(properties).where(eq(properties.id, tenantId)).limit(1);
    if (direct) return { propertyId: direct.id, via: "internal property id" };
    const [byGa4] = await db.select({ id: properties.id }).from(properties).where(eq(properties.ga4PropertyId, tenantId)).limit(1);
    if (byGa4) return { propertyId: byGa4.id, via: "GA4 property id" };
    const [richest] = await db
      .select({ propertyId: ga4DailyMetrics.propertyId, n: sql<number>`COUNT(*)` })
      .from(ga4DailyMetrics)
      .groupBy(ga4DailyMetrics.propertyId)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(1);
    if (richest?.propertyId) return { propertyId: richest.propertyId, via: "fallback: property with most GA4 data" };
    return null;
  }

  /** Aggregate GA4 + GSC totals from the existing daily tables. */
  private async loadSummary(propertyId: string) {
    const [ga4] = await db
      .select({
        sessions: sql<number>`COALESCE(SUM(${ga4DailyMetrics.sessions}), 0)`,
        users: sql<number>`COALESCE(SUM(${ga4DailyMetrics.totalUsers}), 0)`,
        conversions: sql<number>`COALESCE(SUM(${ga4DailyMetrics.conversions}), 0)`,
        engagedSessions: sql<number>`COALESCE(SUM(${ga4DailyMetrics.engagedSessions}), 0)`,
      })
      .from(ga4DailyMetrics)
      .where(eq(ga4DailyMetrics.propertyId, propertyId));

    const [gsc] = await db
      .select({
        clicks: sql<number>`COALESCE(SUM(${gscDaily.clicks}), 0)`,
        impressions: sql<number>`COALESCE(SUM(${gscDaily.impressions}), 0)`,
        ctr: sql<number>`CASE WHEN SUM(${gscDaily.impressions}) > 0 THEN SUM(${gscDaily.clicks})::numeric / SUM(${gscDaily.impressions}) * 100 ELSE 0 END`,
        avgPosition: sql<number>`COALESCE(AVG(${gscDaily.avgPosition}), 0)`,
      })
      .from(gscDaily)
      .where(eq(gscDaily.propertyId, propertyId));

    return {
      ga4: {
        sessions: Number(ga4?.sessions ?? 0),
        users: Number(ga4?.users ?? 0),
        conversions: Number(ga4?.conversions ?? 0),
        engagedSessions: Number(ga4?.engagedSessions ?? 0),
      },
      gsc: {
        clicks: Number(gsc?.clicks ?? 0),
        impressions: Number(gsc?.impressions ?? 0),
        ctr: Number(gsc?.ctr ?? 0),
        avgPosition: Number(gsc?.avgPosition ?? 0),
      },
    };
  }

  /** Call the model and parse the structured recommendation JSON. */
  private async synthesise(input: {
    tenantId: string;
    week: number;
    industry: string;
    anomalies: unknown[];
    anomalySummary: string;
    traffic: unknown;
    gsc: unknown;
    goals: unknown;
  }): Promise<SynthRecommendation[]> {
    const system =
      `You are a senior SEO strategist analyzing data for a ${input.industry} client. ` +
      "Produce actionable recommendations based on evidence. Be specific, not generic. " +
      "Always cite which data point supports each recommendation.";

    const user =
      `This week's findings (ISO week ${input.week}):\n\n` +
      `ANOMALIES DETECTED:\n${JSON.stringify({ summary: input.anomalySummary, anomalies: input.anomalies })}\n\n` +
      `KEYWORD MOVEMENT / GSC DATA:\n${JSON.stringify(input.gsc)}\n\n` +
      `TRAFFIC DATA (GA4):\n${JSON.stringify(input.traffic)}\n\n` +
      `CLIENT GOALS: ${JSON.stringify(input.goals)}\n\n` +
      `Produce 3-5 recommendations in this exact JSON format:\n` +
      `{"recommendations":[{"priority":1,"statement":"one clear action sentence",` +
      `"evidence":"specific data point that supports this","effort":"low|medium|high","effort_hours":number,` +
      `"impact":"low|medium|high","impact_description":"what will improve and by how much",` +
      `"owner_role":"technical|content|strategy","agent_run_ids":["A08-xxx"]}]}\n` +
      `Return ONLY valid JSON. No preamble.`;

    let raw = "";
    try {
      const resp = await openai.chat.completions.create({
        model: SYNTHESIS_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      this.trackTokens(resp.usage?.prompt_tokens ?? 0, resp.usage?.completion_tokens ?? 0);
      raw = resp.choices[0]?.message?.content ?? "";
    } catch (err) {
      this.logError(`synthesis model failed: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }

    const parsed = parseJsonObject(raw);
    const list = Array.isArray(parsed?.recommendations) ? parsed!.recommendations : [];
    return list
      .slice(0, 5) // spec: 3-5 recommendations
      .map((r, i) => normaliseRecommendation(r as Record<string, unknown>, i))
      .filter((r) => r.statement.length > 0);
  }
}

/** Convenience entry for routes / cron: runs with full logging + retry. */
export function runRecommendationSynthesis(tenantId: string): Promise<AgentResult> {
  return new RecommendationSynthesisAgent().execute(tenantId);
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function normaliseRecommendation(r: Record<string, unknown>, index: number): SynthRecommendation {
  return {
    priority: Number(r.priority) || index + 1,
    statement: String(r.statement ?? "").trim(),
    evidence: String(r.evidence ?? "").trim(),
    effort: normaliseLevel(r.effort),
    effort_hours: r.effort_hours != null && !Number.isNaN(Number(r.effort_hours)) ? Number(r.effort_hours) : null,
    impact: normaliseLevel(r.impact),
    impact_description: String(r.impact_description ?? "").trim(),
    owner_role: normaliseOwner(r.owner_role),
    agent_run_ids: Array.isArray(r.agent_run_ids) ? r.agent_run_ids.map(String) : [],
  };
}

function normaliseLevel(v: unknown): Level {
  const s = String(v ?? "").toLowerCase();
  return s === "low" || s === "high" ? s : "medium";
}

function normaliseOwner(v: unknown): string {
  const s = String(v ?? "").toLowerCase();
  return s === "technical" || s === "content" || s === "strategy" ? s : "strategy";
}

/** Tolerant JSON parse: strips code fences and falls back to the outermost braces. */
function parseJsonObject(text: string): { recommendations?: unknown[] } | null {
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

/** ISO-8601 week number (matches Postgres EXTRACT(WEEK ...)). */
function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
