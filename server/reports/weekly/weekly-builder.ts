// Weekly Report builder (PDF spec §10). Produces an 8-section weekly report:
//   1. Executive Summary (GPT-4.1 authored)
//   2. Traffic Snapshot with WoW deltas
//   3. Ranking Movement (GSC data)
//   4. Technical Health (basic)
//   5. Content Highlights (GA4 page data)
//   6. Backlink Summary (placeholder when provider unconfigured)
//   7. AEO Snapshot (AI-assistant referrals; placeholder when none)
//   8. This Week's Actions (A09 recommendations)
//
// Runs as agent A10 (report composition) via BaseAgent so each build is logged to
// agent_runs and the result is persisted to report_drafts (reportType "weekly").

import OpenAI from "openai";
import { db } from "../../db";
import { reportDrafts, type InsertReportDraft } from "@shared/schema";
import { BaseAgent, type AgentResult } from "../../agents/base-agent";
import {
  resolveProperty,
  getMaxDataDate,
  buildWeeklyPeriods,
  loadTrafficSnapshot,
  loadDailySeries,
  loadRankingMovement,
  loadContentHighlights,
  loadBacklinkSummary,
  loadAeoSnapshot,
  computeTechnicalHealth,
  loadRecommendations,
  type PeriodRange,
  type TrafficSnapshot,
  type DailyPoint,
  type RankingMovementRow,
  type ContentRow,
  type BacklinkSummary,
  type AeoSnapshot,
  type TechnicalHealth,
  type RecommendationRow,
  type ResolvedProperty,
} from "../shared/report-data";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const WEEKLY_MODEL = process.env.WEEKLY_REPORT_MODEL || "gpt-4.1";

export interface WeeklyReportContent {
  meta: {
    reportType: "weekly";
    domain: string;
    propertyName: string;
    tenantId: string;
    weekNumber: number;
    current: PeriodRange;
    previous: PeriodRange;
    generatedAt: string;
    runId: string | null;
  };
  executiveSummary: string[];
  trafficSnapshot: TrafficSnapshot;
  dailySeries: DailyPoint[];
  rankingMovement: RankingMovementRow[];
  technicalHealth: TechnicalHealth;
  contentHighlights: ContentRow[];
  backlinks: BacklinkSummary;
  aeo: AeoSnapshot;
  actions: RecommendationRow[];
}

export class WeeklyReportAgent extends BaseAgent {
  readonly agentId = "A10";
  readonly model = WEEKLY_MODEL;

  protected async computeInputHash(tenantId: string): Promise<string | undefined> {
    return this.sha256({ tenantId, kind: "weekly", day: new Date().toISOString().slice(0, 10) });
  }

  async run(tenantId: string): Promise<AgentResult> {
    const prop = await resolveProperty(tenantId);
    if (!prop) {
      const empty = { error: `No property found for tenant "${tenantId}".` };
      await this.writeScratchpad(empty);
      return this.result(empty);
    }

    const content = await this.assemble(prop, tenantId);

    // Persist to report_drafts.
    const row: InsertReportDraft = {
      tenantId,
      reportType: "weekly",
      weekNumber: content.meta.weekNumber,
      content: content as unknown as Record<string, unknown>,
      status: "pending_analyst",
      pdfUrl: null,
      analystNotes: null,
      approvedAt: null,
    };
    const [inserted] = await db.insert(reportDrafts).values(row).returning({ id: reportDrafts.id });
    content.meta.runId = this.runId;

    const findings: Record<string, unknown> = {
      reportDraftId: inserted.id,
      reportType: "weekly",
      weekNumber: content.meta.weekNumber,
      sections: Object.keys(content).filter((k) => k !== "meta").length,
      content,
    };
    await this.writeScratchpad({ reportDraftId: inserted.id, weekNumber: content.meta.weekNumber });
    this.log(`weekly report draft ${inserted.id} created (week ${content.meta.weekNumber})`);
    return this.result(findings);
  }

