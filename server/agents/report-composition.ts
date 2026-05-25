// A10 — Report Composition Agent.
// Reads A08 + A09 scratchpads and existing GA4/GSC DB summary, calls the
// strategy-tier model for executive summary bullets only, then assembles a
// full report_drafts row and writes findings back to the scratchpad.
//
// Model (overridable via env — matches CLAUDE.md "Model Routing"):
//   A10_COMPOSITION_MODEL (default gpt-4.1; strategy tier)

import OpenAI from "openai";
import { eq, desc, sql } from "drizzle-orm";
import { db } from "../db";
import {
  ga4DailyMetrics,
  gscDaily,
  recommendations,
  reportDrafts,
  properties,
  type InsertReportDraft,
} from "@shared/schema";
import { BaseAgent, type AgentResult } from "./base-agent";
import { readFromScratchpad, getAllScratchpadsForWeek } from "../orchestrator/scratchpad";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const COMPOSITION_MODEL = process.env.A10_COMPOSITION_MODEL || "gpt-4.1";

export class ReportCompositionAgent extends BaseAgent {
  readonly agentId = "A10";
  readonly model = COMPOSITION_MODEL;

  protected async computeInputHash(tenantId: string): Promise<string | undefined> {
    return this.sha256({ tenantId, week: getISOWeek(new Date()) });
  }

