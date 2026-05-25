// A11 — API routes for Quality Review.
// POST /qa/run     → trigger A11 for a report draft (runs synchronously, returns result)
// GET  /qa/result  → fetch QA result embedded in report_draft content

import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { reportDrafts } from "@shared/schema";
import { runQualityReview } from "../../agents/quality-review";
import { agentRunRateLimit } from "./rate-limit";

const router = Router();

// POST /qa/run
// Runs A11 synchronously and returns the QA result so the UI can show
// pass/fail immediately without polling.
router.post("/qa/run", agentRunRateLimit, async (req, res) => {
  try {
    const { tenantId, reportDraftId } = req.body as {
      tenantId?: string;
      reportDraftId?: string;
    };

    if (!tenantId) {
      return res.status(400).json({ error: "tenantId is required" });
    }

    const agentResult = await runQualityReview(tenantId, reportDraftId);

    if (agentResult.status === "failed") {
      return res.status(500).json({ error: agentResult.error ?? "QA agent failed" });
    }

    const findings = agentResult.findings as {
      passed: boolean;
      newStatus: string;
      issues: string[];
      checkResults: unknown;
      reportDraftId: string;
    };

    return res.json({
      ok: true,
      passed: findings.passed,
      status: findings.newStatus,
      issues: findings.issues,
      checkResults: findings.checkResults,
      reportDraftId: findings.reportDraftId,
    });
  } catch (err) {
    console.error("[routes/qa] POST /qa/run error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /qa/result?reportDraftId=xxx
// Returns the qaResults block embedded in the draft's content JSONB.
router.get("/qa/result", async (req, res) => {
  try {
    const { reportDraftId } = req.query as { reportDraftId?: string };

    if (!reportDraftId) {
      return res.status(400).json({ error: "reportDraftId is required" });
    }

    const [row] = await db
      .select({ status: reportDrafts.status, content: reportDrafts.content })
      .from(reportDrafts)
      .where(eq(reportDrafts.id, reportDraftId))
      .limit(1);

    if (!row) return res.status(404).json({ error: "Report draft not found" });

    const content = row.content as { qaResults?: unknown } | null;
    return res.json({
      status: row.status,
      qaResults: content?.qaResults ?? null,
    });
  } catch (err) {
    console.error("[routes/qa] GET /qa/result error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