  /** Assemble the full weekly content (used by run() and available for PDF rebuilds). */
  async assemble(prop: ResolvedProperty, tenantId: string): Promise<WeeklyReportContent> {
    const maxDate = await getMaxDataDate(prop.propertyId);
    const { current, previous } = buildWeeklyPeriods(maxDate);

    const [trafficSnapshot, dailySeries, rankingMovement, contentHighlights, backlinks, aeo, actions] =
      await Promise.all([
        loadTrafficSnapshot(prop.propertyId, current, previous),
        loadDailySeries(prop.propertyId, current),
        loadRankingMovement(prop, current, previous),
        loadContentHighlights(prop, current),
        loadBacklinkSummary(prop.name),
        loadAeoSnapshot(prop, current),
        loadRecommendations(tenantId),
      ]);

    const technicalHealth = computeTechnicalHealth(trafficSnapshot);
    const executiveSummary = await this.generateExecutiveSummary({
      domain: prop.name,
      current,
      snapshot: trafficSnapshot,
      topRanking: rankingMovement[0],
      topAction: actions[0],
      tech: technicalHealth,
    });

    return {
      meta: {
        reportType: "weekly",
        domain: prop.name,
        propertyName: prop.name,
        tenantId,
        weekNumber: isoWeek(new Date(`${current.end}T00:00:00Z`)),
        current,
        previous,
        generatedAt: new Date().toISOString(),
        runId: this.runId,
      },
      executiveSummary,
      trafficSnapshot,
      dailySeries,
      rankingMovement,
      technicalHealth,
      contentHighlights,
      backlinks,
      aeo,
      actions,
    };
  }

  private async generateExecutiveSummary(input: {
    domain: string;
    current: PeriodRange;
    snapshot: TrafficSnapshot;
    topRanking?: RankingMovementRow;
    topAction?: RecommendationRow;
    tech: TechnicalHealth;
  }): Promise<string[]> {
    const s = input.snapshot;
    const fmt = (d: { current: number; deltaPct: number | null }) =>
      `${d.current.toLocaleString()} (${d.deltaPct === null ? "n/a" : (d.deltaPct >= 0 ? "+" : "") + d.deltaPct + "%"} WoW)`;

    const system =
      "You are a senior SEO strategist writing the executive summary of a weekly client report. " +
      "Write 4-5 punchy bullet points in confident business language. Cite specific numbers. " +
      "No filler, no generic advice. Lead with the most important movement.";
    const user =
      `Domain: ${input.domain}\nWeek: ${input.current.start} to ${input.current.end}\n\n` +
      `Users: ${fmt(s.users)}\nSessions: ${fmt(s.sessions)}\nConversions: ${fmt(s.conversions)}\n` +
      `GSC clicks: ${fmt(s.clicks)}\nImpressions: ${fmt(s.impressions)}\nCTR: ${s.ctr.current}% (${s.ctr.deltaPct ?? "n/a"}% WoW)\n` +
      `Avg position: ${s.avgPosition.current} (lower is better)\n` +
      `Technical health: ${input.tech.score}/100 (${input.tech.status})\n` +
      (input.topRanking ? `Top query: "${input.topRanking.query}" at position ${input.topRanking.position}\n` : "") +
      (input.topAction ? `Top recommended action: ${input.topAction.statement}\n` : "") +
      `\nReturn ONLY a JSON array of 4-5 bullet strings, each under 24 words. No preamble.`;

    try {
      const resp = await openai.chat.completions.create({
        model: WEEKLY_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      this.trackTokens(resp.usage?.prompt_tokens ?? 0, resp.usage?.completion_tokens ?? 0);
      const parsed = parseJsonArray(resp.choices[0]?.message?.content ?? "[]");
      if (parsed.length >= 3) return parsed.slice(0, 5);
    } catch (err) {
      this.logError(`exec summary failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    // Deterministic fallback.
    return [
      `Sessions ${s.sessions.current.toLocaleString()} (${deltaText(s.sessions.deltaPct)} WoW), users ${s.users.current.toLocaleString()}.`,
      `Search clicks ${s.clicks.current.toLocaleString()} (${deltaText(s.clicks.deltaPct)} WoW) on ${s.impressions.current.toLocaleString()} impressions.`,
      `CTR ${s.ctr.current}% at average position ${s.avgPosition.current}.`,
      `Technical health ${input.tech.score}/100 — ${input.tech.status}.`,
      input.topAction ? `Priority action: ${input.topAction.statement}` : `No open recommendations this week.`,
    ];
  }
}

export function runWeeklyReport(tenantId: string): Promise<AgentResult> {
  return new WeeklyReportAgent().execute(tenantId);
}

// ── helpers ───────────────────────────────────────────────────────────────────

function deltaText(pct: number | null): string {
  if (pct === null) return "n/a";
  return `${pct >= 0 ? "+" : ""}${pct}%`;
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

function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
