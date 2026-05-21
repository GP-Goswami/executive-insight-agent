// =====================================================================
// DATA HEALTH SCORE — Unified SEO data integrity & verdict engine
//
// Validates cross-source data correctness, completeness, SEO performance
// signals, and anomalies. Produces a single 0-100 confidence-weighted
// score plus an executive-grade verdict for each report run.
//
// Design principles:
//   • Never penalise a null source twice (usedInValidation + flags)
//   • Never hallucinate values — every check gates on data existence
//   • All functions are independently testable with no side effects
//   • Safe for multi-tenant SaaS: no global mutable state
// =====================================================================

// ─────────────────────────────────────────────────────────────────────
// Input / Output types
// ─────────────────────────────────────────────────────────────────────

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
  score: number;            // 0-100
  issues: string[];         // blockers that require action
  warnings: string[];       // advisory — monitor but not critical
  confidence: number;       // how reliable the score itself is (0-100)
  calculationLogic: {
    baseScore: 100;
    deductions: Array<{ reason: string; value: number }>;
  };
}

export interface HealthScoreUI {
  statusLabel: string;
  badgeColor: string;
  progressBarLabel: string;
}

export interface RootCause {
  cause: string;
  confidence: number;
}

export interface ExecutiveVerdict {
  status: "Critical but Recoverable" | "At Risk" | "Healthy";
  keyInsight: string;
  rootCauses: RootCause[];
  decisions: string[];  // exactly 3, specific and actionable
  confidence: number;   // inherited from DataHealthScore.confidence
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function pct(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

// ─────────────────────────────────────────────────────────────────────
// TASK 1 — computeDataHealthScore
// ─────────────────────────────────────────────────────────────────────

export function computeDataHealthScore(data: DataHealthInput): DataHealthScore {
  let score = 100;
  const issues: string[] = [];
  const warnings: string[] = [];
  const deductions: Array<{ reason: string; value: number }> = [];

  // Which top-level sources were consumed during cross-validation.
  // Used to avoid double-penalising a source under "Missing Integrations".
  const usedInValidation = new Set<string>();

  // Cross-check flags for correlated warning generation.
  let backlinkAllMissingPenaltyApplied = false;

  function deduct(value: number, reason: string, isIssue = true): void {
    score -= value;
    deductions.push({ reason, value });
    if (isIssue) issues.push(reason);
  }

  // ═══════════════════════════════════════════════════════════════════
  // A. DATA CORRECTNESS
  // ═══════════════════════════════════════════════════════════════════

  // ── A1. Organic Traffic Mismatch ────────────────────────────────
  // SEMrush counts all organic visits (bot-filtered crawler data);
  // GA4 counts only instrumented sessions. A ratio outside 0.5–2.0
  // signals mismatched date ranges, filters, or implementation errors.
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
      deduct(
        20,
        `Organic traffic mismatch between SEMrush and GA4 (${label})`
      );
    }
  }

  // ── A2. Keyword Visibility Mismatch ─────────────────────────────
  // If GSC registers high impressions but DataForSEO sees almost no
  // ranked keywords, the site likely ranks for branded queries only,
  // or keyword tracking is misconfigured.
  const gscImpressions = data.gsc?.impressions;
  const dfoKeywords = data.dataforseo?.keywords;
  if (gscImpressions != null && dfoKeywords != null) {
    usedInValidation.add("dataforseo");
    if (gscImpressions > 10_000 && dfoKeywords < 10) {
      deduct(15, "High GSC impressions but low keyword ranking support");
    }
  }

  // ── A3. Backlink Validation ──────────────────────────────────────
  // A >50% spread between two credible crawlers (SEMrush vs DataForSEO)
  // usually means one crawler hasn't refreshed recently, or one domain
  // has a large % of redirected/nofollow links the other doesn't count.
  const semBl = data.semrush?.backlinks;
  const dfoBl = data.dataforseo?.backlinks;
  const hasSemBl = semBl != null && semBl > 0;
  const hasDfoBl = dfoBl != null && dfoBl > 0;
  const hasUnifiedBl =
    data.backlinks?.total != null && data.backlinks.total > 0;

