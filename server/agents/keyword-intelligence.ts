// A02 — Keyword Intelligence Agent.
// Deterministic analysis (no model calls) over EXISTING GSC query data. Sections:
//   1. Ranking deltas (week-over-week)        — biggest position movers
//   2. CTR opportunities (high impr, low CTR) — vs an expected position→CTR curve
//   3. Cannibalization signals                — one query split across multiple pages
//   4. New keyword opportunities              — queries newly appearing / rising
//
// Findings written to agent_runs.output + scratchpad via BaseAgent.

import { BaseAgent, type AgentResult } from "./base-agent";
import {
  resolveProperty,
  getMaxDataDate,
  buildWeeklyPeriods,
  type ResolvedProperty,
  type PeriodRange,
} from "../reports/shared/report-data";
import { getGSCTable, getGSCSearchAnalyticsMultiDimension } from "../lib/google-apis";

const RANK_MIN_IMPRESSIONS = 20;
const RANK_MIN_DELTA = 1; // ignore sub-position wobble
const CTR_MIN_IMPRESSIONS = 100;
const CTR_GAP_RATIO = 0.7; // flag when actual CTR < 70% of expected
const CANNIBAL_MIN_IMPRESSIONS = 10; // per-page floor to count as a real competing URL
const NEW_MIN_IMPRESSIONS = 30;

interface GscQueryRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number; // %
  position: number;
}

/** Expected organic CTR (%) by rounded position — industry-standard curve. */
function expectedCtr(position: number): number {
  const p = Math.round(position);
  const table: Record<number, number> = { 1: 28, 2: 15, 3: 11, 4: 8, 5: 6, 6: 5, 7: 4, 8: 3.5, 9: 3, 10: 2.5 };
  if (p <= 10) return table[Math.max(1, p)] ?? 2.5;
  if (p <= 20) return 1.5;
  if (p <= 30) return 0.9;
  return 0.5;
}

export class KeywordIntelligenceAgent extends BaseAgent {
  readonly agentId = "A02";
  readonly model = "deterministic";

  protected async computeInputHash(tenantId: string): Promise<string | undefined> {
    return this.sha256({ tenantId, kind: "keywords", day: new Date().toISOString().slice(0, 10) });
  }

  async run(tenantId: string): Promise<AgentResult> {
    const prop = await resolveProperty(tenantId);
    if (!prop || !prop.gscSiteUrl) {
      const empty = {
        error: prop ? "GSC site URL not set for this property." : `No property found for tenant "${tenantId}".`,
        rankingDeltas: [], ctrOpportunities: [], cannibalizationSignals: [], newKeywordOpportunities: [],
      };
      await this.writeScratchpad(empty);
      return this.result(empty);
    }

    const max = await getMaxDataDate(prop.propertyId);
    const { current, previous } = buildWeeklyPeriods(max);
    const findings = await this.analyse(prop, current, previous);

    await this.writeScratchpad({
      rankingDeltas: findings.rankingDeltas.length,
      ctrOpportunities: findings.ctrOpportunities.length,
      cannibalizationSignals: findings.cannibalizationSignals.length,
      newKeywordOpportunities: findings.newKeywordOpportunities.length,
    });
    this.log(
      `keyword intel: ${findings.rankingDeltas.length} movers, ${findings.ctrOpportunities.length} ctr-opps, ` +
        `${findings.cannibalizationSignals.length} cannibal, ${findings.newKeywordOpportunities.length} new`,
    );
    return this.result(findings);
  }

