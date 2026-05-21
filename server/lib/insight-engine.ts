import type { NormalizedData } from "./normalization-engine";

export interface Insight {
  type: "positive" | "warning" | "neutral";
  category: "traffic" | "keywords" | "ctr" | "opportunity" | "correlation" | "data-quality" | "conversions" | "backlinks";
  message: string;
}

const PAGE2_POSITION_MIN = 11;
const PAGE2_POSITION_MAX = 20;
const LOW_CTR_MIN_IMPRESSIONS = 5000;

export function generateInsights(normalized: NormalizedData): Insight[] {
  const insights: Insight[] = [];
  const { traffic, search, keywords, conversions, backlinks, quality } = normalized;

  if (traffic.trend === "up") {
    insights.push({
      type: "positive",
      category: "traffic",
      message: `Traffic grew ${traffic.growthRate}% period-over-period (${traffic.previousUsers.toLocaleString()} → ${traffic.currentUsers.toLocaleString()} users)`,
    });
  } else if (traffic.trend === "down") {
    insights.push({
      type: "warning",
      category: "traffic",
      message: `Traffic declined ${Math.abs(traffic.growthRate)}% period-over-period (${traffic.previousUsers.toLocaleString()} → ${traffic.currentUsers.toLocaleString()} users)`,
    });
  } else {
    insights.push({
      type: "neutral",
      category: "traffic",
      message: `Traffic is flat at ${traffic.currentUsers.toLocaleString()} users (${traffic.growthRate}% change, within ±2% threshold)`,
    });
  }

  if (quality.hasSearch) {
    if (search.ctrPerformance === "good") {
      insights.push({
        type: "positive",
        category: "ctr",
        message: `CTR of ${search.ctr}% exceeds the ${search.ctrBenchmark}% benchmark — titles and meta descriptions are performing well`,
      });
    } else if (search.ctrPerformance === "average") {
      insights.push({
        type: "neutral",
        category: "ctr",
        message: `CTR of ${search.ctr}% is below the ${search.ctrBenchmark}% benchmark but within acceptable range (3–5%)`,
      });
    } else {
      insights.push({
        type: "warning",
        category: "ctr",
        message: `CTR of ${search.ctr}% is significantly below the ${search.ctrBenchmark}% benchmark — titles and meta descriptions need optimization`,
      });
    }

    if (search.impressions > LOW_CTR_MIN_IMPRESSIONS && search.ctrPerformance === "poor") {
      insights.push({
        type: "warning",
        category: "opportunity",
        message: `${search.impressions.toLocaleString()} impressions with only ${search.ctr}% CTR — improving titles/descriptions could capture ${Math.round(search.impressions * (search.ctrBenchmark - search.ctr) / 100).toLocaleString()} additional clicks`,
      });
    }
  }

  if (keywords.trend === "improving") {
    insights.push({
      type: "positive",
      category: "keywords",
      message: `Keyword rankings are improving with ${keywords.improved} keywords gained vs ${keywords.declined} lost (net +${keywords.netGrowth})`,
    });
  } else if (keywords.trend === "declining") {
    insights.push({
      type: "warning",
      category: "keywords",
      message: `Keyword rankings are declining with ${keywords.declined} keywords lost vs ${keywords.improved} gained (net ${keywords.netGrowth})`,
    });
  } else if (quality.hasKeywords) {
    insights.push({
      type: "neutral",
      category: "keywords",
      message: `Keyword rankings are stable — ${keywords.improved} improved, ${keywords.declined} declined (net zero change)`,
    });
  }

  if (quality.hasKeywords) {
    if (keywords.top10Ratio > 30) {
      insights.push({
        type: "positive",
        category: "keywords",
        message: `${keywords.top10Ratio}% of ${keywords.total.toLocaleString()} tracked keywords rank in the top 10 — strong first-page presence`,
      });
    } else if (keywords.total > 0) {
      insights.push({
        type: "neutral",
        category: "keywords",
        message: `Only ${keywords.top10Ratio}% of ${keywords.total.toLocaleString()} tracked keywords rank in the top 10 — room for improvement`,
      });
    }
  }

  if (quality.hasBacklinks) {
    if (backlinks.delta > 0) {
      insights.push({
        type: "positive",
        category: "backlinks",
        message: `Backlink profile grew by ${backlinks.delta} links this period (${backlinks.previous.toLocaleString()} → ${backlinks.current.toLocaleString()} total)`,
      });
    } else if (backlinks.delta < 0) {
      insights.push({
        type: "warning",
        category: "backlinks",
        message: `Lost ${Math.abs(backlinks.delta)} backlinks this period (${backlinks.previous.toLocaleString()} → ${backlinks.current.toLocaleString()} total). Monitor for link rot.`,
      });
    }

    if (backlinks.referringDomains.delta > 0) {
      insights.push({
        type: "positive",
        category: "backlinks",
        message: `${backlinks.referringDomains.delta} new referring domains added this period (${backlinks.referringDomains.previous.toLocaleString()} → ${backlinks.referringDomains.current.toLocaleString()} total)`,
      });
    }
  } else {
    if (backlinks.current === 0 && backlinks.previous === 0) {
      insights.push({
        type: "neutral",
        category: "data-quality",
        message: "Backlink data unavailable. Verify DataForSEO and SEMrush API credentials are configured in Settings.",
      });
    }
  }

  if (traffic.trend === "down" && keywords.trend === "declining") {
    insights.push({
      type: "warning",
      category: "correlation",
      message: `Traffic decline (${Math.abs(traffic.growthRate)}%) coincides with keyword losses (net ${keywords.netGrowth}) — ranking drops are likely driving traffic reduction`,
    });
  } else if (traffic.trend === "up" && keywords.trend === "improving") {
    insights.push({
      type: "positive",
      category: "correlation",
      message: `Traffic growth (+${traffic.growthRate}%) aligns with keyword gains (net +${keywords.netGrowth}) — SEO improvements are translating to real traffic`,
    });
  } else if (traffic.trend === "down" && keywords.trend === "improving") {
    insights.push({
      type: "neutral",
      category: "correlation",
      message: `Traffic is declining (${Math.abs(traffic.growthRate)}%) despite keyword gains (net +${keywords.netGrowth}) — investigate non-organic traffic sources or seasonal patterns`,
    });
  } else if (traffic.trend === "up" && keywords.trend === "declining") {
    insights.push({
      type: "neutral",
      category: "correlation",
      message: `Traffic is growing (+${traffic.growthRate}%) despite keyword losses (net ${keywords.netGrowth}) — growth may be driven by non-organic channels`,
    });
  }

  if (quality.hasSearch && search.avgPosition >= PAGE2_POSITION_MIN && search.avgPosition <= PAGE2_POSITION_MAX) {
    insights.push({
      type: "neutral",
      category: "opportunity",
      message: `Average position of ${search.avgPosition} places many keywords on page 2 (positions 11–20) — targeted content optimization could push these to page 1`,
    });
  }

  if (!quality.hasSearch) {
    insights.push({
      type: "warning",
      category: "data-quality",
      message: "No Search Console data available for this period — search performance insights are unavailable",
    });
  }

  if (!quality.hasKeywords) {
    insights.push({
      type: "warning",
      category: "data-quality",
      message: "No keyword ranking data available — keyword trend and distribution insights are unavailable",
    });
  }

  if (!quality.hasTraffic) {
    insights.push({
      type: "warning",
      category: "data-quality",
      message: "No GA4 traffic data available for this period — traffic trend analysis is unavailable",
    });
  }

  return insights;
}
