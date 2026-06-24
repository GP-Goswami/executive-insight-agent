// A07 — AEO / GEO Visibility Agent.
// Queries ChatGPT, Claude, and Gemini with brand-detection prompts and records
// whether each engine cited the brand, at what position, and in what context.
// Results are saved to aeo_runs; aggregate written to agent_scratchpad for A10.
//
// Engine API keys (optional — missing key → engine skipped silently):
//   AI_INTEGRATIONS_OPENAI_API_KEY  → OpenAI gpt-4.1-nano
//   CLAUDE_API_KEY                  → Anthropic claude-haiku-4-5-20251001
//   GEMINI_API_KEY                  → Google gemini-1.5-flash-8b

import OpenAI from "openai";
import { randomUUID } from "crypto";
import { db } from "../db";
import { aeoRuns, type InsertAeoRun } from "@shared/schema";
import { BaseAgent, type AgentResult } from "./base-agent";

// ── Engine key accessors (lazy — always read after dotenv loads) ──────────────

function getOpenAIKey() { return process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? null; }
function getClaudeKey()  { return process.env.CLAUDE_API_KEY ?? null; }

function makeOpenAIClient() {
  const key = getOpenAIKey();
  if (!key) return null;
  return new OpenAI({ apiKey: key, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });
}

const SYSTEM_PROMPT =
  "Answer the following question naturally and thoroughly as you would for a real user.";

// ── Brand variation builder ───────────────────────────────────────────────────
// "TrueFirms" → ["truefirms", "true firms", "truefirms.co", "truefirms.com", "truefirms resourcehub"]

function buildBrandVariations(brand: string): string[] {
  const base   = brand.toLowerCase().trim();
  // CamelCase split: "TrueFirms" → "true firms"
  const spaced = brand.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().trim();
  const vars   = new Set<string>([base]);
  if (spaced !== base) vars.add(spaced);
  vars.add(base + ".co");
  vars.add(base + ".com");
  vars.add(base + " resourcehub");
  return Array.from(vars);
}

// ── Brand detection ───────────────────────────────────────────────────────────

interface MentionResult {
  cited: boolean;
  position: number | null;
  context: "primary" | "corroborating" | "listed" | null;
  excerpt: string | null;
  matchedVariant: string | null;
}

function detectMention(response: string, brand: string): MentionResult {
  const responseLower = response.toLowerCase();
  const variations    = buildBrandVariations(brand);

  // Find first matching variant
  let matchedVariant: string | null = null;
  for (const v of variations) {
    if (responseLower.includes(v)) { matchedVariant = v; break; }
  }

  if (!matchedVariant) {
    return { cited: false, position: null, context: null, excerpt: null, matchedVariant: null };
  }

  // Position: paragraph index of first match
  const paragraphs = response.split(/\n\n+/);
  let position: number | null = null;
  for (let i = 0; i < paragraphs.length; i++) {
    if (paragraphs[i].toLowerCase().includes(matchedVariant)) { position = i; break; }
  }

  // Context: primary / corroborating / listed
  const safeVariant  = matchedVariant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mentionCount = (responseLower.match(new RegExp(safeVariant, "g")) ?? []).length;
  const context: MentionResult["context"] =
    position === 0 ? "primary" : mentionCount >= 2 ? "corroborating" : "listed";

  // Excerpt: first sentence containing the match (max 300 chars)
  const sentences = response.split(/(?<=[.!?])\s+/);
  const raw = sentences.find((s) => s.toLowerCase().includes(matchedVariant!)) ?? null;
  const excerpt = raw ? raw.trim().slice(0, 300) : null;

  return { cited: true, position, context, excerpt, matchedVariant };
}

// ── Engine callers ────────────────────────────────────────────────────────────

async function callOpenAI(query: string): Promise<string> {
  const client = makeOpenAIClient();
  if (!client) throw new Error("AI_INTEGRATIONS_OPENAI_API_KEY not set");
  const resp = await client.chat.completions.create({
    model: "gpt-4.1-nano",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: query },
    ],
    max_tokens: 512,
  });
  return resp.choices[0]?.message?.content ?? "";
}

