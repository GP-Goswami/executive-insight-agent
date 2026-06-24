// Shared live-data snapshot for the weekly + monthly report builders.
//
// The synced daily tables (ga4DailyMetrics, gscDaily) are often partial or
// missing for a property (GSC especially is frequently never synced), which
// makes report KPIs read 0 and MoM/WoW deltas wrong. These helpers prefer the
// LIVE GA4/GSC APIs — which always return complete, equally-measured windows —
// and fall back to the DB only when an API id is missing or the call fails.
//
// Calling existing google-apis functions is allowed (we never modify them).

import {
  loadGa4Totals,
  loadGscTotals,
  buildDelta,
  type ResolvedProperty,
  type PeriodRange,
  type TrafficSnapshot,
} from "./report-data";
import { getGSCSummary, getGA4Metrics } from "../../lib/google-apis";

type Ga4Totals = Awaited<ReturnType<typeof loadGa4Totals>>;
type GscTotals = Awaited<ReturnType<typeof loadGscTotals>>;

const tag = "[live-snapshot]";

/** GA4 totals for a period — live first (full window), DB fallback. */
export async function loadGa4Live(prop: ResolvedProperty, p: PeriodRange): Promise<Ga4Totals> {
  if (prop.ga4PropertyId) {
    try {
      const live = await getGA4Metrics(prop.ga4PropertyId, p.start, p.end);
      return {
        users: live.totalUsers,
        sessions: live.sessions,
        conversions: live.conversions,
        engagedSessions: Math.round(live.sessions * (live.engagementRate ?? 0)),
      };
    } catch (err) {
      console.warn(`${tag} GA4 live failed ${p.start}..${p.end}, using DB:`, err instanceof Error ? err.message : err);
    }
  }
  return loadGa4Totals(prop.propertyId, p);
}

/** GSC totals for a period — live first (full window), DB fallback. */
export async function loadGscLive(prop: ResolvedProperty, p: PeriodRange): Promise<GscTotals> {
  if (prop.gscSiteUrl) {
    try {
      const live = await getGSCSummary(prop.gscSiteUrl, p.start, p.end);
      console.log(`${tag} GSC ${p.start}..${p.end} [${prop.gscSiteUrl}]: ${live.clicks ?? 0} clicks / ${live.impressions ?? 0} impr`);
      return {
        clicks: live.clicks ?? 0,
        impressions: live.impressions ?? 0,
        ctr: live.ctr ?? 0,
        avgPosition: live.position ?? 0,
      };
    } catch (err) {
      console.warn(`${tag} GSC live failed ${p.start}..${p.end} [${prop.gscSiteUrl}], using DB:`, err instanceof Error ? err.message : err);
    }
  } else {
    console.warn(`${tag} GSC skipped ${p.start}..${p.end}: no gscSiteUrl configured`);
  }
  return loadGscTotals(prop.propertyId, p);
}

/** Full GA4 + GSC snapshot with deltas between two periods, both fetched live. */
export async function liveSnapshot(
  prop: ResolvedProperty,
  current: PeriodRange,
  comparison: PeriodRange,
): Promise<TrafficSnapshot> {
  const [ga4Cur, ga4Prev, gscCur, gscPrev] = await Promise.all([
    loadGa4Live(prop, current),
    loadGa4Live(prop, comparison),
    loadGscLive(prop, current),
    loadGscLive(prop, comparison),
  ]);
  return {
    users: buildDelta(ga4Cur.users, ga4Prev.users),
    sessions: buildDelta(ga4Cur.sessions, ga4Prev.sessions),
    conversions: buildDelta(ga4Cur.conversions, ga4Prev.conversions),
    engagedSessions: buildDelta(ga4Cur.engagedSessions, ga4Prev.engagedSessions),
    clicks: buildDelta(gscCur.clicks, gscPrev.clicks),
    impressions: buildDelta(gscCur.impressions, gscPrev.impressions),
    ctr: buildDelta(gscCur.ctr, gscPrev.ctr),
    avgPosition: buildDelta(gscCur.avgPosition, gscPrev.avgPosition),
  };
}

/** Resolve the effective property, applying an optional GSC site URL override
 *  (the dashboard usually knows the GSC URL even when the property record doesn't). */
export function withGscOverride(prop: ResolvedProperty, gscSiteUrl?: string): ResolvedProperty {
  return { ...prop, gscSiteUrl: gscSiteUrl || prop.gscSiteUrl };
}
