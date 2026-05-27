// Shared report data layer for the Weekly (server/reports/weekly) and Monthly
// (server/reports/monthly) report builders.
//
// Design: traffic snapshot + period deltas + daily series are read from the
// backfilled daily tables (ga4_daily_metrics, gsc_daily) so generation is fast
// and deterministic. Enrichment sections (content highlights, ranking movement,
// backlinks, AEO) try the live APIs and degrade gracefully to the cache tables
// (ga4_data, gsc_data) or labelled placeholders — every loader is independently
// fault-isolated so one missing provider never fails the whole report.

import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  ga4DailyMetrics,
  gscDaily,
  ga4Data,
  gscData,
  recommendations,
  agentRuns,
  properties,
} from "@shared/schema";
import { getGA4TopPages, getGSCTable, getGA4AIReferrers } from "../../lib/google-apis";
import { getDomainMetrics } from "../../lib/dataforseo";

// ── Types ───────────────────────────────────────────────────────────────────

export interface PeriodRange {
  start: string; // yyyy-MM-dd inclusive
  end: string; // yyyy-MM-dd inclusive
  label: string;
}

export interface MetricDelta {
  current: number;
  previous: number;
  /** Percentage change vs previous; null when previous is 0 or unavailable. */
  deltaPct: number | null;
  deltaAbs: number;
}

export interface TrafficSnapshot {
  users: MetricDelta;
  sessions: MetricDelta;
  conversions: MetricDelta;
  engagedSessions: MetricDelta;
  clicks: MetricDelta;
  impressions: MetricDelta;
  ctr: MetricDelta; // percentage points (e.g. 2.31 = 2.31%)
  avgPosition: MetricDelta; // lower is better
}

export interface DailyPoint {
  date: string;
  users: number;
  sessions: number;
  clicks: number;
  impressions: number;
}

export interface RankingMovementRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  prevPosition: number | null;
  positionDelta: number | null; // positive = improved (moved up)
}

export interface ContentRow {
  page: string;
  users: number;
  sessions: number;
  conversions: number;
}

export interface BacklinkSummary {
  configured: boolean;
  backlinks: number;
  referringDomains: number;
  domainRank: number;
  note?: string;
}

export interface AeoSnapshot {
  configured: boolean;
  totalAiUsers: number;
  sources: Array<{ source: string; users: number; sessions: number }>;
  note?: string;
}

export interface TechnicalHealth {
  score: number; // 0-100
  status: "Healthy" | "Needs Attention" | "Critical";
  signals: Array<{ label: string; value: string; status: "good" | "warn" | "bad" }>;
}

export interface RecommendationRow {
  priority: number;
  statement: string;
  effort: string;
  impact: string;
  ownerRole: string;
}

