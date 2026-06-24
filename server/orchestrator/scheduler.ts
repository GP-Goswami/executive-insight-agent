// Agent Scheduler — node-cron wrapper for all recurring agent jobs.
//
// Schedules:
//   Daily  3 AM  → A08 anomaly detection for all active tenants
//   Weekly Mon 4 AM → A09 + A10 for all active tenants; A10 drafts → qa_review
//
// Rules:
//   - Scheduler failure NEVER crashes the server (all errors caught internally)
//   - Individual tenant failures are logged but don't stop remaining tenants
//   - Tenant list is fetched fresh on every job run (new tenants picked up automatically)

import cron from "node-cron";
import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "../db";
import { properties, clients, agentRuns, reportDrafts } from "@shared/schema";
import { runAnomalyDetection } from "../agents/anomaly-detection";
import { runRecommendationSynthesis } from "../agents/recommendation-synthesis";
import { runReportComposition } from "../agents/report-composition";
import { runWeeklyReport } from "../reports/weekly/weekly-builder";
import { runMonthlyReport } from "../reports/monthly/monthly-builder";

// ── State (in-memory; reset on restart) ──────────────────────────────────────

interface JobState {
  lastRun: Date | null;
  lastStatus: "success" | "partial" | "failed" | "never";
  nextRun: Date | null;
  tenantsProcessed: number;
  errors: string[];
}

const state: Record<"daily" | "weekly", JobState> = {
  daily: { lastRun: null, lastStatus: "never", nextRun: null, tenantsProcessed: 0, errors: [] },
  weekly: { lastRun: null, lastStatus: "never", nextRun: null, tenantsProcessed: 0, errors: [] },
};

// ── Tenant resolution ─────────────────────────────────────────────────────────

/** Returns the property IDs of all active tenants (clients with status="active"). */
async function getActiveTenantIds(): Promise<string[]> {
  const rows = await db
    .select({ propertyId: properties.id })
    .from(properties)
    .innerJoin(clients, eq(properties.clientId, clients.id))
    .where(eq(clients.status, "active"));

  const ids = rows.map((r) => r.propertyId).filter(Boolean);

  // Always include the richest GA4 property as a fallback so single-tenant
  // setups (no client row yet) still get processed.
  if (ids.length === 0) {
    const { ga4DailyMetrics } = await import("@shared/schema");
    const { sql } = await import("drizzle-orm");
    const [richest] = await db
      .select({ propertyId: ga4DailyMetrics.propertyId })
      .from(ga4DailyMetrics)
      .groupBy(ga4DailyMetrics.propertyId)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(1);
    if (richest?.propertyId) return [richest.propertyId];
  }

  return ids;
}

// ── Job: Daily (A08) ──────────────────────────────────────────────────────────

