// A08 — Anomaly API routes. Mounted at /api/agents (see server/routes.ts).
//   GET   /api/agents/anomalies        ?severity=P0&status=open&tenantId=...
//   PATCH /api/agents/anomalies/:id     { status: open|acknowledged|resolved }
//   POST  /api/agents/anomaly/run       { tenantId }  → triggers a detection run
//
// Additive only — these routes do not touch any existing endpoint.

import { Router } from "express";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { db } from "../../db";
import { anomalies } from "@shared/schema";
import { runAnomalyDetection } from "../../agents/anomaly-detection";
import { agentRunRateLimit } from "./rate-limit";

const router = Router();

const ANOMALY_STATUSES = ["open", "acknowledged", "resolved"] as const;

// GET /api/agents/anomalies — list anomalies, optionally filtered.
router.get("/anomalies", async (req, res) => {
  try {
    const { severity, status, tenantId } = req.query;
    const filters: SQL[] = [];
    if (typeof severity === "string") filters.push(eq(anomalies.severity, severity));
    if (typeof status === "string") filters.push(eq(anomalies.status, status));
    if (typeof tenantId === "string") filters.push(eq(anomalies.tenantId, tenantId));

    const rows = await db
      .select()
      .from(anomalies)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(anomalies.detectedAt));

    res.json(rows);
  } catch (err) {
    console.error("[api] GET /api/agents/anomalies failed:", err);
    res.status(500).json({ message: "Failed to load anomalies" });
  }
});

// PATCH /api/agents/anomalies/:id — update status (acknowledge / resolve).
router.patch("/anomalies/:id", async (req, res) => {
  try {
    const { status } = req.body ?? {};
    if (!ANOMALY_STATUSES.includes(status)) {
      return res.status(400).json({ message: `status must be one of ${ANOMALY_STATUSES.join(", ")}` });
    }
    const [updated] = await db
      .update(anomalies)
      .set({ status })
      .where(eq(anomalies.id, req.params.id))
      .returning();

    if (!updated) return res.status(404).json({ message: "Anomaly not found" });
    res.json(updated);
  } catch (err) {
    console.error("[api] PATCH /api/agents/anomalies/:id failed:", err);
    res.status(500).json({ message: "Failed to update anomaly" });
  }
});

// POST /api/agents/anomaly/run — manually trigger a detection run for a tenant.
router.post("/anomaly/run", agentRunRateLimit, async (req, res) => {
  try {
    const tenantId = req.body?.tenantId ?? req.query.tenantId;
    if (typeof tenantId !== "string" || !tenantId) {
      return res.status(400).json({ message: "tenantId is required" });
    }
    const result = await runAnomalyDetection(tenantId);
    res.json(result);
  } catch (err) {
    console.error("[api] POST /api/agents/anomaly/run failed:", err);
    res.status(500).json({ message: "Anomaly detection run failed" });
  }
});

export default router;
