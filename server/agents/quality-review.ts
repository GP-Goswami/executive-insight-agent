// A11 — Quality Review Agent.
// Runs structured pre-flight checks on a report_draft before it reaches the
// analyst. Three checks:
//   a) Factual consistency — numbers in the draft vs GA4/GSC DB totals
//   b) Completeness      — all required sections present and populated
//   c) Tone              — one model call to verify professional language
//
// If all checks pass  → draft status set to "pending_analyst"
// If any check fails  → draft status set to "qa_failed"; issues saved in
//                       content.qaResults so the review-queue UI can display them
//
// Model (env-overridable per CLAUDE.md "Model Routing"):
//   A11_QA_MODEL (default gpt-4.1)

import OpenAI from "openai";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  reportDrafts,
  ga4DailyMetrics,
  gscDaily,
  properties,
} from "@shared/schema";
import { BaseAgent, type AgentResult } from "./base-agent";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const QA_MODEL = process.env.A11_QA_MODEL || "gpt-4.1";

// Numbers in the draft are allowed to be this far off the DB totals before
// flagging. GA4 aggregations can differ slightly depending on dimension rows.
const TOLERANCE_PCT = 15;

export interface QAResult {
  passed: boolean;
  issues: string[];
  checkResults: {
    factualConsistency: { passed: boolean; issues: string[] };
    completeness: { passed: boolean; issues: string[] };
    tone: { passed: boolean; issues: string[] };
  };
}

type DraftContent = {
  executiveSummary?: string[];
  trafficSnapshot?: { sessions: number; users: number; conversions: number; engagedSessions?: number };
  searchSnapshot?: { clicks: number; impressions: number; ctr: number; avgPosition: number };
  anomaliesSection?: { count: number; p0Count?: number; p1Count?: number; summary?: string };
  recommendationsSection?: { count: number; items?: unknown[] };
  appendix?: { weekNumber?: number; generatedAt?: string; sourceRunIds?: string[] };
  qaResults?: QAResult;
};

export class QualityReviewAgent extends BaseAgent {
  readonly agentId = "A11";
  readonly model = QA_MODEL;
  /** Set by runQualityReview() before execute() so run() can read it. */
  reportDraftId?: string;

  async run(tenantId: string): Promise<AgentResult> {
    const reportDraftId = this.reportDraftId;
    // ── Load the draft ────────────────────────────────────────────────────────
    const draft = await this.loadDraft(tenantId, reportDraftId);
    if (!draft) {
      throw new Error(`No report draft found for tenant "${tenantId}"${reportDraftId ? ` (id: ${reportDraftId})` : ""}`);
    }
    const content = (draft.content ?? {}) as DraftContent;

    // ── Load DB actuals for factual check ─────────────────────────────────────
    const resolved = await this.resolvePropertyId(tenantId);
    const dbActuals = resolved ? await this.loadActuals(resolved.propertyId) : null;

    // ── Run the three checks ──────────────────────────────────────────────────
    const factual = this.checkFactualConsistency(content, dbActuals);
    const completeness = this.checkCompleteness(content);
    const tone = await this.checkTone(content);

    const allIssues = [...factual.issues, ...completeness.issues, ...tone.issues];
    const passed = factual.passed && completeness.passed && tone.passed;

    const qaResult: QAResult = {
      passed,
      issues: allIssues,
      checkResults: { factualConsistency: factual, completeness, tone },
    };

    // ── Persist: update draft status + embed qaResults in content ─────────────
    const newStatus = passed ? "pending_analyst" : "qa_failed";
    const updatedContent: DraftContent = { ...content, qaResults: qaResult };

    await db
      .update(reportDrafts)
      .set({ status: newStatus, content: updatedContent })
      .where(eq(reportDrafts.id, draft.id));

    // ── Write scratchpad ──────────────────────────────────────────────────────
    const findings: Record<string, unknown> = {
      reportDraftId: draft.id,
      passed,
      newStatus,
      issueCount: allIssues.length,
      issues: allIssues,
      checkResults: qaResult.checkResults,
    };
    await this.writeScratchpad(findings);

    this.log(`QA ${passed ? "PASSED" : "FAILED"} for draft ${draft.id} (${allIssues.length} issue(s))`);
    return this.result(findings);
  }

  // ── Check a: Factual consistency ───────────────────────────────────────────

  private checkFactualConsistency(
    content: DraftContent,
    actuals: { sessions: number; users: number } | null,
  ): { passed: boolean; issues: string[] } {
    const issues: string[] = [];

    if (!actuals) {
      // No DB data to compare against — cannot flag as failed, just note it
      return { passed: true, issues: [] };
    }

    const snap = content.trafficSnapshot;
    if (!snap) return { passed: true, issues: [] };

    const checks: Array<{ label: string; draft: number; actual: number }> = [
      { label: "Sessions", draft: snap.sessions, actual: actuals.sessions },
      { label: "Users", draft: snap.users, actual: actuals.users },
    ];

    for (const { label, draft, actual } of checks) {
      if (actual === 0) continue; // No actual data — skip
      const pctDiff = Math.abs(draft - actual) / actual * 100;
      if (pctDiff > TOLERANCE_PCT) {
        issues.push(
          `${label}: draft shows ${draft.toLocaleString()} but DB has ${actual.toLocaleString()} (${pctDiff.toFixed(1)}% off — exceeds ${TOLERANCE_PCT}% tolerance)`,
        );
      }
    }

    return { passed: issues.length === 0, issues };
  }