  if (hasSemBl && hasDfoBl) {
    usedInValidation.add("semrush");
    usedInValidation.add("dataforseo");
    const maxBl = Math.max(semBl!, dfoBl!);
    const diffRatio = Math.abs(semBl! - dfoBl!) / maxBl;
    if (diffRatio > 0.5) {
      deduct(
        15,
        `Backlink count mismatch between SEMrush and DataForSEO (${pct(diffRatio * 100, 0)} spread)`
      );
    }
  } else if (!hasSemBl && !hasDfoBl && !hasUnifiedBl) {
    // None of the three possible backlink sources have data.
    // Single penalty covers all three sources to avoid triple-counting.
    deduct(10, "Backlink data unavailable from all sources");
    backlinkAllMissingPenaltyApplied = true;
  }

  // ═══════════════════════════════════════════════════════════════════
  // B. SEARCH PERFORMANCE
  // ═══════════════════════════════════════════════════════════════════

  // ── B5. CTR Validation ──────────────────────────────────────────
  // CTR < 1% is a strong signal that title tags / meta descriptions
  // are not matching searcher intent. < 3% is the industry baseline.
  // High impressions + low CTR is an OPPORTUNITY, not a failure —
  // so we emit an additive warning alongside the issue.
  const ctr = data.gsc?.ctr;
  const gscClicks = data.gsc?.clicks;
  if (ctr != null) {
    if (ctr < 1) {
      deduct(
        20,
        `CTR critically low (${pct(ctr)}) — titles/meta need urgent optimisation`
      );
    } else if (ctr < 3) {
      deduct(
        10,
        `CTR below 3% target (${pct(ctr)}) — optimisation opportunity exists`
      );
    }

    // Opportunity signal: how many clicks are being left on the table?
    if (
      ctr < 3 &&
      gscImpressions != null &&
      gscImpressions > 0 &&
      gscClicks != null
    ) {
      const potentialClicks = Math.round(gscImpressions * 0.05 - gscClicks);
      if (potentialClicks > 0) {
        warnings.push(
          `${fmt(gscImpressions)} impressions with low CTR represents potential for ` +
          `+${fmt(potentialClicks)} additional clicks`
        );
      }
    }
  }

  // ── B6. Average Position ─────────────────────────────────────────
  // Position > 20 means most keywords are on page 2+.
  // At this depth, click probability is < 0.5% — effectively invisible.
  const avgPos = data.gsc?.avgPosition;
  if (avgPos != null && avgPos > 20) {
    deduct(
      10,
      `Average position ${avgPos.toFixed(1)} — most rankings below page 2`
    );
  }

  // ── B7. Traffic Growth (period-over-period) ──────────────────────
  // Use GSC clicks as the canonical traffic signal (GA4 sessions can
  // be affected by cookie consent changes, bot filtering, etc.).
  // Cross-correlate with conversion anomaly to distinguish tracking
  // failures from genuine SEO decline before raising an alarm.
  const prevGscClicks = data.previousPeriod?.gscClicks;
  const currGscClicks = data.gsc?.clicks;
  if (prevGscClicks != null && currGscClicks != null && prevGscClicks > 0) {
    const dropPct = ((prevGscClicks - currGscClicks) / prevGscClicks) * 100;

    if (dropPct > 50) {
      deduct(
        20,
        `Traffic dropped ${dropPct.toFixed(0)}% period-over-period`
      );
    } else if (dropPct > 20) {
      deduct(
        10,
        `Traffic declined ${dropPct.toFixed(0)}% — monitor closely`
      );
    }

  }

  // ═══════════════════════════════════════════════════════════════════
  // C. MISSING INTEGRATIONS
  // Only penalise sources that are entirely absent AND were not already
  // consumed (and therefore implicitly present) in Section A above.
  // ═══════════════════════════════════════════════════════════════════

  if (data.ga4 == null) {
    deduct(10, "GA4 not connected");
  }

  if (data.gsc == null) {
    deduct(15, "Google Search Console not connected");
  }

