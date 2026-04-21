import OpenAI from "openai";
import {
  getGSCSummary,
  getGSCTable,
  getGA4Metrics,
  getGA4TopPages,
  getGA4AIReferrers,
} from "./google-apis";
import { format, subDays } from "date-fns";

// ─── OpenAI Client ─────────────────────────────────────────────────────────────
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// ─── Enterprise SEO Report System Prompt ──────────────────────────────────────
export const SEO_REPORT_SYSTEM_PROMPT = `You are an enterprise-level SEO Reporting Agent. Your job is to analyze the provided SEO data and generate a structured, insight-driven, executive-ready SEO performance report.

## ROLE & PERSONA
You are a senior SEO strategist and data analyst working for a professional digital agency. You communicate in clear, confident, business-level English. Your audience is founders, executives, and senior decision-makers — not technical SEO teams. Avoid jargon. Focus on what happened, why it matters, and what to do next.

## DATA PIPELINE CONTEXT
You will receive data that has already passed through the following pipeline stages:
1. AGGREGATION — Raw data collected from active integrations: Google Search Console (GSC) — PRIMARY SOURCE, Google Analytics 4 (GA4) — PRIMARY SOURCE, SEMrush — Use ONLY if data is explicitly provided. If SEMrush data is present, always prioritize it over GSC/GA4 for competitive and keyword difficulty metrics. DataForSEO — Use ONLY if data is explicitly provided. If a data source is not provided, exclude it silently.
2. NORMALIZATION — KPIs are pre-standardized with: Current period metrics, Previous period metrics, Period-over-period change (absolute + percentage)
3. INSIGHT SYNTHESIS — You will perform: Trend detection across all metrics, Variance analysis, Correlation analysis across channels, Flag opportunities, risks, and anomalies
4. EXECUTIVE NARRATIVE — You will generate "What happened / Why it happened / What to do next" narrative for each section, Prioritized action items ranked by business impact
5. REPORT BUILDER — Output a clean, structured report following the exact section order below.

## CRITICAL DATA RULES
- Use ONLY the data provided. Never fabricate or estimate numbers.
- If a metric is unavailable, display: — (dash)
- If a metric is zero, display: 0
- Never use placeholder text like "insert data here"
- All percentage changes must be calculated correctly: Formula: ((Current - Previous) / Previous) × 100
- Positive change = growth (show with ▲ and green context)
- Negative change = decline (show with ▼ and risk context)
- Flat / no change = → Stable

## REPORT STRUCTURE

### SECTION 1 — EXECUTIVE SUMMARY
Write a 4–6 sentence narrative paragraph covering: Overall performance verdict (strong / mixed / declining), Single biggest win this period, Single biggest concern or risk, Top priority action for next period.

Then output a SNAPSHOT TABLE with these exact columns:
| Metric | Current Period | Previous Period | Change | Status |

Include these rows: Total Clicks (GSC), Total Impressions (GSC), Average CTR (GSC), Average Position (GSC), Sessions (GA4), Engagement Rate (GA4), Avg. Session Duration (GA4)

Status column values: ▲ Improved / ▼ Declined / → Stable

### SECTION 2 — KPI SNAPSHOT
For each metric, output:
**[Metric Name]**
Current: [value] | Previous: [value] | Change: [+/-X or +/-X%]
[One sentence AI interpretation of what this number means for the business]

Cover all 7 metrics from Section 1. Add a brief paragraph at the end summarizing the overall KPI health.

### SECTION 3 — TREND ANALYSIS
1. TRAFFIC TREND (GA4 Sessions): Describe the trend shape, identify peak/lowest point, explain probable causes, risk flag if declining
2. CLICK TREND (GSC Clicks): Same structure, note if GSC clicks and GA4 sessions are diverging
3. CORRELATION INSIGHT: Compare impressions vs clicks vs position together, call out contradictions

### SECTION 4 — TOP PERFORMING PAGES
Present the top landing pages table:
| # | Page URL | Users | Sessions | Notes |

After the table: AI observation on which pages are driving disproportionate value, flag declining pages, identify content gaps.

### SECTION 5 — KEYWORD PERFORMANCE

**5A — TOP KEYWORDS**
| # | Query | Clicks | Impressions | CTR | Avg. Position |
(Top 10 by clicks)
AI Insight: What these keywords reveal about search intent and brand strength.

**5B — OPPORTUNITY KEYWORDS**
| # | Query | Clicks | Impressions | CTR | Avg. Position |
Criteria: Position 4–20, Impressions > 100, CTR below average
AI Insight: Why these are high-value targets and what changes could move them into top 3.

**5C — DECLINING KEYWORDS**
| # | Query | Clicks | Impressions | CTR | Avg. Position |
Criteria: Keywords where position dropped 5+ places vs previous period OR clicks dropped >30%
AI Insight: Diagnose the likely cause. Recommend recovery action.

After all three tables, write a KEYWORD SUMMARY paragraph covering: Overall keyword portfolio health, Branded vs non-branded split (if identifiable), Dominant search intent, Prediction: which keywords are likely to improve next period.

### SECTION 6 — ISSUES & OPPORTUNITIES

**ISSUES IDENTIFIED**
For each issue:
⚠️ [Issue Title]
Observation: [What the data shows]
Impact: [Business consequence if not addressed]
Priority: High / Medium / Low

Cover: Low CTR pages/keywords, Engagement issues, Position volatility, Any metric that declined >20%

**OPPORTUNITIES IDENTIFIED**
For each opportunity:
✅ [Opportunity Title]
Observation: [What the data shows]
Potential Impact: [Estimated benefit if actioned]
Effort: Low / Medium / High

Cover: Quick-win keywords (positions 5–15 with high impressions), High-traffic pages with low engagement, Any positive trend to double down on.

### SECTION 7 — ACTIONABLE RECOMMENDATIONS
Output a prioritized action plan. Maximum 7 recommendations.

For each recommendation:
**[#]. [Recommendation Title]**
Why: [Data-backed reason from this report]
What to do: [Specific action — be precise, not generic]
Expected outcome: [What metric should improve and by roughly how much]
Timeline: Immediate (this week) / Short-term (this month) / Strategic (next quarter)
Owner: SEO Team / Content Team / Dev Team / All

Order by: Highest impact first.

### SECTION 8 — AI VISIBILITY (Brand Presence in AI Search)
If AI visibility data is provided, analyze it here. Show brand mention count across AI platforms, compare to previous period, highlight which AI platforms are driving awareness.

If no AI visibility data is provided, output: "AI visibility tracking is not yet configured for this client. We recommend enabling this to monitor brand presence in AI-powered search results (ChatGPT, Gemini, Perplexity, etc.)."

### SECTION 9 — FUTURE PREDICTIONS

**30-Day Outlook**: Expected click trajectory and why, Keywords most likely to enter top 3, Pages at risk of traffic drop.

**90-Day Outlook**: Estimated traffic growth if recommendations are implemented, Content opportunities, Competitive threats.

**Risk Scenarios**: List 2–3 scenarios that could negatively impact performance. State clearly: "These are AI-generated projections based on current data trends and are not guarantees."

### SECTION 10 — APPENDIX (if raw data is provided)
Include extended keyword table (beyond top 10) if more data exists. Include full page performance table if more pages exist. Label clearly as: "Extended Data — For Reference Only"

## FORMATTING RULES
- Use markdown headers (##, ###) for sections
- Use tables for all data
- Use bold for metric names and important findings
- Use ▲ ▼ → for trend indicators
- Use ⚠️ for risks and ✅ for opportunities
- Keep paragraphs under 5 sentences
- No filler phrases like "In conclusion" or "As we can see"
- Never repeat the same insight in two sections
- The report must feel like it was written by a senior strategist, not generated by a machine`;

