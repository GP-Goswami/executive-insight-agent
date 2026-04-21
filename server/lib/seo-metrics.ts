import type { NormalizedData } from "./normalization-engine";

export interface AggregatedDataset {
  ga4: {
    users: number;
    sessions: number;
    conversions?: number;
  };
  ga4Previous?: {
    users: number;
    sessions: number;
    conversions?: number;
  };
  gsc: {
    clicks: number;
    impressions: number;
    ctr: number;
    avgPosition: number;
  };
  rankings: {
    totalKeywords: number;
    top10Keywords: number;
    improvedKeywords: number;
    declinedKeywords: number;
  };
  backlinks?: {
    currentBacklinks: number;
    previousBacklinks: number;
    currentReferringDomains: number;
    previousReferringDomains: number;
  };
}

export interface SeoMetrics {
  traffic: {
    users: number;
    sessions: number;
    growthRate: number;
  };
  search: {
    clicks: number;
    impressions: number;
    ctr: number;
    avgPosition: number;
    ctrGap: number;
  };
  keywords: {
    total: number;
    top10: number;
    top10Percentage: number;
    improved: number;
    declined: number;
    netGrowth: number;
  };
  conversions: {
    current: number;
    previous: number;
    delta: number;
    growthRate: number;
  };
  backlinks: {
    current: number;
    previous: number;
    delta: number;
    referringDomains: number;
    referringDomainsDelta: number;
  };
  opportunities: {
    page2KeywordsEstimate: boolean;
    lowCtrOpportunity: boolean;
  };
}

const LOW_CTR_THRESHOLD = 5;
const LOW_CTR_MIN_IMPRESSIONS = 5000;
const PAGE2_POSITION_MIN = 11;
const PAGE2_POSITION_MAX = 20;

export function computeSeoMetrics(normalized: NormalizedData): SeoMetrics {
  const { traffic, search, keywords, conversions, backlinks } = normalized;

  const ctrGap = search.impressions > 0
    ? Math.round((search.ctrBenchmark - search.ctr) * 100) / 100
    : 0;

  const page2KeywordsEstimate = search.avgPosition >= PAGE2_POSITION_MIN && search.avgPosition <= PAGE2_POSITION_MAX;
  const lowCtrOpportunity = search.impressions > LOW_CTR_MIN_IMPRESSIONS && search.ctr < LOW_CTR_THRESHOLD;

  return {
    traffic: {
      users: traffic.currentUsers,
      sessions: traffic.currentSessions,
      growthRate: traffic.growthRate,
    },
    search: {
      clicks: search.clicks,
      impressions: search.impressions,
      ctr: search.ctr,
      avgPosition: search.avgPosition,
      ctrGap,
    },
    keywords: {
      total: keywords.total,
      top10: keywords.top10,
      top10Percentage: keywords.top10Ratio,
      improved: keywords.improved,
      declined: keywords.declined,
      netGrowth: keywords.netGrowth,
    },
    conversions: {
      current: conversions.current,
      previous: conversions.previous,
      delta: conversions.delta,
      growthRate: conversions.growthRate,
    },
    backlinks: {
      current: backlinks.current,
      previous: backlinks.previous,
      delta: backlinks.delta,
      referringDomains: backlinks.referringDomains.current,
      referringDomainsDelta: backlinks.referringDomains.delta,
    },
    opportunities: {
      page2KeywordsEstimate,
      lowCtrOpportunity,
    },
  };
}