export async function runDailyJob(tenantId?: string): Promise<void> {
  const jobName = "daily";
  const tenants = tenantId ? [tenantId] : await getActiveTenantIds();

  console.log(`[scheduler:${jobName}] starting — ${tenants.length} tenant(s)`);
  state[jobName].lastRun = new Date();
  state[jobName].errors = [];
  let processed = 0;

  for (const tid of tenants) {
    try {
      const result = await runAnomalyDetection(tid);
      if (result.status === "failed") {
        state[jobName].errors.push(`A08 tenant ${tid}: ${result.error ?? "unknown error"}`);
      } else {
        processed++;
        console.log(`[scheduler:${jobName}] A08 OK for tenant ${tid}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      state[jobName].errors.push(`A08 tenant ${tid}: ${msg}`);
      console.error(`[scheduler:${jobName}] A08 FAILED for tenant ${tid}: ${msg}`);
    }
  }

  state[jobName].tenantsProcessed = processed;
  state[jobName].lastStatus =
    processed === tenants.length ? "success" : processed > 0 ? "partial" : "failed";

  console.log(
    `[scheduler:${jobName}] done — ${processed}/${tenants.length} OK` +
      (state[jobName].errors.length ? `, ${state[jobName].errors.length} error(s)` : ""),
  );
}

// ── Job: Weekly (A09 + A10) ───────────────────────────────────────────────────

export async function runWeeklyJob(tenantId?: string): Promise<void> {
  const jobName = "weekly";
  const tenants = tenantId ? [tenantId] : await getActiveTenantIds();

  console.log(`[scheduler:${jobName}] starting — ${tenants.length} tenant(s)`);
  state[jobName].lastRun = new Date();
  state[jobName].errors = [];
  let processed = 0;

  for (const tid of tenants) {
    try {
      // A09 — recommendations
      const a09 = await runRecommendationSynthesis(tid);
      if (a09.status === "failed") {
        state[jobName].errors.push(`A09 tenant ${tid}: ${a09.error ?? "unknown"}`);
        console.error(`[scheduler:${jobName}] A09 FAILED for tenant ${tid}`);
        // Continue to A10 anyway — it can run from cached scratchpad
      } else {
        console.log(`[scheduler:${jobName}] A09 OK for tenant ${tid}`);
      }

      // A10 — report composition
      const a10 = await runReportComposition(tid);
      if (a10.status === "failed") {
        state[jobName].errors.push(`A10 tenant ${tid}: ${a10.error ?? "unknown"}`);
        console.error(`[scheduler:${jobName}] A10 FAILED for tenant ${tid}`);
      } else {
        console.log(`[scheduler:${jobName}] A10 OK for tenant ${tid}`);

        // Advance the new draft straight to qa_review so it surfaces in the queue
        const draftId = (a10.findings as { reportDraftId?: string })?.reportDraftId;
        if (draftId) {
          await db
            .update(reportDrafts)
            .set({ status: "qa_review" })
            .where(eq(reportDrafts.id, draftId));
          console.log(`[scheduler:${jobName}] draft ${draftId} → qa_review`);
        }
        processed++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      state[jobName].errors.push(`tenant ${tid}: ${msg}`);
      console.error(`[scheduler:${jobName}] FAILED for tenant ${tid}: ${msg}`);
    }
  }

  state[jobName].tenantsProcessed = processed;
  state[jobName].lastStatus =
    processed === tenants.length ? "success" : processed > 0 ? "partial" : "failed";

  console.log(
    `[scheduler:${jobName}] done — ${processed}/${tenants.length} OK` +
      (state[jobName].errors.length ? `, ${state[jobName].errors.length} error(s)` : ""),
  );
}

// ── Job: Weekly Strategic Report (last complete week) ─────────────────────────
// Fired Monday morning → generates the just-finished week's report per tenant.
export async function runWeeklyReportJob(tenantId?: string): Promise<void> {
  const tenants = tenantId ? [tenantId] : await getActiveTenantIds();
  console.log(`[scheduler:weeklyReport] starting — ${tenants.length} tenant(s)`);
  for (const tid of tenants) {
    try {
      const r = await runWeeklyReport(tid);
      if (r.status === "failed") console.error(`[scheduler:weeklyReport] tenant ${tid} failed: ${r.error}`);
      else console.log(`[scheduler:weeklyReport] tenant ${tid} OK`);
    } catch (err) {
      console.error(`[scheduler:weeklyReport] tenant ${tid} error:`, err instanceof Error ? err.message : err);
    }
  }
  console.log("[scheduler:weeklyReport] done");
}

// ── Job: Monthly Strategic Report (last complete calendar month) ──────────────
// Fired on the 1st of each month → generates the previous month's report.
export async function runMonthlyReportJob(tenantId?: string): Promise<void> {
  const tenants = tenantId ? [tenantId] : await getActiveTenantIds();
  console.log(`[scheduler:monthlyReport] starting — ${tenants.length} tenant(s)`);
  for (const tid of tenants) {
    try {
      const r = await runMonthlyReport(tid);
      if (r.status === "failed") console.error(`[scheduler:monthlyReport] tenant ${tid} failed: ${r.error}`);
      else console.log(`[scheduler:monthlyReport] tenant ${tid} OK`);
    } catch (err) {
      console.error(`[scheduler:monthlyReport] tenant ${tid} error:`, err instanceof Error ? err.message : err);
    }
  }
  console.log("[scheduler:monthlyReport] done");
}

// ── Stale-run sweeper ─────────────────────────────────────────────────────────
// A run row stuck in "running" past this many minutes is almost certainly orphaned
// (server restarted mid-run, or the agent process was interrupted). Mark it failed
// so it stops showing as "running" forever in Live Runs / agent pages.
const STALE_RUN_MINUTES = 15;

export async function sweepStaleRuns(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_RUN_MINUTES * 60_000);
  try {
    const updated = await db
      .update(agentRuns)
      .set({
        status: "failed",
        completedAt: new Date(),
        error: `Stale run — exceeded ${STALE_RUN_MINUTES} min without completing (server restart or interrupted execution).`,
      })
      .where(and(eq(agentRuns.status, "running"), lt(agentRuns.startedAt, cutoff)))
      .returning({ id: agentRuns.id });

    if (updated.length > 0) {
      console.log(`[scheduler:sweep] marked ${updated.length} stale run(s) as failed`);
    }
    return updated.length;
  } catch (err) {
    console.error("[scheduler:sweep] failed to sweep stale runs:", err);
    return 0;
  }
}

// ── Next-run helpers ──────────────────────────────────────────────────────────

function nextDailyRun(): Date {
  const d = new Date();
  d.setHours(3, 0, 0, 0);
  if (d <= new Date()) d.setDate(d.getDate() + 1);
  return d;
}

function nextWeeklyRun(): Date {
  const d = new Date();
  d.setHours(4, 0, 0, 0);
  // Advance to next Monday
  const day = d.getDay(); // 0=Sun … 6=Sat
  const daysUntilMonday = day === 1 && d > new Date() ? 0 : (8 - day) % 7 || 7;
  d.setDate(d.getDate() + daysUntilMonday);
  return d;
}

// ── Scheduler init ────────────────────────────────────────────────────────────

export function initScheduler(): void {
  state.daily.nextRun = nextDailyRun();
  state.weekly.nextRun = nextWeeklyRun();

  // Clear any runs orphaned by the previous process (e.g. server restarted
  // mid-run), then keep sweeping every 10 minutes.
  sweepStaleRuns().catch((err) => console.error("[scheduler:sweep] startup sweep error:", err));
  cron.schedule("*/10 * * * *", async () => {
    try {
      await sweepStaleRuns();
    } catch (err) {
      console.error("[scheduler:sweep] cron error:", err);
    }
  });

  // Daily 3 AM — A08
  cron.schedule("0 3 * * *", async () => {
    state.daily.nextRun = nextDailyRun();
    try {
      await runDailyJob();
    } catch (err) {
      // Belt-and-suspenders: runDailyJob already catches per-tenant, but guard
      // the cron callback itself so node-cron never sees an unhandled rejection.
      console.error("[scheduler:daily] unhandled error:", err);
    }
  });

  // Weekly Monday 4 AM — A09 + A10
  cron.schedule("0 4 * * 1", async () => {
    state.weekly.nextRun = nextWeeklyRun();
    try {
      await runWeeklyJob();
    } catch (err) {
      console.error("[scheduler:weekly] unhandled error:", err);
    }
  });

  // Weekly Strategic Report — Monday 6 AM (the week that just finished)
  cron.schedule("0 6 * * 1", async () => {
    try {
      await runWeeklyReportJob();
    } catch (err) {
      console.error("[scheduler:weeklyReport] unhandled error:", err);
    }
  });

  // Monthly Strategic Report — 1st of each month 5 AM (the month that just finished)
  cron.schedule("0 5 1 * *", async () => {
    try {
      await runMonthlyReportJob();
    } catch (err) {
      console.error("[scheduler:monthlyReport] unhandled error:", err);
    }
  });

  console.log("[scheduler] Scheduler initialized — daily 3AM, weekly Mon 4AM, weekly-report Mon 6AM, monthly-report 1st 5AM");
}

// ── Status export (for the status route) ─────────────────────────────────────

export function getSchedulerStatus() {
  return {
    daily: {
      cron: "0 3 * * *",
      description: "A08 Anomaly Detection — all tenants",
      nextRun: state.daily.nextRun?.toISOString() ?? null,
      lastRun: state.daily.lastRun?.toISOString() ?? null,
      lastStatus: state.daily.lastStatus,
      tenantsProcessed: state.daily.tenantsProcessed,
      errors: state.daily.errors,
    },
    weekly: {
      cron: "0 4 * * 1",
      description: "A09 Recommendations + A10 Report Composition — all tenants",
      nextRun: state.weekly.nextRun?.toISOString() ?? null,
      lastRun: state.weekly.lastRun?.toISOString() ?? null,
      lastStatus: state.weekly.lastStatus,
      tenantsProcessed: state.weekly.tenantsProcessed,
      errors: state.weekly.errors,
    },
  };
}