// ─── Previous Period Calculator ────────────────────────────────────────────────
export function getPreviousPeriod(startDate: string, endDate: string): { prevStart: string; prevEnd: string } {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - daysDiff + 1);
  return {
    prevStart: format(prevStart, "yyyy-MM-dd"),
    prevEnd: format(prevEnd, "yyyy-MM-dd"),
  };
}

// ─── Data Block Builder ────────────────────────────────────────────────────────
function buildInputBlock(params: {
  domain: string;
  currentStart: string;
  currentEnd: string;
  previousStart: string;
  previousEnd: string;
  gscCurrent: any;
  gscPrevious: any;
  gscKeywords: any[];
  gscPages: any[];
  ga4Current: any;
  ga4Previous: any;
  ga4TopPages: any[];
  aiReferrers: any[];
}): string {
  const {
    domain, currentStart, currentEnd, previousStart, previousEnd,
    gscCurrent, gscPrevious, gscKeywords, gscPages,
    ga4Current, ga4Previous, ga4TopPages, aiReferrers,
  } = params;

  const pct = (cur: number, prev: number) => {
    if (!prev || prev === 0) return "N/A";
    return `${((cur - prev) / prev * 100).toFixed(1)}%`;
  };

  const gscSummaryBlock = `[GSC_SUMMARY]
Current Period (${currentStart} to ${currentEnd}):
  Total Clicks: ${gscCurrent?.clicks ?? 0}
  Total Impressions: ${gscCurrent?.impressions ?? 0}
  Average CTR: ${gscCurrent?.ctr ?? 0}%
  Average Position: ${gscCurrent?.position ?? 0}

Previous Period (${previousStart} to ${previousEnd}):
  Total Clicks: ${gscPrevious?.clicks ?? 0}
  Total Impressions: ${gscPrevious?.impressions ?? 0}
  Average CTR: ${gscPrevious?.ctr ?? 0}%
  Average Position: ${gscPrevious?.position ?? 0}

Period-over-Period Changes:
  Clicks: ${pct(gscCurrent?.clicks ?? 0, gscPrevious?.clicks ?? 0)}
  Impressions: ${pct(gscCurrent?.impressions ?? 0, gscPrevious?.impressions ?? 0)}
  CTR: ${pct(gscCurrent?.ctr ?? 0, gscPrevious?.ctr ?? 0)}
  Position: ${pct(gscCurrent?.position ?? 0, gscPrevious?.position ?? 0)} (lower is better)`;

  const avgCtr = gscKeywords.length > 0
    ? gscKeywords.reduce((s, k) => s + (k.ctr || 0), 0) / gscKeywords.length
    : 0;

  const topKeywords = gscKeywords.slice(0, 25);
  const gscKeywordsBlock = `[GSC_TOP_KEYWORDS]
${topKeywords.map((k, i) =>
    `${i + 1}. "${k.query || k.keyword}" | Clicks: ${k.clicks || 0} | Impressions: ${k.impressions || 0} | CTR: ${k.ctr || 0}% | Avg Position: ${k.position || 0}`
  ).join("\n")}

Average CTR across all keywords: ${avgCtr.toFixed(2)}%

Opportunity Keywords (Position 4-20, Impressions > 100, CTR below average):
${gscKeywords.filter(k =>
    (k.position || 0) >= 4 && (k.position || 0) <= 20 &&
    (k.impressions || 0) > 100 && (k.ctr || 0) < avgCtr
  ).slice(0, 10).map((k, i) =>
    `${i + 1}. "${k.query || k.keyword}" | Pos: ${k.position} | Clicks: ${k.clicks || 0} | Impressions: ${k.impressions || 0} | CTR: ${k.ctr || 0}%`
  ).join("\n") || "None identified"}`;

  const gscPagesBlock = `[GSC_TOP_PAGES]
${gscPages.slice(0, 15).map((p, i) =>
    `${i + 1}. ${p.page || p.url} | Clicks: ${p.clicks || 0} | Impressions: ${p.impressions || 0} | CTR: ${p.ctr || 0}% | Position: ${p.position || 0}`
  ).join("\n")}`;

  const ga4EngRate = ga4Current ? Math.round((ga4Current.engagementRate || 0) * 10000) / 100 : 0;
  const ga4PrevEngRate = ga4Previous ? Math.round((ga4Previous.engagementRate || 0) * 10000) / 100 : 0;
  // Prefer the new engagement-time fields (userEngagementDuration / sessions).
  // Fall back to the legacy avgSessionDuration key for any cached/DB rows.
  const ga4DurSec = ga4Current?.avgEngagementTimeSeconds ?? ga4Current?.avgSessionDuration ?? 0;
  const ga4DurFmt = ga4Current?.avgEngagementTimeFormatted
    ?? `${Math.floor(ga4DurSec / 60)}:${String(Math.floor(ga4DurSec % 60)).padStart(2, "0")}`;

  const ga4Block = `[GA4_SUMMARY]
Current Period (${currentStart} to ${currentEnd}):
  Sessions: ${ga4Current?.sessions ?? 0}
  Users: ${ga4Current?.totalUsers ?? 0}
  Engagement Rate: ${ga4EngRate}%
  Avg Session Duration: ${ga4DurFmt}
  Pageviews: ${ga4Current?.screenPageViews ?? 0}
  New Users: ${ga4Current?.newUsers ?? 0}
  Conversions: ${ga4Current?.conversions ?? 0}

Previous Period (${previousStart} to ${previousEnd}):
  Sessions: ${ga4Previous?.sessions ?? 0}
  Users: ${ga4Previous?.totalUsers ?? 0}
  Engagement Rate: ${ga4PrevEngRate}%

Period-over-Period Changes:
  Sessions: ${pct(ga4Current?.sessions ?? 0, ga4Previous?.sessions ?? 0)}
  Users: ${pct(ga4Current?.totalUsers ?? 0, ga4Previous?.totalUsers ?? 0)}
  Engagement Rate: ${pct(ga4EngRate, ga4PrevEngRate)}`;


  const ga4PagesBlock = `[GA4_TOP_PAGES]
${ga4TopPages.slice(0, 10).map((p, i) =>
    `${i + 1}. ${p.page} | Users: ${p.users || 0} | Sessions: ${p.sessions || 0} | Conversions: ${p.conversions || 0}`
  ).join("\n")}`;

  const aiBlock = aiReferrers.length > 0
    ? `[AI_REFERRERS]\n${aiReferrers.map((r, i) =>
        `${i + 1}. ${r.source} | Users: ${r.totalUsers || 0} | Sessions: ${r.sessions || 0}`
      ).join("\n")}`
    : `[AI_REFERRERS]\nNo AI referrer traffic detected in this period.`;

  return `${gscSummaryBlock}

${gscKeywordsBlock}

${gscPagesBlock}

${ga4Block}

${ga4PagesBlock}

${aiBlock}

[REPORTING_PERIOD]
Current: ${currentStart} to ${currentEnd}
Previous: ${previousStart} to ${previousEnd}

[CLIENT_INFO]
Domain: ${domain}
Client: ${domain}`;
}

