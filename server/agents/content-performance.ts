// A04 — Content Performance Agent.
// Deterministic analysis (no model calls) over EXISTING GA4 page data + GSC page
// data. Produces four sections:
//   1. Top performing pages          (GA4 sessions/users/conversions)
//   2. Decaying pages                (session drop > 20% vs prior 28 days)
//   3. Content gap opportunities     (GSC pages stuck on page 2-3 with demand)
//   4. Internal linking deficiencies (heuristic — high-value/under-discovered pages)
//
// Findings are written to agent_runs.output + the scratchpad via BaseAgent.

import { BaseAgent, type AgentResult } from "./base-agent";
import {
  resolveProperty,
  getMaxDataDate,
  type ResolvedProperty,
} from "../reports/shared/report-data";
import { getGA4TopPages, getGA4TopPagesExtended, getGSCTable, type GA4TopPageExtended } from "../lib/google-apis";

const DROP_THRESHOLD = 0.2; // > 20% session drop = decaying
const MIN_PREV_SESSIONS = 15; // ignore tiny pages where % swings are noise
const GAP_MIN_IMPRESSIONS = 80; // demand floor for a content gap
const GAP_POS_MIN = 8; // page-1-bottom .. page-3 band where improving content pays off
const GAP_POS_MAX = 30;
const LINK_MIN_IMPRESSIONS = 150; // search demand floor for the linking heuristic

interface PageStat {
  page: string;
  users: number;
  sessions: number;
  conversions: number;
}
interface TopPerfRow {
  page: string;
  sessions: number;
  users: number;
  engagementRate: number; // 0-100 (%); -1 when unavailable
  avgEngagementTime: string;
}
interface DecayRow extends PageStat {
  prevSessions: number;
  dropPct: number; // positive number = % decline
}
interface GapRow {
  page: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
  potentialClicksToPage1: number;
}
interface LinkRow {
  page: string;
  reason: string;
  searchImpressions: number;
  sessions: number;
  conversions: number;
}

function normalizePath(url: string): string {
  try {
    if (url.startsWith("http")) return new URL(url).pathname || "/";
  } catch {
    /* ignore */
  }
  return url.startsWith("/") ? url : `/${url}`;
}

export class ContentPerformanceAgent extends BaseAgent {
  readonly agentId = "A04";
  readonly model = "deterministic";

  protected async computeInputHash(tenantId: string): Promise<string | undefined> {
    return this.sha256({ tenantId, kind: "content", day: new Date().toISOString().slice(0, 10) });
  }

  async run(tenantId: string): Promise<AgentResult> {
    const prop = await resolveProperty(tenantId);
    if (!prop) {
      const empty = { error: `No property found for tenant "${tenantId}".`, topPerformingPages: [], decayingPages: [], contentGapOpportunities: [], internalLinkingDeficiencies: [] };
      await this.writeScratchpad(empty);
      return this.result(empty);
    }

    const { current, previous } = await this.periods(prop);
    const findings = await this.analyse(prop, current, previous);

    await this.writeScratchpad({
      topPerformingPages: findings.topPerformingPages.length,
      decayingPages: findings.decayingPages.length,
      contentGapOpportunities: findings.contentGapOpportunities.length,
      internalLinkingDeficiencies: findings.internalLinkingDeficiencies.length,
    });
    this.log(
      `content perf: ${findings.topPerformingPages.length} top, ${findings.decayingPages.length} decaying, ` +
        `${findings.contentGapOpportunities.length} gaps, ${findings.internalLinkingDeficiencies.length} linking`,
    );
    return this.result(findings);
  }

  /** 28-day current vs prior 28-day window (page-level weekly data is too noisy). */
  private async periods(prop: ResolvedProperty) {
    const max = await getMaxDataDate(prop.propertyId);
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    const add = (d: Date, n: number) => {
      const x = new Date(d);
      x.setDate(x.getDate() + n);
      return x;
    };
    const curEnd = max;
    const curStart = add(curEnd, -27);
    const prevEnd = add(curStart, -1);
    const prevStart = add(prevEnd, -27);
    return {
      current: { start: ymd(curStart), end: ymd(curEnd) },
      previous: { start: ymd(prevStart), end: ymd(prevEnd) },
    };
  }

