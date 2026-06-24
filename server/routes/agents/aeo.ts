// A07 — AEO / GEO Visibility API routes. Mounted at /api/agents.
//   POST /aeo/run                → trigger A07 for a tenant + query set
//   GET  /aeo/results?tenantId=  → aggregated citation stats + recent rows

import { Router } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { aeoRuns } from "@shared/schema";
import { runAeoVisibility } from "../../agents/aeo-visibility";
import { agentRunRateLimit } from "./rate-limit";

const router = Router();

// POST /aeo/run
// Body: { tenantId, queries: string[], brandEntity: string }
router.post("/aeo/run", agentRunRateLimit, async (req, res) => {
  try {
    const { tenantId, queries, brandEntity } = req.body as {
      tenantId?: string;
      queries?: string[];
      brandEntity?: string;
    };

    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });
    if (!Array.isArray(queries) || queries.length === 0) {
      return res.status(400).json({ error: "queries must be a non-empty array" });
    }
    if (!brandEntity) return res.status(400).json({ error: "brandEntity is required" });

    const result = await runAeoVisibility(tenantId, queries, brandEntity);

    if (result.status === "failed") {
      return res.status(500).json({ error: result.error ?? "A07 agent failed" });
    }

    return res.json(result.findings);
  } catch (err) {
    console.error("[routes/aeo] POST /aeo/run error:", err);
    return res.status(500).json({ error: "AEO visibility run failed" });
  }
});

// GET /aeo/results?tenantId=xxx[&engine=chatgpt]
router.get("/aeo/results", async (req, res) => {
  try {
    const { tenantId, engine, brandEntity } = req.query as { tenantId?: string; engine?: string; brandEntity?: string };
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const conditions = [eq(aeoRuns.tenantId, tenantId)];
    if (engine) conditions.push(eq(aeoRuns.engine, engine));
    if (brandEntity) conditions.push(eq(aeoRuns.brandEntity, brandEntity));

    const rows = await db
      .select()
      .from(aeoRuns)
      .where(and(...conditions))
      .orderBy(desc(aeoRuns.createdAt))
      .limit(500);

    // Aggregate totals
    const totalRuns = rows.length;
    const mentionsFound = rows.filter((r) => r.cited === 1).length;
    const citationShare = totalRuns > 0 ? Math.round((mentionsFound / totalRuns) * 100) : 0;
    const positions = rows.filter((r) => r.position != null).map((r) => r.position as number);
    const avgPosition = positions.length > 0
      ? Math.round(positions.reduce((a, b) => a + b, 0) / positions.length)
      : 0;

    // Per-engine breakdown
    const byEngine: Record<string, { citationShare: number; mentionsFound: number }> = {};
    for (const eng of ["chatgpt", "claude", "gemini"]) {
      const engRows = rows.filter((r) => r.engine === eng);
      if (engRows.length === 0) continue;
      const engCited = engRows.filter((r) => r.cited === 1).length;
      byEngine[eng] = {
        citationShare: Math.round((engCited / engRows.length) * 100),
        mentionsFound: engCited,
      };
    }

    return res.json({
      aggregates: { citationShare, avgPosition, totalRuns, mentionsFound },
      byEngine,
      recentResults: rows.slice(0, 20),
    });
  } catch (err) {
    console.error("[routes/aeo] GET /aeo/results error:", err);
    return res.status(500).json({ error: "Failed to load AEO results" });
  }
});

export default router;