// ─── Main Generator (streaming) ────────────────────────────────────────────────
export async function generateSeoReportStream(params: {
  domain: string;
  gscSiteUrl: string;
  propertyId: string;
  startDate: string;
  endDate: string;
  onChunk: (text: string) => void;
  onDone: () => void;
  onError: (err: string) => void;
}): Promise<void> {
  const { domain, gscSiteUrl, propertyId, startDate, endDate, onChunk, onDone, onError } = params;

  try {
    const { prevStart, prevEnd } = getPreviousPeriod(startDate, endDate);

    // Fetch all data sources in parallel (current + previous periods)
    const [
      gscCurResult, gscPrevResult,
      gscKeywordsResult, gscPagesResult,
      ga4CurResult, ga4PrevResult,
      ga4PagesResult, aiReferrersResult,
    ] = await Promise.allSettled([
      gscSiteUrl ? getGSCSummary(gscSiteUrl, startDate, endDate) : Promise.resolve(null),
      gscSiteUrl ? getGSCSummary(gscSiteUrl, prevStart, prevEnd) : Promise.resolve(null),
      gscSiteUrl ? getGSCTable(gscSiteUrl, startDate, endDate, "query", 500) : Promise.resolve([]),
      gscSiteUrl ? getGSCTable(gscSiteUrl, startDate, endDate, "page", 100) : Promise.resolve([]),
      propertyId ? getGA4Metrics(propertyId, startDate, endDate) : Promise.resolve(null),
      propertyId ? getGA4Metrics(propertyId, prevStart, prevEnd) : Promise.resolve(null),
      propertyId ? getGA4TopPages(propertyId, startDate, endDate, 15) : Promise.resolve([]),
      propertyId ? getGA4AIReferrers(propertyId, startDate, endDate) : Promise.resolve([]),
    ]);

    const gscCurrent = gscCurResult.status === "fulfilled" ? gscCurResult.value : null;
    const gscPrevious = gscPrevResult.status === "fulfilled" ? gscPrevResult.value : null;
    const gscKeywords = (gscKeywordsResult.status === "fulfilled" ? gscKeywordsResult.value : []) as any[];
    const gscPages = (gscPagesResult.status === "fulfilled" ? gscPagesResult.value : []) as any[];
    const ga4Current = ga4CurResult.status === "fulfilled" ? ga4CurResult.value : null;
    const ga4Previous = ga4PrevResult.status === "fulfilled" ? ga4PrevResult.value : null;
    const ga4TopPages = (ga4PagesResult.status === "fulfilled" ? ga4PagesResult.value : []) as any[];
    const aiReferrers = (aiReferrersResult.status === "fulfilled" ? aiReferrersResult.value : []) as any[];

    const inputBlock = buildInputBlock({
      domain, currentStart: startDate, currentEnd: endDate,
      previousStart: prevStart, previousEnd: prevEnd,
      gscCurrent, gscPrevious, gscKeywords, gscPages,
      ga4Current, ga4Previous, ga4TopPages, aiReferrers,
    });

    // Stream from OpenAI
    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: SEO_REPORT_SYSTEM_PROMPT },
        { role: "user", content: `Now generate the full enterprise SEO report using all provided data.\n\n${inputBlock}` },
      ],
      max_tokens: 8000,
      stream: true,
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || "";
      if (text) onChunk(text);
    }

    onDone();
  } catch (err: any) {
    onError(err?.message || "Failed to generate SEO report");
  }
}
