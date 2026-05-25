// A09 — Recommendation API routes. Mounted at /api/agents (see server/routes.ts).
//   GET   /api/agents/recommendations        ?tenantId=&status=
//   PATCH /api/agents/recommendations/:id      { status, analystEdit? }
//   POST  /api/agents/recommendations/run      { tenantId } → triggers synthesis
//
// Additive only — does not touch any existing endpoint.

import { Router } from "express";
import { and, asc, desc, eq, type SQL } from "drizzle-orm";
import { db } from "../../db";
import { recommendations, agentRuns } from "@shared/schema";
import { runRecommendationSynthesis } from "../../agents/recommendation-synthesis";
import { agentRunRateLimit } from "./rate-limit";

const router = Router();

const REC_STATUSES = ["pending_review", "approved", "vetoed", "edited"] as const;

// GET /api/agents/recommendations — latest A09 run's recommendations for a tenant.
// (The recommendations table has no week/created_at column, so "this week's" set
// is the most recent A09 run, found via agent_runs.started_at.)
router.get("/recommendations", async (req, res) => {
  try {
    const { tenantId, status } = req.query;
    const filters: SQL[] = [];

    if (typeof tenantId === "string") {
      const [latest] = await db
        .select({ id: agentRuns.id })
        .from(agentRuns)
        .where(and(eq(agentRuns.agentId, "A09"), eq(agentRuns.tenantId, tenantId)))
        .orderBy(desc(agentRuns.startedAt))
        .limit(1);
      if (!latest) return res.json([]); // no run yet for this tenant
      filters.push(eq(recommendations.runId, latest.id));
    }
    if (typeof status === "string") filters.push(eq(recommendations.status, status));

    const rows = await db
      .select()
      .from(recommendations)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(asc(recommendations.priority));

    res.json(rows);
  } catch (err) {
    console.error("[api] GET /api/agents/recommendations failed:", err);
    res.status(500).json({ message: "Failed to load recommendations" });
  }
});

// PATCH /api/agents/recommendations/:id — analyst approve / veto / edit.
router.patch("/recommendations/:id", async (req, res) => {
  try {
    const { status, analystEdit } = req.body ?? {};
    if (!REC_STATUSES.includes(status)) {
      return res.status(400).json({ message: `status must be one of ${REC_STATUSES.join(", ")}` });
    }
    const updateData: { status: string; analystEdit?: string } = { status };
    if (typeof analystEdit === "string") updateData.analystEdit = analystEdit;

    const [updated] = await db
      .update(recommendations)
      .set(updateData)
      .where(eq(recommendations.id, req.params.id))
      .returning();

    if (!updated) return res.status(404).json({ message: "Recommendation not found" });
    res.json(updated);
  } catch (err) {
    console.error("[api] PATCH /api/agents/recommendations/:id failed:", err);
    res.status(500).json({ message: "Failed to update recommendation" });
  }
});

// POST /api/agents/recommendations/run — manually trigger a synthesis run.
router.post("/recommendations/run", agentRunRateLimit, async (req, res) => {
  try {
    const tenantId = req.body?.tenantId ?? req.query.tenantId;
    if (typeof tenantId !== "string" || !tenantId) {
      return res.status(400).json({ message: "tenantId is required" });
    }
    const result = await runRecommendationSynthesis(tenantId);
    res.json(result);
  } catch (err) {
    console.error("[api] POST /api/agents/recommendations/run failed:", err);
    res.status(500).json({ message: "Recommendation synthesis run failed" });
  }
});

export default router;
