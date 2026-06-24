// Monthly Report API — mounted at /api/reports/monthly (see server/routes.ts).
//   GET  /                 ?tenantId=  → latest monthly report content for dashboard
//   POST /run              { tenantId } → build a fresh monthly report (agent A14)
//   GET  /pdf              ?tenantId=  → stream the monthly PDF (saved under generated-reports/monthly/)

import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { reportDrafts } from "@shared/schema";
import { runMonthlyReport, MonthlyReportAgent, type MonthlyReportContent } from "./monthly-builder";
import { resolveProperty } from "../shared/report-data";
import { saveMonthlyPdf } from "./monthly-pdf";
import { agentRunRateLimit } from "../../routes/agents/rate-limit";

const router = Router();

async function latestMonthlyContent(tenantId: string): Promise<MonthlyReportContent | null> {
  const [row] = await db
    .select()
    .from(reportDrafts)
    .where(and(eq(reportDrafts.tenantId, tenantId), eq(reportDrafts.reportType, "monthly")))
    .orderBy(desc(reportDrafts.createdAt))
    .limit(1);
  const content = row?.content as MonthlyReportContent | undefined;
  if (content && content.meta && Array.isArray(content.kpis)) return content;
  return null;
}

router.get("/", async (req, res) => {
  try {
    const tenantId = req.query.tenantId as string;
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });
    const content = await latestMonthlyContent(tenantId);
    if (!content) return res.json({ exists: false });
    return res.json({ exists: true, content });
  } catch (err) {
    console.error("[reports/monthly] GET / error:", err);
    return res.status(500).json({ error: "Failed to load monthly report" });
  }
});

router.post("/run", agentRunRateLimit, async (req, res) => {
  try {
    const tenantId = (req.body?.tenantId ?? req.query.tenantId) as string | undefined;
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    // Optional explicit window (yyyy-MM-dd) + GSC site URL override from the dashboard.
    const { start, end, gscSiteUrl } = (req.body ?? {}) as { start?: string; end?: string; gscSiteUrl?: string };
    const ymdRe = /^\d{4}-\d{2}-\d{2}$/;
    const hasRange = !!(start && end && ymdRe.test(start) && ymdRe.test(end));
    const opts = hasRange || gscSiteUrl
      ? { ...(hasRange ? { start, end } : {}), ...(gscSiteUrl ? { gscSiteUrl } : {}) }
      : undefined;

    const result = await runMonthlyReport(tenantId, opts);
    if (result.status === "failed") return res.status(500).json({ error: result.error ?? "Monthly report failed" });
    return res.json(result.findings);
  } catch (err) {
    console.error("[reports/monthly] POST /run error:", err);
    return res.status(500).json({ error: "Monthly report run failed" });
  }
});

router.get("/pdf", async (req, res) => {
  try {
    const tenantId = req.query.tenantId as string;
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    let content = await latestMonthlyContent(tenantId);
    if (!content) {
      const prop = await resolveProperty(tenantId);
      if (!prop) return res.status(404).json({ error: "No property or data found for tenant" });
      content = await new MonthlyReportAgent().assemble(prop, tenantId);
    }

    const { buffer, fileName } = await saveMonthlyPdf(content);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Length", buffer.length);
    return res.end(buffer);
  } catch (err) {
    console.error("[reports/monthly] GET /pdf error:", err);
    return res.status(500).json({ error: "Failed to generate monthly PDF" });
  }
});

export default router;
