import type { AggregatedDataset } from "./seo-metrics";

export type TrafficTrend = "up" | "down" | "flat";
export type CtrPerformance = "good" | "average" | "poor";
export type KeywordTrend = "improving" | "declining" | "stable";
export type BacklinkTrend = "growing" | "declining" | "stable";

export interface NormalizedTraffic {
  currentUsers: number;
  previousUsers: number;
  currentSessions: number;
  growthRate: number;
  trend: TrafficTrend;
}

export interface NormalizedSearch {
  clicks: number;
  impressions: number;
  ctr: number;
  avgPosition: number;
  ctrBenchmark: number;
  ctrPerformance: CtrPerformance;
}

export interface NormalizedKeywords {
  total: number;
  top10: number;
  improved: number;
  declined: number;
  top10Ratio: number;
  netGrowth: number;
  trend: KeywordTrend;
}

export interface NormalizedConversions {
  current: number;
  previous: number;
  delta: number;
  growthRate: number;
  trend: TrafficTrend;
}

export interface NormalizedBacklinks {
  current: number;
  previous: number;
  delta: number;
  referringDomains: {
    current: number;
    previous: number;
    delta: number;
  };
  trend: BacklinkTrend;
}

export interface DataQualityFlags {
  hasTraffic: boolean;
  hasSearch: boolean;
  hasKeywords: boolean;
  hasConversions: boolean;
  hasBacklinks: boolean;
}

export interface NormalizedData {
  traffic: NormalizedTraffic;
  search: NormalizedSearch;
  keywords: NormalizedKeywords;
  conversions: NormalizedConversions;
  backlinks: NormalizedBacklinks;
  quality: DataQualityFlags;
}

const CTR_BENCHMARK = 5;
const GROWTH_UP_THRESHOLD = 2;
const GROWTH_DOWN_THRESHOLD = -2;

export function safeNum(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return isFinite(n) ? n : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function safeDivide(num: number, den: number): number {
  if (den === 0) return 0;
  return num / den;
}

function resolveTrafficTrend(growthRate: number): TrafficTrend {
  if (growthRate > GROWTH_UP_THRESHOLD) return "up";
  if (growthRate < GROWTH_DOWN_THRESHOLD) return "down";
  return "flat";
}

function resolveCtrPerformance(ctr: number): CtrPerformance {
  if (ctr >= 5) return "good";
  if (ctr >= 3) return "average";
  return "poor";
}

function resolveKeywordTrend(netGrowth: number): KeywordTrend {
  if (netGrowth > 0) return "improving";
  if (netGrowth < 0) return "declining";
  return "stable";
}

function resolveBacklinkTrend(delta: number): BacklinkTrend {
  if (delta > 0) return "growing";
  if (delta < 0) return "declining";
  return "stable";
}

export function normalizeData(data: AggregatedDataset): NormalizedData {
  const currentUsers = safeNum(data.ga4?.users);
  const currentSessions = safeNum(data.ga4?.sessions);
  const previousUsers = safeNum(data.ga4Previous?.users);

  const growthRate = previousUsers > 0
    ? round2(safeDivide(currentUsers - previousUsers, previousUsers) * 100)
    : 0;

  const clicks = safeNum(data.gsc?.clicks);
  const impressions = safeNum(data.gsc?.impressions);
  const ctr = round2(safeNum(data.gsc?.ctr));
  const avgPosition = round2(safeNum(data.gsc?.avgPosition));

  const totalKeywords = safeNum(data.rankings?.totalKeywords);
  const top10Keywords = safeNum(data.rankings?.top10Keywords);
  const improvedKeywords = safeNum(data.rankings?.improvedKeywords);
  const declinedKeywords = safeNum(data.rankings?.declinedKeywords);
  const netGrowth = improvedKeywords - declinedKeywords;
  const top10Ratio = round2(safeDivide(top10Keywords, totalKeywords) * 100);

  const currentConversions = safeNum(data.ga4?.conversions);
  const previousConversions = safeNum(data.ga4Previous?.conversions);
  const conversionDelta = currentConversions - previousConversions;
  const conversionGrowthRate = previousConversions > 0
    ? round2(safeDivide(conversionDelta, previousConversions) * 100)
    : 0;

  const currentBacklinks = safeNum(data.backlinks?.currentBacklinks);
  const previousBacklinks = safeNum(data.backlinks?.previousBacklinks);
  const backlinkDelta = currentBacklinks - previousBacklinks;
  const currentRD = safeNum(data.backlinks?.currentReferringDomains);
  const previousRD = safeNum(data.backlinks?.previousReferringDomains);
  const rdDelta = currentRD - previousRD;

  return {
    traffic: {
      currentUsers,
      previousUsers,
      currentSessions,
      growthRate,
      trend: resolveTrafficTrend(growthRate),
    },
    search: {
      clicks,
      impressions,
      ctr,
      avgPosition,
      ctrBenchmark: CTR_BENCHMARK,
      ctrPerformance: resolveCtrPerformance(ctr),
    },
    keywords: {
      total: totalKeywords,
      top10: top10Keywords,
      improved: improvedKeywords,
      declined: declinedKeywords,
      top10Ratio,
      netGrowth,
      trend: resolveKeywordTrend(netGrowth),
    },
    conversions: {
      current: currentConversions,
      previous: previousConversions,
      delta: conversionDelta,
      growthRate: conversionGrowthRate,
      trend: resolveTrafficTrend(conversionGrowthRate),
    },
    backlinks: {
      current: currentBacklinks,
      previous: previousBacklinks,
      delta: backlinkDelta,
      referringDomains: {
        current: currentRD,
        previous: previousRD,
        delta: rdDelta,
      },
      trend: resolveBacklinkTrend(backlinkDelta),
    },
    quality: {
      hasTraffic: currentUsers > 0 || currentSessions > 0,
      hasSearch: clicks > 0 || impressions > 0,
      hasKeywords: totalKeywords > 0,
      hasConversions: currentConversions > 0 || previousConversions > 0,
      hasBacklinks: currentBacklinks > 0 || previousBacklinks > 0,
    },
  };
}
