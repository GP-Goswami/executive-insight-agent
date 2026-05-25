// A12 — Client Communication Agent.
// Reads an approved (or pending_analyst) report_draft, loads tenant config from
// the properties/clients tables, and uses gpt-4.1 to draft a professional cover
// email. The draft is written to email_drafts with status "draft" — the analyst
// must explicitly approve before any send action.
//
// Model (env-overridable per CLAUDE.md "Model Routing"):
//   A12_COMM_MODEL (default gpt-4.1)
//
// CRITICAL: This agent NEVER sends email. It only creates a draft.

import OpenAI from "openai";
import { eq, desc, sql } from "drizzle-orm";
import { db } from "../db";
import {
  reportDrafts,
  emailDrafts,
  properties,
  clients,
  ga4DailyMetrics,
  type InsertEmailDraft,
} from "@shared/schema";
import { BaseAgent, type AgentResult } from "./base-agent";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const COMM_MODEL = process.env.A12_COMM_MODEL || "gpt-4.1";

type DraftContent = {
  executiveSummary?: string[];
  trafficSnapshot?: { sessions: number; users: number; conversions: number };
  anomaliesSection?: { count: number; p0Count?: number };
  recommendationsSection?: { count: number };
  appendix?: { weekNumber?: number };
};

export class ClientCommunicationAgent extends BaseAgent {
  readonly agentId = "A12";
  readonly model = COMM_MODEL;
  /** Set by runClientCommunication() before execute(). */
  reportDraftId?: string;

