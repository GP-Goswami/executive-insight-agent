// Client-side copy of server/lib/data-health-score.ts — computeDataHealthScore only.
// Keep in sync when updating scoring logic in the server file.

export interface DataHealthInput {
  semrush: {
    organicTraffic: number | null;
    keywords: number | null;
    backlinks: number | null;
  } | null;
  ga4: {
    sessions: number | null;
    users: number | null;
  } | null;
  gsc: {
    clicks: number | null;
    impressions: number | null;
    ctr: number | null;
    avgPosition: number | null;
  } | null;
  dataforseo: {
    keywords: number | null;
    backlinks: number | null;
  } | null;
  backlinks: {
    total: number | null;
  } | null;
  previousPeriod: {
    ga4Sessions: number | null;
    gscClicks: number | null;
  } | null;
}

export interface DataHealthScore {
  score: number;
  issues: string[];
  warnings: string[];
  confidence: number;
  calculationLogic: {
    baseScore: 100;
    deductions: Array<{ reason: string; value: number }>;
  };
}

function pct(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export function computeDataHealthScore(data: DataHealthInput): DataHealthScore {
  let score = 100;
  const issues: string[] = [];
  const warnings: string[] = [];
  const deductions: Array<{ reason: string; value: number }> = [];

  const usedInValidation = new Set<string>();
  let backlinkAllMissingPenaltyApplied = false;

  function deduct(value: number, reason: string, isIssue = true): void {
    score -= value;
    deductions.push({ reason, value });
    if (isIssue) issues.push(reason);
  }

  // A. DATA CORRECTNESS

  const semTraffic = data.semrush?.organicTraffic;
  const ga4Sessions = data.ga4?.sessions;
  if (semTraffic != null && ga4Sessions != null && ga4Sessions > 0) {
    usedInValidation.add("semrush");
    const ratio = semTraffic / ga4Sessions;
    if (ratio > 2 || ratio < 0.5) {
      const label =
        ratio > 2
          ? `${ratio.toFixed(1)}x higher in SEMrush`
          : `${(1 / ratio).toFixed(1)}x higher in GA4`;
      deduct(20, `Organic traffic mismatch between SEMrush and GA4 (${label})`);
    }
  }

  const gscImpressions = data.gsc?.impressions;
  const dfoKeywords = data.dataforseo?.keywords;
  if (gscImpressions != null && dfoKeywords != null) {
    usedInValidation.add("dataforseo");
    if (gscImpressions > 10_000 && dfoKeywords < 10) {
      deduct(15, "High GSC impressions but low keyword ranking support");
    }
  }

  const semBl = data.semrush?.backlinks;
  const dfoBl = data.dataforseo?.backlinks;
  const hasSemBl = semBl != null && semBl > 0;
  const hasDfoBl = dfoBl != null && dfoBl > 0;
  const hasUnifiedBl = data.backlinks?.total != null && data.backlinks.total > 0;

  if (hasSemBl && hasDfoBl) {
    usedInValidation.add("semrush");
    usedInValidation.add("dataforseo");
    const maxBl = Math.max(semBl!, dfoBl!);
    const diffRatio = Math.abs(semBl! - dfoBl!) / maxBl;
    if (diffRatio > 0.5) {
      deduct(15, `Backlink count mismatch between SEMrush and DataForSEO (${pct(diffRatio * 100, 0)} spread)`);
    }
  } else if (!hasSemBl && !hasDfoBl && !hasUnifiedBl) {
    deduct(10, "Backlink data unavailable from all sources");
    backlinkAllMissingPenaltyApplied = true;
  }

  // B. SEARCH PERFORMANCE

  const ctr = data.gsc?.ctr;
  const gscClicks = data.gsc?.clicks;
  if (ctr != null) {
    if (ctr < 1) {
      deduct(20, `CTR critically low (${pct(ctr)}) — titles/meta need urgent optimisation`);
    } else if (ctr < 3) {
      deduct(10, `CTR below 3% target (${pct(ctr)}) — optimisation opportunity exists`);
    }
    if (ctr < 3 && gscImpressions != null && gscImpressions > 0 && gscClicks != null) {
      const potentialClicks = Math.round(gscImpressions * 0.05 - gscClicks);
      if (potentialClicks > 0) {
        warnings.push(
          `${fmt(gscImpressions)} impressions with low CTR represents potential for ` +
          `+${fmt(potentialClicks)} additional clicks`,
        );
      }
    }
  }

  const avgPos = data.gsc?.avgPosition;
  if (avgPos != null && avgPos > 20) {
    deduct(10, `Average position ${avgPos.toFixed(1)} — most rankings below page 2`);
  }

  const prevGscClicks = data.previousPeriod?.gscClicks;
  const currGscClicks = data.gsc?.clicks;
  if (prevGscClicks != null && currGscClicks != null && prevGscClicks > 0) {
    const dropPct = ((prevGscClicks - currGscClicks) / prevGscClicks) * 100;
    if (dropPct > 50) {
      deduct(20, `Traffic dropped ${dropPct.toFixed(0)}% period-over-period`);
    } else if (dropPct > 20) {
      deduct(10, `Traffic declined ${dropPct.toFixed(0)}% — monitor closely`);
    }
  }

  // C. MISSING INTEGRATIONS

  if (data.ga4 == null) {
    deduct(10, "GA4 not connected");
  }
  if (data.gsc == null) {
    deduct(15, "Google Search Console not connected");
  }
  if (data.semrush == null && !usedInValidation.has("semrush")) {
    deduct(25, "SEMrush unavailable — primary validation source missing");
  }
  if (data.dataforseo == null && !usedInValidation.has("dataforseo")) {
    deduct(10, "DataForSEO unavailable");
  }
  if (data.backlinks == null && !backlinkAllMissingPenaltyApplied) {
    deduct(10, "Backlink data unavailable");
  }

  const nullSourceCount = [
    data.semrush,
    data.ga4,
    data.gsc,
    data.dataforseo,
    data.backlinks,
    data.previousPeriod,
  ].filter((s) => s == null).length;

  const confidence = Math.max(10, 100 - nullSourceCount * 20);

  return {
    score: Math.max(0, score),
    issues,
    warnings,
    confidence,
    calculationLogic: { baseScore: 100, deductions },
  };
}
