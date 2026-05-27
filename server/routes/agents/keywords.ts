// A02 — Keyword Intelligence API. Mounted at /api/agents (see server/routes.ts).
//   GET  /keywords        ?tenantId=  → latest A02 findings (from agent_runs.output)
//   POST /keywords/run    { tenantId } → run the analysis now and return findings

import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { agentRuns } from "@shared/schema";
import { runKeywordIntelligence } from "../../agents/keyword-intelligence";
import { agentRunRateLimit } from "./rate-limit";

const router = Router();

router.get("/keywords", async (req, res) => {
  try {
    const tenantId = req.query.tenantId as string;
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });
    const [latest] = await db
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.agentId, "A02"), eq(agentRuns.tenantId, tenantId), eq(agentRuns.status, "completed")))
      .orderBy(desc(agentRuns.startedAt))
      .limit(1);
    if (!latest) return res.json({ exists: false });
    return res.json({ exists: true, runId: latest.id, completedAt: latest.completedAt, findings: latest.output });
  } catch (err) {
    console.error("[routes/keywords] GET /keywords error:", err);
    return res.status(500).json({ error: "Failed to load keyword intelligence" });
  }
});

router.post("/keywords/run", agentRunRateLimit, async (req, res) => {
  try {
    const tenantId = (req.body?.tenantId ?? req.query.tenantId) as string | undefined;
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });
    const result = await runKeywordIntelligence(tenantId);
    if (result.status === "failed") return res.status(500).json({ error: result.error ?? "Keyword intelligence run failed" });
    return res.json(result.findings);
  } catch (err) {
    console.error("[routes/keywords] POST /keywords/run error:", err);
    return res.status(500).json({ error: "Keyword intelligence run failed" });
  }
});

export default router;
