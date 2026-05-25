// Agent runs API — read-only; no mutations.
// GET /runs              → list runs (filterable by status, agentId, limit)
// GET /runs/cost-summary → weekly cost grouped by agent

import { Router } from "express";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "../../db";
import { agentRuns } from "@shared/schema";

const router = Router();

// ── Cost config (per CLAUDE.md "Model Routing") ───────────────────────────────
const MODEL_COST: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  "gpt-4.1-nano": { inputPer1M: 0.20, outputPer1M: 1.25 },
  "gpt-4.1":      { inputPer1M: 2.50, outputPer1M: 15.00 },
  "o3":           { inputPer1M: 2.00, outputPer1M: 8.00 },
};

// Infer model from agentId (matches env defaults in each agent file)
const AGENT_MODEL: Record<string, string> = {
  A08: "gpt-4.1-nano",
  A09: "gpt-4.1",
  A10: "gpt-4.1",
  A11: "gpt-4.1",
  A12: "gpt-4.1",
};

function estimateCost(agentId: string, tokensIn: number, tokensOut: number): number {
  const model = AGENT_MODEL[agentId] ?? "gpt-4.1";
  const rates = MODEL_COST[model] ?? MODEL_COST["gpt-4.1"];
  return (tokensIn / 1_000_000) * rates.inputPer1M + (tokensOut / 1_000_000) * rates.outputPer1M;
}

// GET /runs
router.get("/runs", async (req, res) => {
  try {
    const { tenantId, status, agentId, limit = "50" } = req.query as Record<string, string>;

    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const conditions = [eq(agentRuns.tenantId, tenantId)];
    if (status) conditions.push(eq(agentRuns.status, status));
    if (agentId) conditions.push(eq(agentRuns.agentId, agentId));

    const rows = await db
      .select()
      .from(agentRuns)
      .where(and(...conditions))
      .orderBy(desc(agentRuns.startedAt))
      .limit(Math.min(Number(limit) || 50, 200));

    // Enrich with computed fields
    const enriched = rows.map((r) => {
      const durationMs =
        r.startedAt && r.completedAt
          ? new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime()
          : null;
      const cost = estimateCost(r.agentId, r.tokensIn ?? 0, r.tokensOut ?? 0);
      const model = AGENT_MODEL[r.agentId] ?? "gpt-4.1";
      return { ...r, durationMs, estimatedCostUsd: cost, model };
    });

    return res.json(enriched);
  } catch (err) {
    console.error("[routes/runs] GET /runs error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /runs/cost-summary?tenantId=xxx&days=7
router.get("/runs/cost-summary", async (req, res) => {
  try {
    const { tenantId, days = "7" } = req.query as Record<string, string>;
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const since = new Date();
    since.setDate(since.getDate() - Math.max(1, Number(days) || 7));

    const rows = await db
      .select()
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.tenantId, tenantId),
          gte(agentRuns.startedAt, since),
        ),
      )
      .orderBy(desc(agentRuns.startedAt));

    // Group by agentId
    const byAgent: Record<
      string,
      { agentId: string; model: string; runs: number; tokensIn: number; tokensOut: number; costUsd: number }
    > = {};

    for (const r of rows) {
      const key = r.agentId;
      if (!byAgent[key]) {
        byAgent[key] = {
          agentId: key,
          model: AGENT_MODEL[key] ?? "gpt-4.1",
          runs: 0,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
        };
      }
      byAgent[key].runs++;
      byAgent[key].tokensIn += r.tokensIn ?? 0;
      byAgent[key].tokensOut += r.tokensOut ?? 0;
      byAgent[key].costUsd += estimateCost(key, r.tokensIn ?? 0, r.tokensOut ?? 0);
    }

    const summary = Object.values(byAgent).sort((a, b) => b.costUsd - a.costUsd);
    const totalCost = summary.reduce((s, a) => s + a.costUsd, 0);
    const totalRuns = summary.reduce((s, a) => s + a.runs, 0);

    return res.json({ days: Number(days), totalRuns, totalCostUsd: totalCost, byAgent: summary });
  } catch (err) {
    console.error("[routes/runs] GET /runs/cost-summary error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