export interface ResolvedProperty {
  propertyId: string; // internal UUID (keys the daily tables)
  ga4PropertyId: string;
  gscSiteUrl: string;
  name: string;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function dayStart(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}
function dayEnd(s: string): Date {
  return new Date(`${s}T23:59:59.999Z`);
}

// ── Property resolution ───────────────────────────────────────────────────────

/** Resolve a tenant id (internal UUID or GA4 property id) to a full property. */
export async function resolveProperty(tenantId: string): Promise<ResolvedProperty | null> {
  let [row] = await db.select().from(properties).where(eq(properties.id, tenantId)).limit(1);
  if (!row) {
    [row] = await db.select().from(properties).where(eq(properties.ga4PropertyId, tenantId)).limit(1);
  }
  if (!row) {
    // Fall back to the property holding the most GA4 daily data.
    const [richest] = await db
      .select({ propertyId: ga4DailyMetrics.propertyId })
      .from(ga4DailyMetrics)
      .groupBy(ga4DailyMetrics.propertyId)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(1);
    if (richest?.propertyId) {
      [row] = await db.select().from(properties).where(eq(properties.id, richest.propertyId)).limit(1);
    }
  }
  if (!row) return null;
  return {
    propertyId: row.id,
    ga4PropertyId: row.ga4PropertyId ?? "",
    gscSiteUrl: row.gscSiteUrl ?? "",
    name: row.name,
  };
}

/** Latest date with GA4 daily data for this property (anchors the report window). */
export async function getMaxDataDate(propertyId: string): Promise<Date> {
  const [r] = await db
    .select({ maxDate: sql<string | null>`MAX(${ga4DailyMetrics.date})::date::text` })
    .from(ga4DailyMetrics)
    .where(eq(ga4DailyMetrics.propertyId, propertyId));
  if (r?.maxDate) return new Date(`${r.maxDate}T00:00:00.000Z`);
  // No data: anchor 3 days back (GSC processing lag) so live calls still align.
  return addDays(new Date(), -3);
}

// ── Period builders ───────────────────────────────────────────────────────────

export function buildWeeklyPeriods(maxDate: Date): { current: PeriodRange; previous: PeriodRange } {
  const curEnd = maxDate;
  const curStart = addDays(curEnd, -6);
  const prevEnd = addDays(curStart, -1);
  const prevStart = addDays(prevEnd, -6);
  return {
    current: { start: ymd(curStart), end: ymd(curEnd), label: "This week" },
    previous: { start: ymd(prevStart), end: ymd(prevEnd), label: "Previous week" },
  };
}

export function buildMonthlyPeriods(
  maxDate: Date,
): { current: PeriodRange; previous: PeriodRange; yearAgo: PeriodRange } {
  const curEnd = maxDate;
  const curStart = addDays(curEnd, -29);
  const prevEnd = addDays(curStart, -1);
  const prevStart = addDays(prevEnd, -29);
  const yaEnd = addDays(curEnd, -365);
  const yaStart = addDays(curStart, -365);
  return {
    current: { start: ymd(curStart), end: ymd(curEnd), label: "This month" },
    previous: { start: ymd(prevStart), end: ymd(prevEnd), label: "Previous month" },
    yearAgo: { start: ymd(yaStart), end: ymd(yaEnd), label: "Same month last year" },
  };
}

// ── Summaries from the daily tables ─────────────────────────────────────────────

interface Ga4Totals {
  users: number;
  sessions: number;
  conversions: number;
  engagedSessions: number;
}
interface GscTotals {
  clicks: number;
  impressions: number;
  ctr: number; // %
  avgPosition: number;
}

export async function loadGa4Totals(propertyId: string, p: PeriodRange): Promise<Ga4Totals> {
  const [r] = await db
    .select({
      users: sql<number>`COALESCE(SUM(${ga4DailyMetrics.totalUsers}), 0)`,
      sessions: sql<number>`COALESCE(SUM(${ga4DailyMetrics.sessions}), 0)`,
      conversions: sql<number>`COALESCE(SUM(${ga4DailyMetrics.conversions}), 0)`,
      engagedSessions: sql<number>`COALESCE(SUM(${ga4DailyMetrics.engagedSessions}), 0)`,
    })
    .from(ga4DailyMetrics)
    .where(
      and(
        eq(ga4DailyMetrics.propertyId, propertyId),
        gte(ga4DailyMetrics.date, dayStart(p.start)),
        lte(ga4DailyMetrics.date, dayEnd(p.end)),
      ),
    );
  return {
    users: Number(r?.users ?? 0),
    sessions: Number(r?.sessions ?? 0),
    conversions: Number(r?.conversions ?? 0),
    engagedSessions: Number(r?.engagedSessions ?? 0),
  };
}

export async function loadGscTotals(propertyId: string, p: PeriodRange): Promise<GscTotals> {
  const [r] = await db
    .select({
      clicks: sql<number>`COALESCE(SUM(${gscDaily.clicks}), 0)`,
      impressions: sql<number>`COALESCE(SUM(${gscDaily.impressions}), 0)`,
      ctr: sql<number>`CASE WHEN SUM(${gscDaily.impressions}) > 0 THEN SUM(${gscDaily.clicks})::numeric / SUM(${gscDaily.impressions}) * 100 ELSE 0 END`,
      avgPosition: sql<number>`COALESCE(AVG(NULLIF(${gscDaily.avgPosition}, 0)), 0)`,
    })
    .from(gscDaily)
    .where(
      and(
        eq(gscDaily.propertyId, propertyId),
        gte(gscDaily.date, dayStart(p.start)),
        lte(gscDaily.date, dayEnd(p.end)),
      ),
    );
  return {
    clicks: Number(r?.clicks ?? 0),
    impressions: Number(r?.impressions ?? 0),
    ctr: Math.round(Number(r?.ctr ?? 0) * 100) / 100,
    avgPosition: Math.round(Number(r?.avgPosition ?? 0) * 10) / 10,
  };
}

export function buildDelta(current: number, previous: number): MetricDelta {
  const deltaAbs = Math.round((current - previous) * 100) / 100;
  const deltaPct =
    previous !== 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null;
  return { current, previous, deltaPct, deltaAbs };
}

/** Full traffic snapshot with deltas between two periods. */
export async function loadTrafficSnapshot(
  propertyId: string,
  current: PeriodRange,
  previous: PeriodRange,
): Promise<TrafficSnapshot> {
  const [ga4Cur, ga4Prev, gscCur, gscPrev] = await Promise.all([
    loadGa4Totals(propertyId, current),
    loadGa4Totals(propertyId, previous),
    loadGscTotals(propertyId, current),
    loadGscTotals(propertyId, previous),
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

/** Daily GA4 + GSC series for charts, joined by date over the period. */
export async function loadDailySeries(propertyId: string, p: PeriodRange): Promise<DailyPoint[]> {
  const ga4 = await db
    .select({
      date: sql<string>`${ga4DailyMetrics.date}::date::text`,
      users: sql<number>`COALESCE(SUM(${ga4DailyMetrics.totalUsers}), 0)`,
      sessions: sql<number>`COALESCE(SUM(${ga4DailyMetrics.sessions}), 0)`,
    })
    .from(ga4DailyMetrics)
    .where(
      and(
        eq(ga4DailyMetrics.propertyId, propertyId),
        gte(ga4DailyMetrics.date, dayStart(p.start)),
        lte(ga4DailyMetrics.date, dayEnd(p.end)),
      ),
    )
    .groupBy(sql`${ga4DailyMetrics.date}::date`)
    .orderBy(sql`${ga4DailyMetrics.date}::date`);

  const gsc = await db
    .select({
      date: sql<string>`${gscDaily.date}::date::text`,
      clicks: sql<number>`COALESCE(SUM(${gscDaily.clicks}), 0)`,
      impressions: sql<number>`COALESCE(SUM(${gscDaily.impressions}), 0)`,
    })
    .from(gscDaily)
    .where(
      and(
        eq(gscDaily.propertyId, propertyId),
        gte(gscDaily.date, dayStart(p.start)),
        lte(gscDaily.date, dayEnd(p.end)),
      ),
    )
    .groupBy(sql`${gscDaily.date}::date`)
    .orderBy(sql`${gscDaily.date}::date`);

  const byDate = new Map<string, DailyPoint>();
  for (const r of ga4) {
    byDate.set(r.date, { date: r.date, users: Number(r.users), sessions: Number(r.sessions), clicks: 0, impressions: 0 });
  }
  for (const r of gsc) {
    const existing = byDate.get(r.date) ?? { date: r.date, users: 0, sessions: 0, clicks: 0, impressions: 0 };
    existing.clicks = Number(r.clicks);
    existing.impressions = Number(r.impressions);
    byDate.set(r.date, existing);
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

// ── Content highlights (GA4 top pages) ──────────────────────────────────────────

export async function loadContentHighlights(
  prop: ResolvedProperty,
  p: PeriodRange,
  limit = 10,
): Promise<ContentRow[]> {
  if (prop.ga4PropertyId) {
    try {
      const live = await getGA4TopPages(prop.ga4PropertyId, p.start, p.end, limit);
      if (live.length > 0) return live;
    } catch {
      /* fall through to cache */
    }
  }
  // Cache fallback: most recent ga4_data top-pages snapshot.
  try {
    const [cached] = await db
      .select({ data: ga4Data.dataJson })
      .from(ga4Data)
      .where(and(eq(ga4Data.propertyId, prop.ga4PropertyId), sql`${ga4Data.endpoint} LIKE 'top-pages:%'`))
      .orderBy(desc(ga4Data.fetchedAt))
      .limit(1);
    const arr = (cached?.data as ContentRow[] | undefined) ?? [];
    return arr.slice(0, limit);
  } catch {
    return [];
  }
}

// ── Ranking movement (GSC queries, current vs previous position) ─────────────────

export async function loadRankingMovement(
  prop: ResolvedProperty,
  current: PeriodRange,
  previous: PeriodRange,
  limit = 15,
): Promise<RankingMovementRow[]> {
  if (!prop.gscSiteUrl) return [];
  try {
    const [cur, prev] = await Promise.all([
      getGSCTable(prop.gscSiteUrl, current.start, current.end, "query", 200),
      getGSCTable(prop.gscSiteUrl, previous.start, previous.end, "query", 200).catch(() => []),
    ]);
    const prevPos = new Map<string, number>();
    for (const row of prev as Array<{ query: string; position: number }>) {
      prevPos.set(row.query, row.position);
    }
    return (cur as Array<{ query: string; clicks: number; impressions: number; ctr: number; position: number }>)
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, limit)
      .map((row) => {
        const prevP = prevPos.has(row.query) ? prevPos.get(row.query)! : null;
        const positionDelta = prevP !== null ? Math.round((prevP - row.position) * 10) / 10 : null;
        return {
          query: row.query,
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          position: row.position,
          prevPosition: prevP,
          positionDelta,
        };
      });
  } catch {
    // Cache fallback: current snapshot only, no movement.
    try {
      const [cached] = await db
        .select({ data: gscData.dataJson })
        .from(gscData)
        .where(sql`${gscData.endpoint} LIKE 'queries:%'`)
        .orderBy(desc(gscData.fetchedAt))
        .limit(1);
      const arr = (cached?.data as Array<{ query: string; clicks: number; impressions: number; ctr: number; position: number }> | undefined) ?? [];
      return arr
        .sort((a, b) => b.clicks - a.clicks)
        .slice(0, limit)
        .map((row) => ({ ...row, prevPosition: null, positionDelta: null }));
    } catch {
      return [];
    }
  }
}

// ── Backlink summary (DataForSEO; placeholder when unconfigured) ──────────────────

export async function loadBacklinkSummary(domain: string): Promise<BacklinkSummary> {
  const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
  try {
    const m = await getDomainMetrics(cleanDomain);
    if (m) {
      return {
        configured: true,
        backlinks: m.backlinks ?? 0,
        referringDomains: m.referringDomains ?? 0,
        domainRank: (m as { domainRank?: number }).domainRank ?? 0,
      };
    }
  } catch {
    /* fall through to placeholder */
  }
  return {
    configured: false,
    backlinks: 0,
    referringDomains: 0,
    domainRank: 0,
    note: "Backlink provider not configured or unavailable — placeholder values shown.",
  };
}

// ── AEO snapshot (AI referrers; placeholder when none) ───────────────────────────

export async function loadAeoSnapshot(prop: ResolvedProperty, p: PeriodRange): Promise<AeoSnapshot> {
  if (prop.ga4PropertyId) {
    try {
      const refs = await getGA4AIReferrers(prop.ga4PropertyId, p.start, p.end);
      if (refs.length > 0) {
        return {
          configured: true,
          totalAiUsers: refs.reduce((s, r) => s + (r.users ?? 0), 0),
          sources: refs.map((r) => ({ source: r.source, users: r.users ?? 0, sessions: r.sessions ?? 0 })),
        };
      }
    } catch {
      /* fall through */
    }
  }
  return {
    configured: false,
    totalAiUsers: 0,
    sources: [],
    note: "No AI-assistant referral traffic detected this period (AEO tracking placeholder).",
  };
}

// ── Technical health (basic, derived from available signals) ─────────────────────

export function computeTechnicalHealth(snapshot: TrafficSnapshot): TechnicalHealth {
  const signals: TechnicalHealth["signals"] = [];
  let score = 100;

  // Indexation/visibility proxy: impressions present.
  if (snapshot.impressions.current > 0) {
    signals.push({ label: "Search indexation (impressions present)", value: snapshot.impressions.current.toLocaleString(), status: "good" });
  } else {
    signals.push({ label: "Search indexation (impressions present)", value: "none", status: "bad" });
    score -= 30;
  }

  // CTR health (target 2%+).
  const ctr = snapshot.ctr.current;
  if (ctr >= 2) signals.push({ label: "Click-through rate", value: `${ctr}%`, status: "good" });
  else if (ctr >= 0.8) { signals.push({ label: "Click-through rate", value: `${ctr}%`, status: "warn" }); score -= 10; }
  else { signals.push({ label: "Click-through rate", value: `${ctr}%`, status: "bad" }); score -= 20; }

  // Avg position health (target top 20).
  const pos = snapshot.avgPosition.current;
  if (pos > 0 && pos <= 20) signals.push({ label: "Average position", value: `${pos}`, status: "good" });
  else if (pos > 0 && pos <= 40) { signals.push({ label: "Average position", value: `${pos}`, status: "warn" }); score -= 10; }
  else if (pos > 40) { signals.push({ label: "Average position", value: `${pos}`, status: "bad" }); score -= 15; }
  else { signals.push({ label: "Average position", value: "n/a", status: "warn" }); score -= 5; }

  // Engagement health (engaged / sessions).
  const sessions = snapshot.sessions.current;
  const engaged = snapshot.engagedSessions.current;
  const engRate = sessions > 0 ? Math.round((engaged / sessions) * 100) : 0;
  if (engaged === 0) signals.push({ label: "Engagement signal", value: "not tracked", status: "warn" });
  else if (engRate >= 50) signals.push({ label: "Engaged-session rate", value: `${engRate}%`, status: "good" });
  else { signals.push({ label: "Engaged-session rate", value: `${engRate}%`, status: "warn" }); score -= 5; }

  score = Math.max(0, Math.min(100, score));
  const status: TechnicalHealth["status"] = score >= 75 ? "Healthy" : score >= 50 ? "Needs Attention" : "Critical";
  return { score, status, signals };
}

// ── Recommendations (latest A09 run from the DB) ─────────────────────────────────

export async function loadRecommendations(tenantId: string, limit = 5): Promise<RecommendationRow[]> {
  const [latest] = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(and(eq(agentRuns.agentId, "A09"), eq(agentRuns.tenantId, tenantId)))
    .orderBy(desc(agentRuns.startedAt))
    .limit(1);
  if (!latest) return [];
  const rows = await db
    .select()
    .from(recommendations)
    .where(eq(recommendations.runId, latest.id))
    .orderBy(recommendations.priority)
    .limit(limit);
  return rows.map((r, i) => ({
    priority: r.priority ?? i + 1,
    statement: r.statement,
    effort: r.effort ?? "medium",
    impact: r.impact ?? "medium",
    ownerRole: r.ownerRole ?? "strategy",
  }));
}

/** All agent run IDs for a tenant in a window — used for report appendices. */
export async function loadAgentRunIds(
  tenantId: string,
  limit = 40,
): Promise<Array<{ agentId: string; runId: string; status: string; startedAt: string | null }>> {
  const rows = await db
    .select({
      agentId: agentRuns.agentId,
      runId: agentRuns.id,
      status: agentRuns.status,
      startedAt: sql<string | null>`${agentRuns.startedAt}::text`,
    })
    .from(agentRuns)
    .where(eq(agentRuns.tenantId, tenantId))
    .orderBy(desc(agentRuns.startedAt))
    .limit(limit);
  return rows;
}