  private async analyse(prop: ResolvedProperty, current: PeriodRange, previous: PeriodRange) {
    const [curRaw, prevRaw, queryPage] = await Promise.all([
      safe(() => getGSCTable(prop.gscSiteUrl, current.start, current.end, "query", 500), [] as Array<Record<string, unknown>>),
      safe(() => getGSCTable(prop.gscSiteUrl, previous.start, previous.end, "query", 500), [] as Array<Record<string, unknown>>),
      safe(() => getGSCSearchAnalyticsMultiDimension(prop.gscSiteUrl, current.start, current.end, ["query", "page"], 2000), [] as Array<{ query: string; page: string; clicks: number; impressions: number; ctr: number; position: number }>),
    ]);

    // getGSCTable returns a computed-key shape (query typed string|number); normalise it.
    const normQuery = (r: Record<string, unknown>): GscQueryRow => ({
      query: String(r.query ?? ""),
      clicks: Number(r.clicks) || 0,
      impressions: Number(r.impressions) || 0,
      ctr: Number(r.ctr) || 0,
      position: Number(r.position) || 0,
    });
    const cur: GscQueryRow[] = curRaw.map(normQuery);
    const prev: GscQueryRow[] = prevRaw.map(normQuery);

    const prevByQuery = new Map(prev.map((q) => [q.query, q]));

    // 1. Ranking deltas (WoW) — positive delta = improved (moved up).
    const rankingDeltas = cur
      .filter((q) => q.impressions >= RANK_MIN_IMPRESSIONS && prevByQuery.has(q.query))
      .map((q) => {
        const p = prevByQuery.get(q.query)!;
        const positionDelta = Math.round((p.position - q.position) * 10) / 10;
        return {
          query: q.query,
          clicks: q.clicks,
          impressions: q.impressions,
          position: q.position,
          prevPosition: p.position,
          positionDelta,
          direction: positionDelta > 0 ? "up" : positionDelta < 0 ? "down" : "flat",
        };
      })
      .filter((q) => Math.abs(q.positionDelta) >= RANK_MIN_DELTA)
      .sort((a, b) => Math.abs(b.positionDelta) - Math.abs(a.positionDelta))
      .slice(0, 20);

    // 2. CTR opportunities — high impressions, CTR well below expected for position.
    const ctrOpportunities = cur
      .filter((q) => {
        if (q.impressions < CTR_MIN_IMPRESSIONS) return false;
        const exp = expectedCtr(q.position);
        return q.ctr < exp * CTR_GAP_RATIO;
      })
      .map((q) => {
        const exp = expectedCtr(q.position);
        const clickGap = Math.max(0, Math.round((exp - q.ctr) / 100 * q.impressions));
        return {
          query: q.query,
          impressions: q.impressions,
          clicks: q.clicks,
          ctr: q.ctr,
          expectedCtr: exp,
          position: q.position,
          potentialExtraClicks: clickGap,
        };
      })
      .sort((a, b) => b.potentialExtraClicks - a.potentialExtraClicks)
      .slice(0, 15);

    // 3. Cannibalization — one query meaningfully split across multiple pages.
    const byQuery = new Map<string, Array<{ page: string; clicks: number; impressions: number; position: number }>>();
    for (const row of queryPage) {
      if (row.impressions < CANNIBAL_MIN_IMPRESSIONS) continue;
      const list = byQuery.get(row.query) ?? [];
      list.push({ page: row.page, clicks: row.clicks, impressions: row.impressions, position: row.position });
      byQuery.set(row.query, list);
    }
    const cannibalizationSignals = Array.from(byQuery.entries())
      .filter(([, pages]) => pages.length >= 2)
      .map(([query, pages]) => {
        const sorted = pages.sort((a, b) => b.impressions - a.impressions);
        return {
          query,
          pageCount: sorted.length,
          totalImpressions: sorted.reduce((s, p) => s + p.impressions, 0),
          totalClicks: sorted.reduce((s, p) => s + p.clicks, 0),
          pages: sorted.slice(0, 4).map((p) => ({ page: p.page, impressions: p.impressions, clicks: p.clicks, position: p.position })),
        };
      })
      .sort((a, b) => b.totalImpressions - a.totalImpressions)
      .slice(0, 15);

    // 4. New keyword opportunities — newly appearing or sharply rising queries.
    const newKeywordOpportunities = cur
      .filter((q) => q.impressions >= NEW_MIN_IMPRESSIONS)
      .map((q) => {
        const p = prevByQuery.get(q.query);
        const prevImpr = p?.impressions ?? 0;
        const isNew = !p;
        const rising = prevImpr > 0 && q.impressions >= prevImpr * 2;
        return { q, prevImpr, isNew, rising };
      })
      .filter((x) => x.isNew || x.rising)
      .map((x) => ({
        query: x.q.query,
        impressions: x.q.impressions,
        clicks: x.q.clicks,
        position: x.q.position,
        previousImpressions: x.prevImpr,
        type: x.isNew ? "new" : "rising",
      }))
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 20);

    return {
      period: { current, previous },
      rankingDeltas,
      ctrOpportunities,
      cannibalizationSignals,
      newKeywordOpportunities,
      generatedAt: new Date().toISOString(),
    };
  }
}

export function runKeywordIntelligence(tenantId: string): Promise<AgentResult> {
  return new KeywordIntelligenceAgent().execute(tenantId);
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}