async function callClaude(query: string): Promise<string> {
  const key = getClaudeKey();
  if (!key) throw new Error("CLAUDE_API_KEY not set");
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: query }],
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Claude HTTP ${resp.status}: ${body.slice(0, 200)}`);
  }
  const data = (await resp.json()) as { content?: Array<{ type: string; text: string }> };
  return data.content?.find((b) => b.type === "text")?.text ?? "";
}


// ── Agent ─────────────────────────────────────────────────────────────────────

export interface AeoQueryResult {
  query: string;
  chatgpt: MentionResult | null;
  claude:  MentionResult | null;
  gemini:  MentionResult | null;
}

export class AeoVisibilityAgent extends BaseAgent {
  readonly agentId = "A07";
  readonly model    = "gpt-4.1-nano";

  queries: string[]   = [];
  brandEntity: string = "TrueFirms";

  async run(tenantId: string): Promise<AgentResult> {
    const queries    = this.queries.length > 0 ? this.queries : ["What is TrueFirms?"];
    const brand      = this.brandEntity || "TrueFirms";
    const runBatchId = randomUUID();

    const activeEngines = [
      getOpenAIKey() ? "chatgpt" : null,
      getClaudeKey()  ? "claude"  : null,
    ].filter(Boolean);
    this.log(`A07 engines active: ${activeEngines.join(", ") || "NONE — check API keys"}`);

    const rows: InsertAeoRun[] = [];
    const queryResults: AeoQueryResult[] = [];
    // responseTexts[query][engine] = first 200 chars — returned to UI, not saved to DB
    const responseTexts: Record<string, Record<string, string>> = {};

    for (let qi = 0; qi < queries.length; qi++) {
      const query = queries[qi];
      if (qi > 0) await new Promise<void>((r) => setTimeout(r, 1000));

      const [openaiSettled, claudeSettled] = await Promise.allSettled([
        getOpenAIKey() ? callOpenAI(query) : Promise.reject(new Error("AI_INTEGRATIONS_OPENAI_API_KEY not set")),
        getClaudeKey()  ? callClaude(query) : Promise.reject(new Error("CLAUDE_API_KEY not set")),
      ]);

      // Collect first-query errors for UI display
      const engineErrorsThisQuery: Record<string, string> = {};
      const checkSettled = (settled: PromiseSettledResult<string>, engine: string) => {
        if (settled.status === "rejected") {
          const msg = String((settled.reason as Error)?.message ?? settled.reason);
          console.warn(`[A07] ${engine} failed for "${query}":`, msg);
          engineErrorsThisQuery[engine] = msg;
        }
      };
      checkSettled(openaiSettled, "chatgpt");
      checkSettled(claudeSettled, "claude");
      if (Object.keys(engineErrorsThisQuery).length > 0 && qi === 0) {
        (this as unknown as Record<string, unknown>)._lastEngineErrors = engineErrorsThisQuery;
      }

      const responses: Record<"chatgpt" | "claude", string | null> = {
        chatgpt: openaiSettled.status === "fulfilled" ? openaiSettled.value : null,
        claude:  claudeSettled.status === "fulfilled"  ? claudeSettled.value  : null,
      };

      const resultRow: AeoQueryResult = { query, chatgpt: null, claude: null, gemini: null };
      responseTexts[query] = {};

      for (const [engine, text] of Object.entries(responses) as ["chatgpt" | "claude", string | null][]) {
        if (text === null) continue;

        // Issue 1: log full response text for debugging
        console.log(`[A07] ${engine} response for "${query}":`, text.substring(0, 500));

        // Store response preview for UI debug mode
        responseTexts[query][engine] = text.slice(0, 200);

        const m = detectMention(text, brand);
        resultRow[engine] = m;

        if (m.cited) {
          console.log(`[A07] ✅ ${engine} cited "${brand}" (variant: "${m.matchedVariant}") at position ${m.position}`);
        }

        rows.push({
          tenantId,
          runBatchId,
          query,
          engine,
          cited:       m.cited ? 1 : 0,
          position:    m.position ?? null,
          context:     m.context ?? null,
          excerpt:     m.excerpt ?? null,
          brandEntity: brand,
        });
      }
      queryResults.push(resultRow);
    }

    if (rows.length > 0) await db.insert(aeoRuns).values(rows);

    if (rows.length === 0) {
      return this.result({ error: "All engines failed or no API keys configured" });
    }

    // Aggregation
    const totalRows  = rows.length;
    const citedRows  = rows.filter((r) => r.cited === 1).length;
    const citationShare = totalRows > 0 ? Math.round((citedRows / totalRows) * 100) : 0;
    const posVals    = rows.filter((r) => r.position != null).map((r) => r.position as number);
    const avgPosition = posVals.length > 0
      ? Math.round(posVals.reduce((a, b) => a + b, 0) / posVals.length) : 0;

    const byEngine: Record<string, { citationShare: number; mentionsFound: number }> = {};
    for (const eng of ["chatgpt", "claude"] as const) {
      const engRows = rows.filter((r) => r.engine === eng);
      if (engRows.length === 0) continue;
      const cited = engRows.filter((r) => r.cited === 1).length;
      byEngine[eng] = {
        citationShare: Math.round((cited / engRows.length) * 100),
        mentionsFound: cited,
      };
    }

    const topQuery = queryResults.find(
      (q) => q.chatgpt?.cited || q.claude?.cited || q.gemini?.cited,
    )?.query ?? null;

    const engineStatus = {
      chatgpt: !!getOpenAIKey(),
      claude:  !!getClaudeKey(),
    };

    const engineErrors = (this as unknown as Record<string, unknown>)._lastEngineErrors as
      Record<string, string> | undefined;

    const findings: Record<string, unknown> = {
      runBatchId,
      citationShare,
      avgPosition,
      totalRuns:     totalRows,
      mentionsFound: citedRows,
      byEngine,
      topQuery,
      brandEntity:   brand,
      queryResults,
      responseTexts,   // Issue 4/5: returned to UI for preview + debug mode
      engineStatus,
      ...(engineErrors && Object.keys(engineErrors).length > 0 ? { engineErrors } : {}),
    };

    await this.writeScratchpad(findings);
    this.log(`A07 batch ${runBatchId}: ${citedRows}/${totalRows} cited (${citationShare}%)`);
    return this.result(findings);
  }
}

export function runAeoVisibility(
  tenantId: string,
  queries:  string[],
  brandEntity: string,
): Promise<AgentResult> {
  const agent = new AeoVisibilityAgent();
  agent.queries      = queries;
  agent.brandEntity  = brandEntity;
  return agent.execute(tenantId);
}