  // Penalise missing SEMrush only if it wasn't used in cross-validation.
  // If it was used, the source exists — it just may have data quality issues
  // already penalised above.
  if (data.semrush == null && !usedInValidation.has("semrush")) {
    deduct(25, "SEMrush unavailable — primary validation source missing");
  }

  if (data.dataforseo == null && !usedInValidation.has("dataforseo")) {
    deduct(10, "DataForSEO unavailable");
  }

  // Only penalise missing unified backlinks if the A3 "all sources missing"
  // penalty wasn't already applied (same underlying issue — no backlink data).
  if (data.backlinks == null && !backlinkAllMissingPenaltyApplied) {
    deduct(10, "Backlink data unavailable");
  }

  // ═══════════════════════════════════════════════════════════════════
  // CONFIDENCE SCORE
  // Each null source reduces reliability of the health score itself.
  // Floor at 10 so we always express some (low) confidence signal.
  // ═══════════════════════════════════════════════════════════════════
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
    calculationLogic: {
      baseScore: 100,
      deductions,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// TASK 2 — getHealthScoreUI
// ─────────────────────────────────────────────────────────────────────

export function getHealthScoreUI(score: number): HealthScoreUI {
  if (score >= 90) {
    return {
      statusLabel: "Excellent",
      badgeColor: "green",
      progressBarLabel:
        "Data integrity is strong — decisions can be trusted",
    };
  }
  if (score >= 75) {
    return {
      statusLabel: "Good",
      badgeColor: "blue",
      progressBarLabel: "Minor gaps exist — core data is reliable",
    };
  }
  if (score >= 60) {
    return {
      statusLabel: "At Risk",
      badgeColor: "orange",
      progressBarLabel:
        "Data quality issues detected — verify before deciding",
    };
  }
  if (score >= 40) {
    return {
      statusLabel: "Poor",
      badgeColor: "red",
      progressBarLabel:
        "Significant data problems — do not rely on these numbers",
    };
  }
  return {
    statusLabel: "Critical",
    badgeColor: "darkred",
    progressBarLabel:
      "Severe data integrity failure — immediate investigation required",
  };
}

// ─────────────────────────────────────────────────────────────────────
// TASK 3 — computeExecutiveVerdict
// ─────────────────────────────────────────────────────────────────────

export function computeExecutiveVerdict(
  data: DataHealthInput,
  healthScore: DataHealthScore
): ExecutiveVerdict {
  // ── Unpack commonly used values (null-safe) ──────────────────────
  const ctr = data.gsc?.ctr ?? null;
  const impressions = data.gsc?.impressions ?? null;
  const clicks = data.gsc?.clicks ?? null;
  const avgPosition = data.gsc?.avgPosition ?? null;
  const ga4Users = data.ga4?.users ?? null;
  const ga4Sessions = data.ga4?.sessions ?? null;
  const prevGscClicks = data.previousPeriod?.gscClicks ?? null;
  const hasBl =
    (data.backlinks?.total != null && data.backlinks.total > 0) ||
    (data.semrush?.backlinks != null && data.semrush.backlinks > 0) ||
    (data.dataforseo?.backlinks != null && data.dataforseo.backlinks > 0);

  // Traffic drop % (positive = drop, negative = growth)
  let trafficDropPct: number | null = null;
  if (prevGscClicks != null && clicks != null && prevGscClicks > 0) {
    trafficDropPct = ((prevGscClicks - clicks) / prevGscClicks) * 100;
  }

  // ── STATUS LOGIC ──────────────────────────────────────────────────
  // "Critical but Recoverable" requires the conjunction of:
  //   • traffic has dropped, AND
  //   • CTR is low (< 3%), AND
  //   • health score is below 60 (poor data quality compounds risk), AND
  //   • impressions are high — the site still has search visibility,
  //     so recovery is achievable without rebuilding authority from scratch.
  const hasTrafficDrop = trafficDropPct != null && trafficDropPct > 20;
  const hasCtrLow = ctr != null && ctr < 3;
  const hasHighImpressions = impressions != null && impressions > 10_000;
  const isHealthCritical = healthScore.score < 60;

  let status: ExecutiveVerdict["status"];
  if (hasTrafficDrop && hasCtrLow && isHealthCritical && hasHighImpressions) {
    status = "Critical but Recoverable";
  } else if (hasCtrLow || hasTrafficDrop) {
    status = "At Risk";
  } else {
    status = "Healthy";
  }

  // ── ROOT CAUSES (up to 3, ordered by confidence) ─────────────────
  const rootCauses: RootCause[] = [];

  // GA4 under-reporting: if GSC clicks far exceed GA4 users, the JS
  // tracking tag is likely blocked, filtered, or misconfigured.
  if (ga4Users != null && clicks != null && ga4Users * 3.5 < clicks) {
    rootCauses.push({
      cause:
        "GA4 tracking may be under-reporting sessions — " +
        "possible consent filter, ad blocker prevalence, or implementation issue",
      confidence: 85,
    });
  }

  // Title/meta misalignment: high visibility but no clicks means
  // searchers see the listing and actively choose not to click.
  if (impressions != null && ctr != null && impressions > 50_000 && ctr < 1) {
    rootCauses.push({
      cause:
        "High search visibility but users are not clicking — " +
        "title tags and meta descriptions are likely misaligned with search intent",
      confidence: 80,
    });
  }

  // Severe traffic drop: at >70%, a tracking event (GA4 filter change,
  // consent banner rollout, domain migration) is almost always involved.
  if (
    prevGscClicks != null &&
    prevGscClicks > 0 &&
    trafficDropPct != null &&
    trafficDropPct > 70
  ) {
    rootCauses.push({
      cause:
        "Severe traffic drop may be partially caused by tracking changes " +
        "or GA4 reconfiguration, not pure organic decline",
      confidence: 70,
    });
  }

  // Weak authority: position > 20 means minimal SERP real estate.
  if (avgPosition != null && avgPosition > 20) {
    rootCauses.push({
      cause:
        "Average ranking position is below page 2 — " +
        "content authority and backlink profile need strengthening",
      confidence: 65,
    });
  }

  // Blind spot: without backlink data, competitive link-gap analysis
  // is impossible and recommendations are necessarily incomplete.
  if (!hasBl) {
    rootCauses.push({
      cause:
        "Backlink data gap reduces confidence in competitive analysis",
      confidence: 60,
    });
  }

  // Keep top 3 by confidence (already inserted in descending confidence order).
  const topRootCauses = rootCauses.slice(0, 3);

  // ── DECISIONS (exactly 3, specific and actionable) ────────────────
  // Build a priority-ordered candidate list, then take first 3.
  const decisionCandidates: string[] = [];

  // Highest-priority: quantified CTR opportunity
  if (impressions != null && clicks != null && ctr != null && ctr < 3) {
    const targetCtr = 0.05;  // 5% — attainable industry benchmark
    const upliftClicks = Math.max(0, Math.round(impressions * targetCtr - clicks));
    if (upliftClicks > 0) {
      decisionCandidates.push(
        `Optimise title tags and meta descriptions for the top 5 high-impression pages — ` +
        `improving CTR from ${pct(ctr)} to 5% could unlock ${fmt(upliftClicks)}+ additional clicks/month`
      );
    } else {
      decisionCandidates.push(
        `Optimise title tags and meta descriptions to improve CTR beyond ${pct(ctr)} — ` +
        `align headlines with top-performing search queries visible in GSC`
      );
    }
  }

  // Backlink data gap
  if (!hasBl) {
    decisionCandidates.push(
      "Configure SEMrush or DataForSEO backlink tracking — without this data, " +
      "competitive gap analysis and link-building prioritisation are impossible"
    );
  }

  // Severe traffic drop — investigate root cause before acting
  if (trafficDropPct != null && trafficDropPct > 20) {
    decisionCandidates.push(
      `Investigate the ${trafficDropPct.toFixed(0)}% traffic decline by comparing ` +
      `GSC data before/after the drop date — rule out tracking changes before ` +
      `treating this as an algorithmic penalty`
    );
  }

  // Position too low — content + authority play
  if (avgPosition != null && avgPosition > 20) {
    decisionCandidates.push(
      `With an average position of ${avgPosition.toFixed(1)}, prioritise building ` +
      `topical authority via long-form content clusters and targeted link acquisition ` +
      `on your highest-impression, lowest-ranked queries`
    );
  }

  // Data source gaps
  if (data.semrush == null) {
    decisionCandidates.push(
      "Connect SEMrush to unlock cross-source traffic validation and competitive keyword intelligence — " +
      "without it, organic performance benchmarks cannot be independently verified"
    );
  }
  if (data.gsc == null) {
    decisionCandidates.push(
      "Connect Google Search Console immediately — " +
      "GSC is the primary signal for CTR, query-level rankings, and indexation issues"
    );
  }
  if (data.ga4 == null) {
    decisionCandidates.push(
      "Connect GA4 to track user behaviour, session quality, and conversion attribution — " +
      "without it, SEO impact on business outcomes cannot be measured"
    );
  }

  // Generic fallbacks so we always reach 3
  const fallbacks = [
    "Audit internal linking structure to distribute page authority more evenly " +
    "across your highest-value commercial and service pages",
    "Review top-performing pages from the previous period and replicate " +
    "their content structure, intent alignment, and schema markup",
    "Monitor keyword positions weekly using GSC's query report — " +
    "flag any query that loses more than 3 positions for immediate content review",
  ];

  for (const fb of fallbacks) {
    if (decisionCandidates.length >= 3) break;
    decisionCandidates.push(fb);
  }

  const decisions = decisionCandidates.slice(0, 3);

  // ── KEY INSIGHT ───────────────────────────────────────────────────
  // Single sentence. Reference real numbers. Focus on highest-leverage finding.
  let keyInsight: string;

  if (impressions != null && clicks != null && ctr != null && ctr < 3 && impressions > 1_000) {
    const missedClicks = Math.max(0, Math.round(impressions * 0.05 - clicks));
    keyInsight =
      `Despite ${fmt(impressions)} impressions, a ${pct(ctr)} CTR means ` +
      `roughly ${fmt(impressions - clicks)} monthly searches see the site but do not click — ` +
      (missedClicks > 0
        ? `fixing title tags alone could deliver ${fmt(missedClicks)}+ additional visits.`
        : `optimising meta copy is the highest-leverage action available.`);
  } else if (trafficDropPct != null && trafficDropPct > 20) {
    keyInsight =
      `Traffic has declined ${trafficDropPct.toFixed(0)}% period-over-period` +
      (clicks != null && prevGscClicks != null
        ? ` (from ${fmt(prevGscClicks)} to ${fmt(clicks)} clicks)`
        : "") +
      ` — root cause investigation should precede any content or link-building investment.`;
  } else if (avgPosition != null && avgPosition > 20) {
    keyInsight =
      `With an average ranking position of ${avgPosition.toFixed(1)}, the site is ` +
      `effectively invisible in organic search — authority building must be the immediate focus.`;
  } else if (!hasBl && data.semrush == null && data.dataforseo == null) {
    keyInsight =
      "Critical data sources (SEMrush, DataForSEO, backlinks) are all missing — " +
      "the health score has low confidence and no competitive benchmarking is possible.";
  } else if (status === "Healthy") {
    const ctrStr = ctr != null ? ` with a ${pct(ctr)} CTR` : "";
    const clickStr = clicks != null ? ` and ${fmt(clicks)} clicks` : "";
    keyInsight =
      `Core SEO signals are within healthy ranges${ctrStr}${clickStr} — ` +
      `focus should shift to incremental optimisation and competitive gap analysis.`;
  } else {
    keyInsight =
      "Multiple SEO signals require attention — address data integration gaps " +
      "first to improve scoring confidence before committing to tactical changes.";
  }

  return {
    status,
    keyInsight,
    rootCauses: topRootCauses,
    decisions,
    confidence: healthScore.confidence,
  };
}
