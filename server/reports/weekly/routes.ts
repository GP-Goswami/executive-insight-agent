// Weekly Report API — mounted at /api/reports/weekly (see server/routes.ts).
//   GET  /                 ?tenantId=  → latest weekly report content for dashboard
//   POST /run              { tenantId } → build a fresh weekly report (agent A10)
//   GET  /pdf              ?tenantId=  → stream the weekly PDF (saved under generated-reports/weekly/)

import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { reportDrafts } from "@shared/schema";
import { runWeeklyReport, WeeklyReportAgent, type WeeklyReportContent } from "./weekly-builder";
import { resolveProperty } from "../shared/report-data";
import { saveWeeklyPdf } from "./weekly-pdf";
import { agentRunRateLimit } from "../../routes/agents/rate-limit";

const router = Router();

/** Newest weekly draft that uses the current (meta-bearing) content shape. */
async function latestWeeklyContent(tenantId: string): Promise<WeeklyReportContent | null> {
  const [row] = await db
    .select()
    .from(reportDrafts)
    .where(and(eq(reportDrafts.tenantId, tenantId), eq(reportDrafts.reportType, "weekly")))
    .orderBy(desc(reportDrafts.createdAt))
    .limit(1);
  const content = row?.content as WeeklyReportContent | undefined;
  if (content && content.meta && content.trafficSnapshot) return content;
  return null;
}

router.get("/", async (req, res) => {
  try {
    const tenantId = req.query.tenantId as string;
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });
    const content = await latestWeeklyContent(tenantId);
    if (!content) return res.json({ exists: false });
    return res.json({ exists: true, content });
  } catch (err) {
    console.error("[reports/weekly] GET / error:", err);
    return res.status(500).json({ error: "Failed to load weekly report" });
  }
});

router.post("/run", agentRunRateLimit, async (req, res) => {
  try {
    const tenantId = (req.body?.tenantId ?? req.query.tenantId) as string | undefined;
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });
    const result = await runWeeklyReport(tenantId);
    if (result.status === "failed") return res.status(500).json({ error: result.error ?? "Weekly report failed" });
    return res.json(result.findings);
  } catch (err) {
    console.error("[reports/weekly] POST /run error:", err);
    return res.status(500).json({ error: "Weekly report run failed" });
  }
});

router.get("/pdf", async (req, res) => {
  try {
    const tenantId = req.query.tenantId as string;
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    let content = await latestWeeklyContent(tenantId);
    if (!content) {
      // No draft yet — assemble one on the fly (does not persist a draft row).
      const prop = await resolveProperty(tenantId);
      if (!prop) return res.status(404).json({ error: "No property or data found for tenant" });
      content = await new WeeklyReportAgent().assemble(prop, tenantId);
    }

    const { buffer, fileName } = await saveWeeklyPdf(content);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Length", buffer.length);
    return res.end(buffer);
  } catch (err) {
    console.error("[reports/weekly] GET /pdf error:", err);
    return res.status(500).json({ error: "Failed to generate weekly PDF" });
  }
});

export default router;