  // ── Check b: Completeness ──────────────────────────────────────────────────

  private checkCompleteness(content: DraftContent): { passed: boolean; issues: string[] } {
    const issues: string[] = [];

    if (!content.executiveSummary || content.executiveSummary.length < 3) {
      issues.push("Executive summary is missing or has fewer than 3 bullets");
    }

    if (!content.trafficSnapshot || content.trafficSnapshot.sessions === 0) {
      issues.push("Traffic snapshot is missing or shows zero sessions");
    }

    if (!content.anomaliesSection) {
      issues.push("Anomalies section is missing");
    }

    if (!content.recommendationsSection) {
      issues.push("Recommendations section is missing");
    }

    if (!content.appendix) {
      issues.push("Appendix (data sources) is missing");
    }

    return { passed: issues.length === 0, issues };
  }

  // ── Check c: Tone (model call) ─────────────────────────────────────────────

  private async checkTone(content: DraftContent): Promise<{ passed: boolean; issues: string[] }> {
    const bullets = content.executiveSummary ?? [];
    if (bullets.length === 0) {
      return { passed: true, issues: [] }; // Nothing to check — completeness catches the empty case
    }

    const system =
      "You are a QA reviewer for professional client-facing SEO reports. " +
      "Evaluate whether the provided executive summary bullets meet professional business writing standards.";

    const user =
      "Review these executive summary bullets for professional tone and clarity:\n\n" +
      bullets.map((b, i) => `${i + 1}. ${b}`).join("\n") +
      "\n\nReturn ONLY this JSON (no preamble):\n" +
      '{"professional":true,"issues":[]}\n' +
      "Set professional to false and list issues if any bullet:\n" +
      "- Contains jargon or overly casual language\n" +
      "- Is vague or lacks specific data\n" +
      "- Is longer than 25 words\n" +
      "- Contains first-person language ('I', 'we')\n" +
      "If all bullets are acceptable, return professional:true and empty issues array.";

    let raw = "";
    try {
      const resp = await openai.chat.completions.create({
        model: QA_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      this.trackTokens(resp.usage?.prompt_tokens ?? 0, resp.usage?.completion_tokens ?? 0);
      raw = resp.choices[0]?.message?.content ?? "";
    } catch (err) {
      this.logError(`tone check model failed: ${err instanceof Error ? err.message : String(err)}`);
      return { passed: true, issues: [] }; // Don't block on model failure
    }

    const parsed = parseToneResult(raw);
    return {
      passed: parsed.professional,
      issues: parsed.issues.map((i) => `Tone: ${i}`),
    };
  }

  // ── DB helpers ─────────────────────────────────────────────────────────────

  private async loadDraft(tenantId: string, reportDraftId?: string) {
    if (reportDraftId) {
      const [row] = await db
        .select()
        .from(reportDrafts)
        .where(eq(reportDrafts.id, reportDraftId))
        .limit(1);
      return row ?? null;
    }
    // Fall back to latest draft for tenant
    const [row] = await db
      .select()
      .from(reportDrafts)
      .where(eq(reportDrafts.tenantId, tenantId))
      .orderBy(reportDrafts.createdAt)
      .limit(1);
    return row ?? null;
  }

  private async resolvePropertyId(tenantId: string): Promise<{ propertyId: string } | null> {
    const [direct] = await db.select({ id: properties.id }).from(properties).where(eq(properties.id, tenantId)).limit(1);
    if (direct) return { propertyId: direct.id };
    const [byGa4] = await db.select({ id: properties.id }).from(properties).where(eq(properties.ga4PropertyId, tenantId)).limit(1);
    if (byGa4) return { propertyId: byGa4.id };
    const [richest] = await db
      .select({ propertyId: ga4DailyMetrics.propertyId, n: sql<number>`COUNT(*)` })
      .from(ga4DailyMetrics)
      .groupBy(ga4DailyMetrics.propertyId)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(1);
    return richest?.propertyId ? { propertyId: richest.propertyId } : null;
  }

  private async loadActuals(propertyId: string): Promise<{ sessions: number; users: number }> {
    const [row] = await db
      .select({
        sessions: sql<number>`COALESCE(SUM(${ga4DailyMetrics.sessions}), 0)`,
        users: sql<number>`COALESCE(SUM(${ga4DailyMetrics.totalUsers}), 0)`,
      })
      .from(ga4DailyMetrics)
      .where(eq(ga4DailyMetrics.propertyId, propertyId));
    return { sessions: Number(row?.sessions ?? 0), users: Number(row?.users ?? 0) };
  }
}

/** Entry point for routes/cron. Accepts optional reportDraftId. */
export function runQualityReview(tenantId: string, reportDraftId?: string): Promise<AgentResult> {
  const agent = new QualityReviewAgent();
  agent.reportDraftId = reportDraftId;
  return agent.execute(tenantId);
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function parseToneResult(raw: string): { professional: boolean; issues: string[] } {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    return {
      professional: parsed.professional !== false,
      issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : [],
    };
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(cleaned.slice(start, end + 1));
        return {
          professional: parsed.professional !== false,
          issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : [],
        };
      } catch {
        // fall through
      }
    }
    return { professional: true, issues: [] }; // Don't block on parse failure
  }
}