  async run(tenantId: string): Promise<AgentResult> {
    const reportDraftId = this.reportDraftId;

    // ── Load report draft ─────────────────────────────────────────────────────
    const draft = await this.loadDraft(tenantId, reportDraftId);
    if (!draft) {
      throw new Error(
        `No approved/pending report draft found for tenant "${tenantId}"` +
          (reportDraftId ? ` (id: ${reportDraftId})` : ""),
      );
    }
    const content = (draft.content ?? {}) as DraftContent;

    // ── Load tenant config ────────────────────────────────────────────────────
    const tenantConfig = await this.loadTenantConfig(tenantId);

    // ── Draft the email via model ─────────────────────────────────────────────
    const { subject, body } = await this.draftEmail({ content, tenantConfig, weekNumber: draft.weekNumber });

    // ── Persist to email_drafts ───────────────────────────────────────────────
    const row: InsertEmailDraft = {
      tenantId,
      reportDraftId: draft.id,
      subject,
      body,
      status: "draft",
      analystEdit: null,
    };
    const [inserted] = await db.insert(emailDrafts).values(row).returning({ id: emailDrafts.id });

    // ── Write scratchpad ──────────────────────────────────────────────────────
    const findings: Record<string, unknown> = {
      emailDraftId: inserted.id,
      reportDraftId: draft.id,
      subject,
      status: "draft",
    };
    await this.writeScratchpad(findings);

    this.log(`email draft ${inserted.id} created for tenant "${tenantId}"`);
    return this.result(findings);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async loadDraft(tenantId: string, reportDraftId?: string) {
    if (reportDraftId) {
      const [row] = await db
        .select()
        .from(reportDrafts)
        .where(eq(reportDrafts.id, reportDraftId))
        .limit(1);
      return row ?? null;
    }
    // Latest draft for tenant regardless of status
    const [row] = await db
      .select()
      .from(reportDrafts)
      .where(eq(reportDrafts.tenantId, tenantId))
      .orderBy(desc(reportDrafts.createdAt))
      .limit(1);
    return row ?? null;
  }

  private async loadTenantConfig(tenantId: string): Promise<{
    clientName: string;
    industry: string;
    domain: string;
  }> {
    // Try to resolve: internal UUID → GA4 property id → fallback
    const [direct] = await db
      .select({ name: clients.name, gscSiteUrl: properties.gscSiteUrl, ga4Id: properties.ga4PropertyId })
      .from(properties)
      .innerJoin(clients, eq(properties.clientId, clients.id))
      .where(eq(properties.id, tenantId))
      .limit(1);

    if (direct) {
      return {
        clientName: direct.name,
        industry: "digital",
        domain: direct.gscSiteUrl ?? direct.ga4Id ?? tenantId,
      };
    }

    const [byGa4] = await db
      .select({ name: clients.name, gscSiteUrl: properties.gscSiteUrl })
      .from(properties)
      .innerJoin(clients, eq(properties.clientId, clients.id))
      .where(eq(properties.ga4PropertyId, tenantId))
      .limit(1);

    if (byGa4) {
      return { clientName: byGa4.name, industry: "digital", domain: byGa4.gscSiteUrl ?? tenantId };
    }

    // Fallback: richest GA4 property
    const [richest] = await db
      .select({ propertyId: ga4DailyMetrics.propertyId })
      .from(ga4DailyMetrics)
      .groupBy(ga4DailyMetrics.propertyId)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(1);

    if (richest?.propertyId) {
      const [prop] = await db
        .select({ name: clients.name, gscSiteUrl: properties.gscSiteUrl })
        .from(properties)
        .innerJoin(clients, eq(properties.clientId, clients.id))
        .where(eq(properties.id, richest.propertyId))
        .limit(1);
      if (prop) return { clientName: prop.name, industry: "digital", domain: prop.gscSiteUrl ?? richest.propertyId };
    }

    return { clientName: "Client", industry: "digital", domain: tenantId };
  }

  private async draftEmail(input: {
    content: DraftContent;
    tenantConfig: { clientName: string; industry: string; domain: string };
    weekNumber: number | null;
  }): Promise<{ subject: string; body: string }> {
    const { content, tenantConfig, weekNumber } = input;
    const bullets = content.executiveSummary ?? [];
    const sessions = content.trafficSnapshot?.sessions ?? 0;
    const conversions = content.trafficSnapshot?.conversions ?? 0;
    const anomalyCount = content.anomaliesSection?.count ?? 0;
    const recCount = content.recommendationsSection?.count ?? 0;
    const week = weekNumber ?? "this week";

    const system =
      `You are drafting a professional client email for an SEO agency. ` +
      `The client is ${tenantConfig.clientName}, operating in the ${tenantConfig.industry} space. ` +
      `Write in a confident, consultative tone — direct but warm. No filler phrases like "I hope this finds you well".`;

    const user =
      `Draft a weekly SEO report cover email for week ${week}.\n\n` +
      `Key data this week:\n` +
      `- Sessions: ${sessions.toLocaleString()}\n` +
      `- Conversions: ${conversions.toLocaleString()}\n` +
      `- Anomalies detected: ${anomalyCount}\n` +
      `- Action items: ${recCount}\n\n` +
      (bullets.length > 0 ? `Executive highlights:\n${bullets.map((b) => `- ${b}`).join("\n")}\n\n` : "") +
      `Return ONLY this JSON (no preamble):\n` +
      `{\n` +
      `  "subject": "one clear subject line under 10 words",\n` +
      `  "body": "3-4 sentence email body. End with: Please review the full report attached and let us know if you have any questions."\n` +
      `}\n` +
      `Body must be plain text, no markdown, no bullet points.`;

    let raw = "";
    try {
      const resp = await openai.chat.completions.create({
        model: COMM_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      this.trackTokens(resp.usage?.prompt_tokens ?? 0, resp.usage?.completion_tokens ?? 0);
      raw = resp.choices[0]?.message?.content ?? "";
    } catch (err) {
      this.logError(`email draft model failed: ${err instanceof Error ? err.message : String(err)}`);
      return this.fallbackEmail(tenantConfig.clientName, week, sessions, recCount);
    }

    const parsed = parseEmailJson(raw);
    if (parsed?.subject && parsed?.body) return parsed;
    return this.fallbackEmail(tenantConfig.clientName, week, sessions, recCount);
  }

  private fallbackEmail(
    clientName: string,
    week: number | string,
    sessions: number,
    recCount: number,
  ): { subject: string; body: string } {
    return {
      subject: `Your SEO Report — Week ${week}`,
      body:
        `Hi ${clientName} team,\n\n` +
        `Please find attached your weekly SEO performance report for week ${week}. ` +
        `This week we recorded ${sessions.toLocaleString()} sessions and identified ${recCount} priority action item${recCount !== 1 ? "s" : ""} for your review. ` +
        `Please review the full report attached and let us know if you have any questions.`,
    };
  }
}

export function runClientCommunication(tenantId: string, reportDraftId?: string): Promise<AgentResult> {
  const agent = new ClientCommunicationAgent();
  agent.reportDraftId = reportDraftId;
  return agent.execute(tenantId);
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function parseEmailJson(raw: string): { subject: string; body: string } | null {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed?.subject === "string" && typeof parsed?.body === "string") return parsed;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(cleaned.slice(start, end + 1));
        if (typeof parsed?.subject === "string" && typeof parsed?.body === "string") return parsed;
      } catch {
        // fall through
      }
    }
  }
  return null;
}