  async run(tenantId: string): Promise<AgentResult> {
    const week = getISOWeek(new Date());

    // ── Read upstream scratchpads ─────────────────────────────────────────────
    const a08Entries = await readFromScratchpad("A08", tenantId, week);
    const a09Entries = await readFromScratchpad("A09", tenantId, week);

    const a08 = a08Entries[0]?.findings as {
      anomalies?: Array<{ metric: string; severity: string; summary?: string; rootCause?: string }>;
      summary?: string;
    } | undefined;

    const a09 = a09Entries[0]?.findings as {
      recommendations?: Array<{ priority: number; statement: string; effort: string; impact: string }>;
    } | undefined;

    const anomalies = (a08?.anomalies ?? []) as Array<{ metric: string; severity: string; summary?: string; rootCause?: string }>;
    const a09Recs = (a09?.recommendations ?? []) as Array<{ priority: number; statement: string; effort: string; impact: string }>;

    // Read approved recommendations from the DB (most recent A09 run)
    const approvedRecs = await this.loadApprovedRecommendations(tenantId);

    // ── Load GA4 + GSC summary ────────────────────────────────────────────────
    const resolved = await this.resolvePropertyId(tenantId);
    const summary = resolved
      ? await this.loadSummary(resolved.propertyId)
      : { ga4: { sessions: 0, users: 0, conversions: 0, engagedSessions: 0 }, gsc: { clicks: 0, impressions: 0, ctr: 0, avgPosition: 0 } };

    // ── Generate executive summary via model ──────────────────────────────────
    const topAnomaly = anomalies.find((a) => a.severity === "P0") ?? anomalies[0];
    const topRec = approvedRecs[0] ?? a09Recs[0];
    const execSummary = await this.generateExecutiveSummary({
      sessions: summary.ga4.sessions,
      users: summary.ga4.users,
      conversions: summary.ga4.conversions,
      topAnomaly: topAnomaly
        ? `${topAnomaly.metric} anomaly (${topAnomaly.severity}): ${topAnomaly.summary ?? topAnomaly.rootCause ?? ""}`
        : "No anomalies detected",
      topRecommendation: topRec
        ? typeof topRec === "object" && "statement" in topRec
          ? String((topRec as { statement: string }).statement)
          : String(topRec)
        : "No recommendations yet",
      week,
    });

    // ── Assemble full report content ──────────────────────────────────────────
    const sourceRunIds = [
      ...a08Entries.map((e) => `A08:${e.runId ?? "unknown"}`),
      ...a09Entries.map((e) => `A09:${e.runId ?? "unknown"}`),
    ];

    const reportContent = {
      executiveSummary: execSummary,
      trafficSnapshot: {
        sessions: summary.ga4.sessions,
        users: summary.ga4.users,
        conversions: summary.ga4.conversions,
        engagedSessions: summary.ga4.engagedSessions,
      },
      searchSnapshot: {
        clicks: summary.gsc.clicks,
        impressions: summary.gsc.impressions,
        ctr: summary.gsc.ctr,
        avgPosition: summary.gsc.avgPosition,
      },
      anomaliesSection: {
        count: anomalies.length,
        p0Count: anomalies.filter((a) => a.severity === "P0").length,
        p1Count: anomalies.filter((a) => a.severity === "P1").length,
        items: anomalies.slice(0, 10),
        summary: a08?.summary ?? "",
      },
      recommendationsSection: {
        count: approvedRecs.length,
        items: approvedRecs.slice(0, 5),
      },
      appendix: {
        weekNumber: week,
        generatedAt: new Date().toISOString(),
        sourceRunIds,
        agentVersion: "A10-v1",
      },
    };

    // ── Persist to report_drafts ──────────────────────────────────────────────
    const row: InsertReportDraft = {
      tenantId,
      reportType: "weekly",
      weekNumber: week,
      content: reportContent,
      status: "pending_analyst",
      pdfUrl: null,
      analystNotes: null,
      approvedAt: null,
    };
    const [inserted] = await db.insert(reportDrafts).values(row).returning({ id: reportDrafts.id });

    // ── Write to scratchpad ───────────────────────────────────────────────────
    const findings: Record<string, unknown> = {
      executiveSummary: execSummary,
      reportDraftId: inserted.id,
      weekNumber: week,
      sourceRunIds,
    };
    await this.writeScratchpad(findings);

    this.log(`report draft ${inserted.id} created for week ${week}`);
    return this.result(findings);
  }

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
    if (richest?.propertyId) return { propertyId: richest.propertyId, via: "fallback: richest GA4 data" };
    return null;
  }

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

  private async loadApprovedRecommendations(tenantId: string) {
    return db
      .select()
      .from(recommendations)
      .where(eq(recommendations.tenantId, tenantId))
      .orderBy(recommendations.priority)
      .limit(5);
  }

  private async generateExecutiveSummary(input: {
    sessions: number;
    users: number;
    conversions: number;
    topAnomaly: string;
    topRecommendation: string;
    week: number;
  }): Promise<string[]> {
    const system =
      "You are writing a professional SEO weekly report. " +
      "Write in clear, confident business language. Be specific with numbers. No generic advice. " +
      "Format: exactly 4-5 bullet points.";

    const user =
      `Write executive summary bullets for week ${input.week}:\n\n` +
      `Traffic: ${input.sessions} sessions, ${input.users} users, ${input.conversions} conversions\n` +
      `Top anomaly: ${input.topAnomaly}\n` +
      `Key action: ${input.topRecommendation}\n\n` +
      `Return ONLY a JSON array of bullet strings. Each bullet max 20 words. No preamble.\n` +
      `Example: ["Traffic reached X sessions this week.", "..."]\n` +
      `Return ONLY valid JSON array.`;

    let raw = "";
    try {
      const resp = await openai.chat.completions.create({
        model: COMPOSITION_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      this.trackTokens(resp.usage?.prompt_tokens ?? 0, resp.usage?.completion_tokens ?? 0);
      raw = resp.choices[0]?.message?.content ?? "[]";
    } catch (err) {
      this.logError(`exec summary model failed: ${err instanceof Error ? err.message : String(err)}`);
      return [
        `Week ${input.week}: ${input.sessions.toLocaleString()} sessions recorded.`,
        `Key anomaly: ${input.topAnomaly}`,
        `Priority action: ${input.topRecommendation}`,
      ];
    }

    const parsed = parseJsonArray(raw);
    if (parsed.length >= 3) return parsed.slice(0, 5);

    // Fallback: structured bullets from data
    return [
      `Week ${input.week}: ${input.sessions.toLocaleString()} sessions and ${input.users.toLocaleString()} users recorded.`,
      `Conversions this period: ${input.conversions}.`,
      `Anomaly detected: ${input.topAnomaly}`,
      `Top priority action: ${input.topRecommendation}`,
    ];
  }
}

export function runReportComposition(tenantId: string): Promise<AgentResult> {
  return new ReportCompositionAgent().execute(tenantId);
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

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
        // fall through
      }
    }
  }
  return [];
}

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