  private async analyse(
    prop: ResolvedProperty,
    current: { start: string; end: string },
    previous: { start: string; end: string },
  ) {
    const [curPages, prevPages, extendedTop, gscPagesRaw] = await Promise.all([
      safe(() => getGA4TopPages(prop.ga4PropertyId, current.start, current.end, 50), [] as PageStat[]),
      safe(() => getGA4TopPages(prop.ga4PropertyId, previous.start, previous.end, 50), [] as PageStat[]),
      safe(() => getGA4TopPagesExtended(prop.ga4PropertyId, current.start, current.end, 12), [] as GA4TopPageExtended[]),
      prop.gscSiteUrl
        ? safe(() => getGSCTable(prop.gscSiteUrl, current.start, current.end, "page", 250), [] as Array<Record<string, unknown>>)
        : Promise.resolve([] as Array<Record<string, unknown>>),
    ]);

    // getGSCTable returns a computed-key shape (page typed string|number); normalise it.
    const gscPages = gscPagesRaw.map((r) => ({
      page: String(r.page ?? ""),
      clicks: Number(r.clicks) || 0,
      impressions: Number(r.impressions) || 0,
      ctr: Number(r.ctr) || 0,
      position: Number(r.position) || 0,
    }));

    // 1. Top performing pages (with engagement rate from the extended GA4 report;
    // falls back to GA4 top pages without engagement rate if the extended call fails).
    const topPerformingPages: TopPerfRow[] =
      extendedTop.length > 0
        ? [...extendedTop]
            .sort((a, b) => b.sessions - a.sessions)
            .slice(0, 10)
            .map((p) => ({
              page: p.page,
              sessions: p.sessions,
              users: p.totalUsers,
              engagementRate: Math.round((p.engagementRate ?? 0) * 10) / 10,
              avgEngagementTime: p.avgEngagementTimeFormatted ?? "—",
            }))
        : [...curPages]
            .sort((a, b) => b.sessions - a.sessions)
            .slice(0, 10)
            .map((p) => ({ page: p.page, sessions: p.sessions, users: p.users, engagementRate: -1, avgEngagementTime: "—" }));

    // 2. Decaying pages (> 20% session drop vs prior window).
    const curByPath = new Map(curPages.map((p) => [normalizePath(p.page), p]));
    const decayingPages: DecayRow[] = [];
    for (const prev of prevPages) {
      if (prev.sessions < MIN_PREV_SESSIONS) continue;
      const cur = curByPath.get(normalizePath(prev.page));
      const curSessions = cur?.sessions ?? 0;
      if (curSessions < prev.sessions * (1 - DROP_THRESHOLD)) {
        decayingPages.push({
          page: prev.page,
          users: cur?.users ?? 0,
          sessions: curSessions,
          conversions: cur?.conversions ?? 0,
          prevSessions: prev.sessions,
          dropPct: Math.round((1 - curSessions / prev.sessions) * 1000) / 10,
        });
      }
    }
    decayingPages.sort((a, b) => b.dropPct - a.dropPct);

    // 3. Content gap opportunities (GSC pages with demand stuck on page 2-3).
    const contentGapOpportunities: GapRow[] = gscPages
      .filter((p) => p.impressions >= GAP_MIN_IMPRESSIONS && p.position >= GAP_POS_MIN && p.position <= GAP_POS_MAX)
      .map((p) => ({
        page: p.page,
        impressions: p.impressions,
        clicks: p.clicks,
        ctr: p.ctr,
        position: p.position,
        // Modelled clicks if this page reached an ~8% page-1 CTR.
        potentialClicksToPage1: Math.max(0, Math.round(p.impressions * 0.08 - p.clicks)),
      }))
      .sort((a, b) => b.potentialClicksToPage1 - a.potentialClicksToPage1)
      .slice(0, 15);

    // 4. Internal linking deficiencies (heuristic — no crawl integration yet).
    const gscByPath = new Map(gscPages.map((p) => [normalizePath(p.page), p]));
    const sessionsList = curPages.map((p) => p.sessions).sort((a, b) => a - b);
    const medianSessions = sessionsList.length ? sessionsList[Math.floor(sessionsList.length / 2)] : 0;
    const internalLinkingDeficiencies: LinkRow[] = [];
    for (const g of gscPages) {
      if (g.impressions < LINK_MIN_IMPRESSIONS) continue;
      const ga4 = curByPath.get(normalizePath(g.page));
      const sessions = ga4?.sessions ?? 0;
      // High external search demand but low on-site sessions → likely poorly linked internally.
      if (sessions < Math.max(medianSessions, 1) && sessions < g.clicks * 1.5) {
        internalLinkingDeficiencies.push({
          page: g.page,
          reason: "High search demand but low on-site sessions — add internal links from high-traffic pages",
          searchImpressions: g.impressions,
          sessions,
          conversions: ga4?.conversions ?? 0,
        });
      }
    }
    // Also surface high-converting but low-traffic pages (orphan-ish value pages).
    for (const p of curPages) {
      if (p.conversions > 0 && p.sessions > 0 && p.sessions < medianSessions && p.conversions / p.sessions > 0.5) {
        if (!internalLinkingDeficiencies.some((d) => normalizePath(d.page) === normalizePath(p.page))) {
          const g = gscByPath.get(normalizePath(p.page));
          internalLinkingDeficiencies.push({
            page: p.page,
            reason: "High conversion rate but low traffic — strengthen internal links to this page",
            searchImpressions: g?.impressions ?? 0,
            sessions: p.sessions,
            conversions: p.conversions,
          });
        }
      }
    }
    internalLinkingDeficiencies.sort((a, b) => b.searchImpressions - a.searchImpressions);

    return {
      period: { current, previous },
      topPerformingPages,
      decayingPages: decayingPages.slice(0, 15),
      contentGapOpportunities,
      internalLinkingDeficiencies: internalLinkingDeficiencies.slice(0, 15),
      note:
        prop.gscSiteUrl
          ? "Internal-linking deficiencies are heuristic (search-demand vs on-site-traffic signals); a full internal-link crawl is not yet integrated."
          : "GSC site URL not set for this property — content-gap and internal-linking analysis ran on GA4 data only.",
      generatedAt: new Date().toISOString(),
    };
  }
}

export function runContentPerformance(tenantId: string): Promise<AgentResult> {
  return new ContentPerformanceAgent().execute(tenantId);
}

/** Run a fetcher; on any error return the fallback (keeps one section from failing the agent). */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}
