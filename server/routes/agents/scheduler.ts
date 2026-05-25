// Scheduler status and manual trigger routes.
// GET  /scheduler/status   → next/last run times and error log
// POST /scheduler/trigger  → manual job trigger for testing

import { Router } from "express";
import { getSchedulerStatus, runDailyJob, runWeeklyJob } from "../../orchestrator/scheduler";

const router = Router();

// GET /scheduler/status
router.get("/scheduler/status", (_req, res) => {
  return res.json(getSchedulerStatus());
});

// POST /scheduler/trigger
// Body: { job: 'daily' | 'weekly', tenantId?: string }
// Runs asynchronously; responds immediately with acknowledgement.
router.post("/scheduler/trigger", async (req, res) => {
  const { job, tenantId } = req.body as { job?: string; tenantId?: string };

  if (job !== "daily" && job !== "weekly") {
    return res.status(400).json({ error: "job must be 'daily' or 'weekly'" });
  }

  // Respond immediately — job runs in background
  res.json({ ok: true, message: `${job} job triggered${tenantId ? ` for tenant ${tenantId}` : " for all tenants"}` });

  // Fire-and-forget with top-level catch so the process never crashes
  const runner = job === "daily" ? runDailyJob : runWeeklyJob;
  runner(tenantId).catch((err) => {
    console.error(`[routes/scheduler] triggered ${job} job error:`, err);
  });
});

export default router;
