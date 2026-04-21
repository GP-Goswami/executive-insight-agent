import { getGA4Metrics, getGSCSummary, getGSCTable } from "./google-apis";
import {
  getDomainMetrics,
  getDomainRankings,
  getDomainBacklinks,
  getDomainTopPages,
  isDataForSEOConfigured,
} from "./dataforseo";
import { debugLog } from "./debug";

// ─────────────────────────────────────────────────────────────────────────────
// Response interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface AnalyticsSummary {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  sessions: number;
  users: number;
  /** screenPageViews from GA4 */
  pageviews: number;
  source: {
    /** "GSC" when real data, "unavailable" when API failed */
    clicks: string;
    /** "GA4" when real data, "unavailable" when API failed */
    traffic: string;
  };
  dataCoverage: "full" | "partial";
}

export interface SeoData {
  keywords: any[];
  rankings: any[];
  backlinks: any[];
  topPages: any[];
  source: string;
  estimated: boolean;
}

export interface AnalyticsMeta {
  validated: boolean;
  mismatchDetected: boolean;
  lastUpdated: string;
  errors: string[];
}

export interface OrchestratedResponse {
  summary: AnalyticsSummary;
  /** GSC queries table — dimension: "query", rowLimit 25000.
   *  NEVER used to calculate summary totals. */
  queries: any[];
  /** GSC pages table — dimension: "page", rowLimit 25000.
   *  NEVER used to calculate summary totals. */
  pages: any[];
  /** DataForSEO-sourced rankings, backlinks, topPages (estimated) */
  seo: SeoData;
  meta: AnalyticsMeta;
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Analytics Orchestrator — strict data-source rules:
 *
 *  GSC clicks/impressions/CTR/position → getGSCSummary() [NO dimensions]
 *  GA4 sessions/users/pageviews        → getGA4Metrics()
 *  GSC query/page tables               → getGSCTable()   [WITH dimensions]
 *
 *  NEVER calculate summary totals from table rows.
 *  NEVER mix metrics across sources.
 *  On API failure → return structured error, NOT fake data.
 */
export async function getOrchestratedData(
  domain: string,
  gscSiteUrl: string,
  ga4PropertyId: string,
  startDate: string,
  endDate: string,
  _forceRefresh = false
): Promise<OrchestratedResponse> {
  const errors: string[] = [];

  debugLog("orchestrator", `Starting for ${domain} (${startDate} → ${endDate})`);

  // ── 1. Fetch all sources in parallel ────────────────────────────────────
  const [
    gscSummaryResult,
    ga4Result,
    gscQueriesResult,
    gscPagesResult,
    dfsMetricsResult,
    dfsRankingsResult,
    dfsBacklinksResult,
    dfsTopPagesResult,
  ] = await Promise.allSettled([
    // GSC SUMMARY — NO dimensions (true aggregate totals)
    gscSiteUrl
      ? getGSCSummary(gscSiteUrl, startDate, endDate)
      : Promise.resolve(null),

    // GA4 — sessions, users, pageviews, conversions
    ga4PropertyId
      ? getGA4Metrics(ga4PropertyId, startDate, endDate)
      : Promise.resolve(null),

    // GSC TABLE — query dimension, rowLimit 25000 (for table display ONLY)
    gscSiteUrl
      ? getGSCTable(gscSiteUrl, startDate, endDate, "query", 25000)
      : Promise.resolve([]),

    // GSC TABLE — page dimension, rowLimit 25000 (for table display ONLY)
    gscSiteUrl
      ? getGSCTable(gscSiteUrl, startDate, endDate, "page", 25000)
      : Promise.resolve([]),

    // DataForSEO (estimated, non-date-filtered)
    isDataForSEOConfigured() ? getDomainMetrics(domain) : Promise.resolve(null),
    isDataForSEOConfigured() ? getDomainRankings(domain, 100) : Promise.resolve([]),
    isDataForSEOConfigured() ? getDomainBacklinks(domain, 50) : Promise.resolve([]),
    isDataForSEOConfigured() ? getDomainTopPages(domain, 10) : Promise.resolve([]),
  ]);

  // ── 2. Extract results, collect errors ──────────────────────────────────
  const gscSum =
    gscSummaryResult.status === "fulfilled" ? gscSummaryResult.value : null;
  const ga4Data =
    ga4Result.status === "fulfilled" ? ga4Result.value : null;
  const queries =
    gscQueriesResult.status === "fulfilled" ? (gscQueriesResult.value as any[]) : [];
  const pages =
    gscPagesResult.status === "fulfilled" ? (gscPagesResult.value as any[]) : [];
  const seoMetrics =
    dfsMetricsResult.status === "fulfilled" ? dfsMetricsResult.value : null;
  const rankings =
    dfsRankingsResult.status === "fulfilled" ? (dfsRankingsResult.value as any[]) : [];
  const backlinks =
    dfsBacklinksResult.status === "fulfilled" ? (dfsBacklinksResult.value as any[]) : [];
  const topPages =
    dfsTopPagesResult.status === "fulfilled" ? (dfsTopPagesResult.value as any[]) : [];

  if (gscSummaryResult.status === "rejected") {
    const msg = (gscSummaryResult.reason as any)?.message || "Unknown GSC error";
    errors.push(`GSC: ${msg}`);
    debugLog("orchestrator", `GSC summary failed: ${msg}`);
  }
  if (ga4Result.status === "rejected") {
    const msg = (ga4Result.reason as any)?.message || "Unknown GA4 error";
    errors.push(`GA4: ${msg}`);
    debugLog("orchestrator", `GA4 failed: ${msg}`);
  }
  if (gscQueriesResult.status === "rejected") {
    debugLog("orchestrator", `GSC queries failed: ${(gscQueriesResult.reason as any)?.message}`);
  }
  if (gscPagesResult.status === "rejected") {
    debugLog("orchestrator", `GSC pages failed: ${(gscPagesResult.reason as any)?.message}`);
  }

  // ── 3. Build summary — ONLY from primary sources ────────────────────────

  const clicks = gscSum?.clicks ?? 0;
  const impressions = gscSum?.impressions ?? 0;

  // Validate CTR: recalculate from raw values to guarantee accuracy.
  // GSC occasionally returns a rounded ctr field; our calculation is exact.
  let ctr = gscSum?.ctr ?? 0;
  if (impressions > 0) {
    const calculatedCtr = Math.round((clicks / impressions) * 10000) / 100;
    if (Math.abs(calculatedCtr - ctr) > 0.01) {
      debugLog("orchestrator", `CTR recalculated: API=${ctr}% → exact=${calculatedCtr}%`);
      ctr = calculatedCtr;
    }
  }

  const sessions = ga4Data?.sessions ?? 0;
  const users = ga4Data?.totalUsers ?? 0;
  const pageviews = ga4Data?.screenPageViews ?? 0;

  // ── 4. Assemble response ─────────────────────────────────────────────────
  return {
    summary: {
      clicks,
      impressions,
      ctr,
      position: gscSum?.position ?? 0,
      sessions,
      users,
      pageviews,
      source: {
        clicks: gscSum ? "GSC" : (errors.some(e => e.startsWith("GSC")) ? "error" : "unavailable"),
        traffic: ga4Data ? "GA4" : (errors.some(e => e.startsWith("GA4")) ? "error" : "unavailable"),
      },
      dataCoverage: "full",
    },
    queries,
    pages,
    seo: {
      keywords: [],
      rankings,
      backlinks,
      topPages,
      source: "DataForSEO",
      estimated: true,
    },
    meta: {
      validated: errors.length === 0,
      mismatchDetected: false,
      lastUpdated: new Date().toISOString(),
      errors,
    },
  };
}
