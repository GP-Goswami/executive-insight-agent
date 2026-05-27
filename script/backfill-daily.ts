// One-time backfill: pull real daily GA4 + GSC data into the daily tables
// (ga4_daily_metrics, gsc_daily) that the A08/A09 agents read from. The normal
// app flow caches range-aggregated snapshots in ga4_data/gsc_data but never
// accumulates a per-day series, so anomaly detection had no history to analyse.
//
// Usage:  tsx script/backfill-daily.ts <ga4PropertyId> [days]
//   e.g.  tsx script/backfill-daily.ts 313557312 90

import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { properties, ga4DailyMetrics, gscDaily } from "@shared/schema";
import { getGA4DailyTraffic, getSearchConsoleClient } from "../server/lib/google-apis";

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const ga4PropertyId = process.argv[2] || "313557312";
  const days = parseInt(process.argv[3] || "90", 10);

  // GSC final data lags ~3 days; end the window there so every day is complete.
  const end = new Date();
  end.setDate(end.getDate() - 3);
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  const startStr = ymd(start);
  const endStr = ymd(end);

  console.log(`[backfill] ga4PropertyId=${ga4PropertyId}, window ${startStr} → ${endStr}`);

  // Resolve internal property UUID (daily tables are keyed by it, not the GA4 id).
  const [prop] = await db.select().from(properties).where(eq(properties.ga4PropertyId, ga4PropertyId)).limit(1);
  if (!prop) {
    throw new Error(`No properties row with ga4_property_id=${ga4PropertyId}. Open the dashboard for that domain once so it is auto-created.`);
  }
  console.log(`[backfill] resolved property "${prop.name}" → ${prop.id}`);

  // ── GA4 daily ───────────────────────────────────────────────────────────────
  const ga4Days = await getGA4DailyTraffic(ga4PropertyId, startStr, endStr);
  console.log(`[backfill] GA4 returned ${ga4Days.length} days`);

  // Clear existing rows for a clean per-day aggregate (avoids double-counting the
  // sparse per-page rows the old flow left behind).
  await db.delete(ga4DailyMetrics).where(eq(ga4DailyMetrics.propertyId, prop.id));
  if (ga4Days.length > 0) {
    await db.insert(ga4DailyMetrics).values(
      ga4Days.map((d) => ({
        date: new Date(d.date),
        propertyId: prop.id,
        totalUsers: d.users,
        sessions: d.sessions,
        conversions: d.pageviews, // GA4 daily endpoint exposes pageviews as the volume proxy
      })),
    );
  }
  console.log(`[backfill] wrote ${ga4Days.length} GA4 daily rows`);

  // ── GSC daily ─────────────────────────────────────────────────────────────────
  const siteUrl = prop.gscSiteUrl || "https://www.truefirms.co/";
  let gscCount = 0;
  try {
    const client = await getSearchConsoleClient();
    if (!client) throw new Error("GSC client not configured");
    const res = await client.searchanalytics.query({
      siteUrl,
      requestBody: { startDate: startStr, endDate: endStr, dimensions: ["date"], rowLimit: 400, dataState: "final" },
    });
    const rows = res.data.rows ?? [];
    await db.delete(gscDaily).where(eq(gscDaily.propertyId, prop.id));
    if (rows.length > 0) {
      await db.insert(gscDaily).values(
        rows.map((r) => ({
          date: new Date(r.keys?.[0] || endStr),
          propertyId: prop.id,
          clicks: Math.round(r.clicks || 0),
          impressions: Math.round(r.impressions || 0),
          ctr: String(r.ctr ?? 0),
          avgPosition: String(r.position ?? 0),
        })),
      );
    }
    gscCount = rows.length;
    // Persist the resolved site URL so the dashboard/agents can find it next time.
    if (!prop.gscSiteUrl) {
      await db.update(properties).set({ gscSiteUrl: siteUrl }).where(eq(properties.id, prop.id));
      console.log(`[backfill] set properties.gsc_site_url = ${siteUrl}`);
    }
  } catch (err) {
    console.warn(`[backfill] GSC daily skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
  console.log(`[backfill] wrote ${gscCount} GSC daily rows`);

  console.log("[backfill] done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[backfill] FAILED:", err);
  process.exit(1);
});
