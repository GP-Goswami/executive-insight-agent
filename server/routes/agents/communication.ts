// A12 — API routes for client communication drafts.
// POST /communication/run      → trigger A12 (sync; returns draft immediately)
// GET  /communication          → list email drafts for tenant
// PATCH /communication/:id     → update status or analyst edit

import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../../db";
import { emailDrafts } from "@shared/schema";
import { runClientCommunication } from "../../agents/client-communication";
import { agentRunRateLimit } from "./rate-limit";

const router = Router();

// POST /communication/run
router.post("/communication/run", agentRunRateLimit, async (req, res) => {
  try {
    const { tenantId, reportDraftId } = req.body as {
      tenantId?: string;
      reportDraftId?: string;
    };
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const agentResult = await runClientCommunication(tenantId, reportDraftId);

    if (agentResult.status === "failed") {
      return res.status(500).json({ error: agentResult.error ?? "Communication agent failed" });
    }

    const findings = agentResult.findings as {
      emailDraftId: string;
      reportDraftId: string;
      subject: string;
      status: string;
    };

    // Return the full email draft row so the UI can render it immediately
    const [row] = await db
      .select()
      .from(emailDrafts)
      .where(eq(emailDrafts.id, findings.emailDraftId))
      .limit(1);

    return res.json(row);
  } catch (err) {
    console.error("[routes/communication] POST /communication/run error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /communication?tenantId=xxx[&reportDraftId=yyy]
router.get("/communication", async (req, res) => {
  try {
    const { tenantId, reportDraftId } = req.query as {
      tenantId?: string;
      reportDraftId?: string;
    };
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const conditions = [eq(emailDrafts.tenantId, tenantId)];
    if (reportDraftId) conditions.push(eq(emailDrafts.reportDraftId, reportDraftId));

    const rows = await db
      .select()
      .from(emailDrafts)
      .where(and(...conditions))
      .orderBy(desc(emailDrafts.createdAt))
      .limit(20);

    return res.json(rows);
  } catch (err) {
    console.error("[routes/communication] GET /communication error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /communication/:id
router.patch("/communication/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status, analystEdit } = req.body as {
      status?: string;
      analystEdit?: string;
    };

    const VALID_STATUSES = ["draft", "analyst_approved", "sent", "discarded"];
    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` });
    }

    const updates: Record<string, unknown> = {};
    if (status !== undefined) updates.status = status;
    if (analystEdit !== undefined) updates.analystEdit = analystEdit;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    const [updated] = await db
      .update(emailDrafts)
      .set(updates)
      .where(eq(emailDrafts.id, id))
      .returning();

    if (!updated) return res.status(404).json({ error: "Email draft not found" });
    return res.json(updated);
  } catch (err) {
    console.error("[routes/communication] PATCH /communication/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
