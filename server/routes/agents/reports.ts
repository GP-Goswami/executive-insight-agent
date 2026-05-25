// A10 — API routes for report drafts.
// GET  /reports           → list drafts for tenant
// GET  /reports/:id       → get single draft with full content
// PATCH /reports/:id      → update status / analyst notes / edited content
// POST /report/run        → trigger A10 manually

import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../../db";
import { reportDrafts } from "@shared/schema";
import { runReportComposition } from "../../agents/report-composition";
import { agentRunRateLimit } from "./rate-limit";

const router = Router();

// GET /reports
router.get("/reports", async (req, res) => {
  try {
    const { tenantId, status } = req.query as { tenantId?: string; status?: string };

    if (!tenantId) {
      return res.status(400).json({ error: "tenantId is required" });
    }

    const conditions = [eq(reportDrafts.tenantId, tenantId)];
    if (status) conditions.push(eq(reportDrafts.status, status));

    const rows = await db
      .select({
        id: reportDrafts.id,
        tenantId: reportDrafts.tenantId,
        reportType: reportDrafts.reportType,
        weekNumber: reportDrafts.weekNumber,
        status: reportDrafts.status,
        pdfUrl: reportDrafts.pdfUrl,
        analystNotes: reportDrafts.analystNotes,
        createdAt: reportDrafts.createdAt,
        approvedAt: reportDrafts.approvedAt,
        content: reportDrafts.content,
      })
      .from(reportDrafts)
      .where(and(...conditions))
      .orderBy(desc(reportDrafts.createdAt))
      .limit(20);

    return res.json(rows);
  } catch (err) {
    console.error("[routes/reports] GET /reports error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /reports/:id
router.get("/reports/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const [row] = await db.select().from(reportDrafts).where(eq(reportDrafts.id, id)).limit(1);

    if (!row) return res.status(404).json({ error: "Report draft not found" });
    return res.json(row);
  } catch (err) {
    console.error("[routes/reports] GET /reports/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /reports/:id
router.patch("/reports/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status, analystNotes, content } = req.body as {
      status?: string;
      analystNotes?: string;
      content?: unknown;
    };

    const VALID_STATUSES = ["draft", "qa_review", "pending_analyst", "approved", "delivered", "rejected"];
    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` });
    }

    const updates: Record<string, unknown> = {};
    if (status !== undefined) {
      updates.status = status;
      if (status === "approved") updates.approvedAt = new Date();
    }
    if (analystNotes !== undefined) updates.analystNotes = analystNotes;
    if (content !== undefined) updates.content = content;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    const [updated] = await db
      .update(reportDrafts)
      .set(updates)
      .where(eq(reportDrafts.id, id))
      .returning();

    if (!updated) return res.status(404).json({ error: "Report draft not found" });
    return res.json(updated);
  } catch (err) {
    console.error("[routes/reports] PATCH /reports/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /report/run
router.post("/report/run", agentRunRateLimit, async (req, res) => {
  try {
    const { tenantId } = req.body as { tenantId?: string };
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    // Kick off asynchronously; respond immediately so the UI isn't blocked
    runReportComposition(tenantId).catch((err) => {
      console.error("[routes/reports] runReportComposition error:", err);
    });

    return res.json({ ok: true, message: "Report composition started" });
  } catch (err) {
    console.error("[routes/reports] POST /report/run error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
