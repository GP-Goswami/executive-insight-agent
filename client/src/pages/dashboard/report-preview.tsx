import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useDomain } from "@/hooks/use-domain";
import { useToast } from "@/hooks/use-toast";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  Legend, Cell,
} from "recharts";
import {
  FileDown, RefreshCw, Users, MousePointerClick, Search, Target,
  TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, Info,
  BarChart3, Loader2, Eye, Percent, Bot, Link2, Database,
  XCircle, Activity, Clock, ShieldCheck, CircleHelp, ArrowUp,
  ArrowDown, ArrowRight, Zap, Layers,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { subDays } from "date-fns";
import type { DateRange } from "react-day-picker";
import { computeDataHealthScore, type DataHealthInput, type DataHealthScore } from "@/lib/compute-data-health";

// ── Interfaces ────────────────────────────────────────────────────────────────

interface SeoMetrics {
  traffic: { users: number; sessions: number; growthRate: number };
  search: { clicks: number; impressions: number; ctr: number; avgPosition: number; ctrGap: number };
  keywords: { total: number; top10: number; top10Percentage: number; improved: number; declined: number; netGrowth: number };
  conversions: { current: number; previous: number; delta: number; growthRate: number };
  backlinks: { current: number; previous: number; delta: number; referringDomains: number; referringDomainsDelta: number };
  opportunities: { page2KeywordsEstimate: boolean; lowCtrOpportunity: boolean };
}

interface Insight {
  type: "positive" | "warning" | "neutral";
  category: "traffic" | "keywords" | "ctr" | "opportunity" | "correlation" | "data-quality" | "conversions" | "backlinks";
  message: string;
}

interface DailyTrends {
  ga4Daily: { date: string; users: number; sessions: number }[];
  gscDaily: { date: string; clicks: number; impressions: number }[];
}

interface AiReferrer {
  source: string;
  totalUsers: number;
  sessions: number;
  percentOfTotal?: number;
}

interface ReportData {
  domain: string;
  dateRange: { start: string; end: string };
  metrics: SeoMetrics;
  insights: Insight[];
  summary: string;
  topPages: any[];
  topPagesSource: "gsc" | "ga4";
  dailyTrends: DailyTrends;
  keywordDistribution: { top3: number; top10: number; top20: number; top50: number; top100: number; beyond: number };
  aiReferrers: AiReferrer[];
  missingData: string[];
  // Future-proof: populated when SEMrush / DataForSEO / backlink integrations are configured
  semrush?: { organicTraffic?: number | null; keywords?: number | null; backlinks?: number | null } | null;
  dataforseo?: { keywords?: number | null; backlinks?: number | null } | null;
  reportBacklinks?: { total?: number | null } | null;
  previousPeriod?: { ga4?: { sessions?: number | null } | null; gsc?: { clicks?: number | null } | null } | null;
}

interface GscQueryRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface TrafficSummary {
  users: number;
  sessions: number;
  engagedSessions: number;
  avgEngagementTimeSeconds: number;
  avgEngagementTimeFormatted: string;
  engagementRate: number;
  source: string;
}

interface Ga4TopPage {
  page: string;
  screenPageViews: number;
  totalUsers: number;
  sessions: number;
  avgEngagementTimeSeconds: number;
  avgEngagementTimeFormatted: string;
  engagementRate: number;
}

interface CompetitorEntry {
  domain: string;
  sov: number;
  isReal: boolean;
  label?: string;
  organicTraffic?: number;
}

interface CompetitiveSovData {
  competitors: CompetitorEntry[];
  currentDomainSOV: number;
  dataSource: "semrush" | "fallback";
  semrushAvailable: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Show "—" when value is null/undefined. 0 is a legitimate value. */
function dash<T>(value: T | null | undefined, formatter: (v: T) => string = String): string {
  if (value === null || value === undefined) return "—";
  return formatter(value);
}

function fmtNum(v: number | null | undefined): string {
  return dash(v, (n) => n.toLocaleString());
}

function fmtPosition(v: number | null | undefined): string {
  if (v === null || v === undefined || v === 0) return "—";
  return v.toFixed(1);
}

function fmtPercent(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `${v}%`;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Derive a 1-sentence impact analysis from GSC keyword metrics. */
function keywordImpact(row: GscQueryRow): string {
  const { clicks, impressions, ctr, position } = row;
  if (position <= 3 && ctr >= 5) return "Strong top-3 ranking driving qualified search traffic.";
  if (position >= 11 && position <= 20 && impressions >= 200) return "Page 2 keyword — a small ranking push could unlock meaningful traffic.";
  if (impressions >= 500 && ctr < 2) return "High visibility but poor CTR — optimize title and meta description.";
  if (position <= 10 && clicks >= 50) return "Solid first-page ranking with steady click volume.";
  if (position > 20) return "Low visibility — consider dedicated content to improve ranking.";
  return "Tracking keyword — monitor position and CTR trends.";
}

/** Turn a warning insight into a recommendation sentence. */
function insightToRecommendation(ins: Insight): string {
  switch (ins.category) {
    case "ctr": return "Improve on-page titles and meta descriptions to lift CTR.";
    case "keywords": return "Prioritize page-2 keywords for quick ranking gains.";
    case "traffic": return "Investigate traffic source decline and diversify acquisition channels.";
    case "conversions": return "Audit landing pages and conversion funnels for friction points.";
    case "backlinks": return "Launch a targeted outreach campaign to rebuild referring domains.";
    case "data-quality": return "Reconnect or refresh the affected data source to restore reporting.";
    case "opportunity": return ins.message;
    default: return ins.message;
  }
}

// ── Feature 6: Root Cause Analysis ───────────────────────────────────────────

interface RootCause {
  rank: number;
  name: string;
  confidence: number;
  evidence: string;
}

function computeRootCauses(m: SeoMetrics): RootCause[] {
  const raw: Omit<RootCause, "rank">[] = [];

  if (m.traffic.users > 0 && m.traffic.users * 3.5 < m.search.clicks) {
    raw.push({
      name: "Tracking Anomaly",
      confidence: 85,
      evidence: `GA4: ${m.traffic.users.toLocaleString()} users vs GSC: ${m.search.clicks.toLocaleString()} clicks (${(m.search.clicks / m.traffic.users).toFixed(1)}x gap)`,
    });
  }
  if (m.search.impressions > 50_000 && m.search.ctr < 1) {
    raw.push({
      name: "AI Zero-Click Impact",
      confidence: 70,
      evidence: `${m.search.impressions.toLocaleString()} impressions at ${m.search.ctr.toFixed(2)}% CTR — users finding answers without clicking`,
    });
  }
  if (m.search.impressions > 10_000 && m.search.ctr < 2) {
    raw.push({
      name: "CTR Issue",
      confidence: 65,
      evidence: `${m.search.ctr.toFixed(2)}% CTR across ${m.search.impressions.toLocaleString()} impressions — well below the 3% industry benchmark`,
    });
  }
  if (m.traffic.growthRate < -50 && m.traffic.users > 0) {
    const prevUsers = Math.round(m.traffic.users / (1 + m.traffic.growthRate / 100));
    raw.push({
      name: "Traffic Source Decline",
      confidence: 60,
      evidence: `Traffic dropped from ~${prevUsers.toLocaleString()} to ${m.traffic.users.toLocaleString()} users (${Math.abs(m.traffic.growthRate).toFixed(0)}% decline)`,
    });
  }
  if (m.search.avgPosition > 30) {
    raw.push({
      name: "Technical SEO Issue",
      confidence: 55,
      evidence: `Average search position ${m.search.avgPosition.toFixed(1)} — site ranking outside the top 30 results`,
    });
  }

  return raw
    .sort((a, b) => b.confidence - a.confidence)
    .map((c, i) => ({ ...c, rank: i + 1 }));
}

function confidenceBarColor(confidence: number): string {
  if (confidence > 75) return "bg-emerald-400";
  if (confidence >= 50) return "bg-amber-400";
  return "bg-red-400";
}

function confidenceBadgeClass(confidence: number): string {
  if (confidence > 75) return "bg-emerald-500/15 text-emerald-400 border-emerald-400/30";
  if (confidence >= 50) return "bg-amber-500/15 text-amber-400 border-amber-400/30";
  return "bg-red-500/15 text-red-400 border-red-400/30";
}

// ── Feature 7: Brand Split ────────────────────────────────────────────────────

const BRAND_TERMS = ["truefirms", "true firms", "truefirm", "true firm"];

interface BrandSplitResult {
  brandClicks: number;
  nonBrandClicks: number;
  brandPct: number;
  nonBrandPct: number;
}

function computeBrandSplit(keywords: GscQueryRow[], totalClicks: number): BrandSplitResult {
  const brandClicks = keywords.reduce((sum, kw) => {
    const q = (kw.query ?? "").toLowerCase();
    return BRAND_TERMS.some((t) => q.includes(t)) ? sum + (kw.clicks ?? 0) : sum;
  }, 0);
  const nonBrandClicks = Math.max(0, totalClicks - brandClicks);
  const brandPct = totalClicks > 0 ? Math.round((brandClicks / totalClicks) * 100) : 0;
  return { brandClicks, nonBrandClicks, brandPct, nonBrandPct: 100 - brandPct };
}

// ── Feature 8: CTR Opportunity ────────────────────────────────────────────────

interface CtrOpportunity {
  page: string;
  impressions: number;
  currentClicks: number;
  currentCtr: number;
  potentialClicks: number;
  clickGap: number;
  isQuickWin: boolean;
}

function computeCtrOpportunities(pages: any[], source: "gsc" | "ga4"): CtrOpportunity[] {
  if (source !== "gsc") return [];
  const filtered = pages
    .filter((p) => (p.impressions ?? 0) > 500 && (p.ctr ?? 0) < 2)
    .sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0))
    .slice(0, 5)
    .map((p) => ({
      page: p.page ?? "",
      impressions: p.impressions ?? 0,
      currentClicks: p.clicks ?? 0,
      currentCtr: p.ctr ?? 0,
      potentialClicks: Math.round((p.impressions ?? 0) * 0.05),
      clickGap: Math.max(0, Math.round((p.impressions ?? 0) * 0.05) - (p.clicks ?? 0)),
      isQuickWin: false,
    }));
  if (filtered.length > 0) {
    const maxIdx = filtered.reduce((best, op, i) => op.clickGap > filtered[best].clickGap ? i : best, 0);
    filtered[maxIdx].isQuickWin = true;
  }
  return filtered;
}

function ctrCellClass(ctr: number): string {
  if (ctr < 0.5) return "bg-red-500/10 border-red-400/20 text-red-400";
  if (ctr < 2) return "bg-amber-500/10 border-amber-400/20 text-amber-400";
  return "bg-emerald-500/10 border-emerald-400/20 text-emerald-400";
}

function shortenPageUrl(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/$/, "") || "/";
    return path.length > 55 ? path.slice(0, 52) + "…" : path;
  } catch {
    return url.length > 55 ? url.slice(0, 52) + "…" : url;
  }
}

type DataHealth = { score: number; issues: string[] };

function computeDataHealth(
  m: SeoMetrics,
  hasSearchData: boolean,
  hasTrafficData: boolean,
  hasBacklinksData: boolean,
): DataHealth {
  let score = 100;
  const issues: string[] = [];

  if (!hasTrafficData)  { score -= 20; issues.push("GA4 traffic data is missing"); }
  if (!hasSearchData)   { score -= 20; issues.push("Google Search Console data is missing"); }
  if (!hasBacklinksData){ score -= 15; issues.push("Backlink data unavailable"); }

  return { score: Math.max(0, score), issues };
}

type VerdictStatus = "Critical" | "At Risk" | "Healthy";
type Verdict = { status: VerdictStatus; decisions: string[]; keyInsight: string };

function computeVerdict(
  m: SeoMetrics,
  hasSearchData: boolean,
  hasTrafficData: boolean,
  hasBacklinksData: boolean,
): Verdict {
  const ctr = m.search.ctr;
  const trafficGrowth = m.traffic.growthRate;

  let status: VerdictStatus = "Healthy";
  if ((hasSearchData && ctr < 1) || (hasTrafficData && trafficGrowth < -50)) status = "Critical";
  else if ((hasSearchData && ctr < 3) || (hasTrafficData && trafficGrowth < -20)) status = "At Risk";

  const decisions: string[] = [];
  if (hasSearchData && ctr < 3) decisions.push("Optimize meta titles and descriptions to improve CTR.");
  if (hasTrafficData && trafficGrowth < -20) decisions.push("Investigate and address the root cause of traffic decline.");
  if (!hasBacklinksData) decisions.push("Configure backlink tracking for a complete data picture.");  

  const filler = [
    "Review top-performing pages and replicate success patterns.",
    "Monitor keyword positions and capitalize on page-2 ranking opportunities.",
    "Audit internal linking to strengthen authority distribution across pages.",
  ];
  while (decisions.length < 3) decisions.push(filler[decisions.length] ?? filler[filler.length - 1]);

  let keyInsight = "Performance metrics are within expected range.";
  if (status === "Critical") {
    if (hasSearchData && ctr < 1) keyInsight = `CTR is critically low at ${ctr}% — search impressions are not converting to clicks.`;
    else if (hasTrafficData && trafficGrowth < -50) keyInsight = `Traffic dropped ${Math.abs(trafficGrowth)}% — immediate investigation required.`;
  } else if (status === "At Risk") {
    if (hasSearchData && ctr < 3) keyInsight = `CTR of ${ctr}% is below the 3% target — title and meta optimisation can unlock more clicks.`;
    else keyInsight = `Traffic declined ${Math.abs(trafficGrowth)}% — monitor trends closely and identify root causes.`;
  }

  return { status, decisions: decisions.slice(0, 3), keyInsight };
}

// ── Site Health Score ──────────────────────────────────────────────────────────

interface PillarResult {
  name: string;
  score: number;
  available: boolean;
  insight: string;
}

interface SiteHealthResult {
  overallScore: number;
  status: "Healthy" | "At Risk" | "Poor" | "Critical";
  statusColor: "green" | "yellow" | "orange" | "red";
  pillars: PillarResult[];
  summaryInsight: string;
  backlinksIncluded: boolean;
}

function computeSiteHealth(
  m: SeoMetrics,
  hasSearchData: boolean,
  hasTrafficData: boolean,
  hasBacklinksData: boolean,
  dataIntegrityScore: number,
  trafficSummary?: TrafficSummary | null,
): SiteHealthResult {
  const pillars: PillarResult[] = [];

  // Pillar 1: Search Visibility
  if (hasSearchData) {
    const ctr = m.search.ctr;
    const pos = m.search.avgPosition;
    const ctrScore = ctr >= 5 ? 100 : ctr >= 3 ? 75 : ctr >= 1 ? 50 : 25;
    const posBonus = pos <= 10 ? 25 : pos <= 20 ? 15 : pos <= 30 ? 5 : 0;
    pillars.push({
      name: "Search Visibility",
      score: Math.min(100, ctrScore + posBonus),
      available: true,
      insight: ctr < 1
        ? "CTR critically low — meta optimization urgent"
        : ctr < 3
        ? "CTR below target — titles need improvement"
        : pos > 20
        ? "Good CTR but rankings are deep"
        : "Search visibility performing well",
    });
  } else {
    pillars.push({ name: "Search Visibility", score: 0, available: false, insight: "No GSC data available" });
  }

  // Pillar 2: Content Quality
  if (trafficSummary && hasTrafficData) {
    const engRate = trafficSummary.engagementRate;
    const engTime = trafficSummary.avgEngagementTimeSeconds;
    const erScore = engRate >= 60 ? 50 : engRate >= 40 ? 35 : engRate >= 20 ? 20 : 10;
    const etScore = engTime >= 120 ? 50 : engTime >= 60 ? 35 : engTime >= 30 ? 20 : 10;
    pillars.push({
      name: "Content Quality",
      score: Math.min(100, erScore + etScore),
      available: true,
      insight: engRate < 40
        ? "Low engagement — content relevance needs review"
        : engTime < 30
        ? "Short dwell time — content depth lacking"
        : "Audience engaging well with content",
    });
  } else if (hasTrafficData) {
    pillars.push({ name: "Content Quality", score: 60, available: true, insight: "Engagement details unavailable — partial score" });
  } else {
    pillars.push({ name: "Content Quality", score: 0, available: false, insight: "No GA4 data available" });
  }

  // Pillar 3: Data Integrity — use pre-computed score passed in, no recomputation
  pillars.push({
    name: "Data Integrity",
    score: dataIntegrityScore,
    available: true,
    insight: dataIntegrityScore >= 80 ? "All data sources connected" : "Some data sources missing",
  });

  // Pillar 4: Traffic Health
  if (hasTrafficData) {
    const growth = m.traffic.growthRate;
    const trendScore = growth >= 20 ? 75 : growth >= 0 ? 60 : growth >= -20 ? 40 : 15;
    const mmRatio = hasSearchData && m.search.clicks > 0 && m.traffic.users > 0
      ? m.search.clicks / m.traffic.users : 1;
    const mmBonus = mmRatio < 2 ? 25 : mmRatio < 5 ? 15 : 5;
    pillars.push({
      name: "Traffic Health",
      score: Math.min(100, trendScore + mmBonus),
      available: true,
      insight: growth < -50
        ? "Severe traffic decline — urgent investigation needed"
        : growth < -20
        ? "Traffic declining — monitor and investigate"
        : growth >= 0
        ? "Traffic stable or growing"
        : "Slight traffic dip — watch trends",
    });
  } else {
    pillars.push({ name: "Traffic Health", score: 0, available: false, insight: "No GA4 traffic data" });
  }

  // Pillar 5: Authority (Backlinks) — weight=0 when unavailable
  if (hasBacklinksData) {
    const bd = m.backlinks.delta;
    const rdd = m.backlinks.referringDomainsDelta;
    const deltaScore = bd > 50 ? 60 : bd > 0 ? 45 : bd > -20 ? 30 : 10;
    const domainScore = rdd > 0 ? 40 : rdd === 0 ? 25 : 10;
    pillars.push({
      name: "Authority (Backlinks)",
      score: Math.min(100, deltaScore + domainScore),
      available: true,
      insight: bd < 0 ? "Losing backlinks — monitor for link rot" : bd > 0 ? "Backlink profile growing" : "Backlink profile stable",
    });
  } else {
    pillars.push({ name: "Authority (Backlinks)", score: 0, available: false, insight: "Configure backlink tracking to unlock this pillar" });
  }

  // Dynamic weights: available pillars share equally, unavailable get weight=0
  const available = pillars.filter(p => p.available);
  const weight = available.length > 0 ? 1 / available.length : 0;
  const overallScore = Math.round(pillars.reduce((s, p) => s + (p.available ? p.score * weight : 0), 0));

  const status: SiteHealthResult["status"] =
    overallScore >= 85 ? "Healthy" : overallScore >= 65 ? "At Risk" : overallScore >= 40 ? "Poor" : "Critical";
  const statusColor: SiteHealthResult["statusColor"] =
    status === "Healthy" ? "green" : status === "At Risk" ? "yellow" : status === "Poor" ? "orange" : "red";

  const worst = available.reduce<PillarResult | undefined>((w, p) => (!w || p.score < w.score ? p : w), undefined);
  const summaryInsight = available.length === 0
    ? "No data available to compute site health."
    : `${available.length} of 5 pillars active. ${worst ? `Weakest: ${worst.name} (${worst.score}/100).` : ""}`;

  return { overallScore, status, statusColor, pillars, summaryInsight, backlinksIncluded: hasBacklinksData };
}

// ── Forecast ──────────────────────────────────────────────────────────────────

interface ForecastInput {
  currentUsers: number;
  currentClicks: number;
  currentImpressions: number;
  currentCtr: number;
  previousClicks: number | null;
  previousUsers: number | null;
}

interface ForecastResult {
  withAction: { users: number; clicks: number; changePercent: number; additionalClicks: number; insight: string };
  noAction: { users: number; clicks: number; changePercent: number; insight: string };
  confidence: number;
  methodology: {
    rawDeclineRate: number | null;
    trendDecline: number;
    ctrImprovementRate: number;
    dataSource: "trend-based" | "default";
  };
}

function computeForecast(input: ForecastInput): ForecastResult {
  const { currentUsers, currentClicks, currentImpressions, currentCtr, previousClicks, previousUsers } = input;
console.log('=== FORECAST DEBUG ===', {
  currentUsers:   currentUsers,
  currentClicks:  currentClicks,
  previousClicks: previousClicks,
  previousUsers:  previousUsers,
  fullPrevious:   null,
  impressions:    currentImpressions,
  ctr:            currentCtr
})
  // Step 1 — actual trend rate (dampened)
  let rawDeclineRate: number | null = null;
  let trendDecline: number;
  if (previousClicks != null && previousClicks > 0 && currentClicks >= 0) {
    rawDeclineRate = (previousClicks - currentClicks) / previousClicks;
    const dampened = rawDeclineRate * 0.3;
    trendDecline = Math.min(Math.max(dampened, -0.15), 0.40);
  } else {
    trendDecline = 0.10;
  }

  // Step 2 — CTR improvement potential
  let ctrImprovementRate: number;
  if (currentCtr < 5 && currentImpressions > 0 && currentClicks > 0) {
    const ratio = Math.min((currentImpressions * 0.05) / currentClicks, 2.0);
    ctrImprovementRate = Math.min(Math.max((ratio - 1) * 0.4, 0.10), 0.60);
  } else {
    ctrImprovementRate = 0.10;
  }

  // Step 3 — confidence
  let confidence = 50;
  if (previousClicks != null && previousClicks > 0) confidence += 20;
  if (previousUsers != null && previousUsers > 0) confidence += 10;
  if (currentImpressions > 0) confidence += 10;
  if (currentCtr > 0) confidence += 10;
  if (rawDeclineRate != null && rawDeclineRate > 0.80) confidence -= 15;
  if (rawDeclineRate != null && rawDeclineRate > 0.50) confidence -= 10;
  confidence = Math.min(Math.max(confidence, 30), 85);

  // Step 4 — projections
  const noActionClicks  = Math.round(currentClicks * (1 - trendDecline));
  const noActionUsers   = Math.round(currentUsers  * (1 - trendDecline));
  const noActionPct     = Math.round(-trendDecline * 100);
  const withActionClicks = Math.round(currentClicks * (1 + ctrImprovementRate));
  const withActionUsers  = Math.round(currentUsers  * (1 + ctrImprovementRate));
  const withActionPct    = Math.round(ctrImprovementRate * 100);
  const additionalClicks = withActionClicks - currentClicks;

  // Step 5 — insight texts
  const rawPct = rawDeclineRate != null ? Math.round(rawDeclineRate * 100) : 0;
  const noActionInsight =
    trendDecline > 0.30
      ? `Current ${rawPct}% traffic decline is projected to continue at a dampened rate. Without intervention, expect further loss.`
      : trendDecline > 0.10
      ? "Moderate decline trend detected. Traffic expected to decrease without optimization."
      : "Traffic appears to be stabilizing. Small decline expected if no action taken.";

  const withActionInsight =
    ctrImprovementRate > 0.40
      ? `Significant CTR improvement opportunity detected. Fixing title tags for top pages could recover +${additionalClicks.toLocaleString()} clicks.`
      : ctrImprovementRate > 0.20
      ? `Moderate CTR improvement potential. Meta optimization and content fixes could add +${additionalClicks.toLocaleString()} clicks.`
      : "Limited CTR gap — focus on ranking improvements to drive meaningful traffic growth.";

  return {
    noAction:   { users: noActionUsers,   clicks: noActionClicks,  changePercent: noActionPct,  insight: noActionInsight  },
    withAction: { users: withActionUsers, clicks: withActionClicks, changePercent: withActionPct, additionalClicks, insight: withActionInsight },
    confidence,
    methodology: {
      rawDeclineRate,
      trendDecline,
      ctrImprovementRate,
      dataSource: previousClicks != null && previousClicks > 0 ? "trend-based" : "default",
    },
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ReportPreviewPage() {
  const { domain, ga4PropertyId, gscSiteUrl } = useDomain();
  const { toast } = useToast();
  const [isDownloading, setIsDownloading] = useState(false);
  const [competitiveSov, setCompetitiveSov] = useState<CompetitiveSovData | null>(null);

  const defaultRange: DateRange = { from: subDays(new Date(), 29), to: subDays(new Date(), 1) };
  const [dateRange, setDateRange] = useState<DateRange | undefined>(defaultRange);
  const [appliedRange, setAppliedRange] = useState<DateRange | undefined>(defaultRange);

  const handleApply = () => setAppliedRange(dateRange);

  const startStr = appliedRange?.from ? ymd(appliedRange.from) : "";
  const endStr = appliedRange?.to ? ymd(appliedRange.to) : "";

  // ── Main report data (KPIs, insights, trends, top pages, AI referrers) ────
  const { data: report, isLoading, error, refetch, isFetching } = useQuery<ReportData>({
    queryKey: ["/api/report-data", ga4PropertyId, domain, startStr, endStr],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (ga4PropertyId) params.set("propertyId", ga4PropertyId);
      if (domain) params.set("domain", domain);
      if (gscSiteUrl) params.set("gscSiteUrl", gscSiteUrl);
      if (startStr) params.set("start", startStr);
      if (endStr) params.set("end", endStr);
      const res = await fetch(`/api/report-data?${params}`, { credentials: "include" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to load report data");
      }
      return res.json();
    },
    enabled: !!ga4PropertyId,
  });

  // ── Top 10 keywords — /api/metrics/gsc/top-keywords ──────────────────────
  // Backend uses dimensions=["query"], rowLimit=100, dataState="final"
  // (matches user's curl). We fetch 100 and display the top 10.
  const { data: keywordsResponse, isLoading: keywordsLoading } = useQuery<{ data: GscQueryRow[] }>({
    queryKey: ["/api/metrics/gsc/top-keywords", gscSiteUrl, startStr, endStr],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (gscSiteUrl) params.set("siteUrl", gscSiteUrl);
      if (startStr) params.set("start", startStr);
      if (endStr) params.set("end", endStr);
      params.set("rowLimit", "100");
      const res = await fetch(`/api/metrics/gsc/top-keywords?${params}`, { credentials: "include" });
      if (!res.ok) return { data: [] };
      return res.json();
    },
    enabled: !!gscSiteUrl && !!startStr && !!endStr,
  });

  const topKeywords = (keywordsResponse?.data || [])
    .slice()
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, 10);

  // ── Traffic Summary — reuses the Analytics → Traffic page endpoint ────────
  // All 5 fields: Users, Sessions, Engaged Sessions, Engagement Rate, Avg Engagement Time
  const { data: trafficSummary, isLoading: trafficSummaryLoading } = useQuery<TrafficSummary>({
    queryKey: ["/api/metrics/ga4/traffic", ga4PropertyId, startStr, endStr],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (ga4PropertyId) params.set("propertyId", ga4PropertyId);
      if (startStr) params.set("start", startStr);
      if (endStr) params.set("end", endStr);
      const res = await fetch(`/api/metrics/ga4/traffic?${params}`, { credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Failed to fetch traffic summary");
      return json;
    },
    enabled: !!ga4PropertyId && !!startStr && !!endStr,
    retry: false,
  });

  // ── GA4 Top Pages (extended) — propertyId + dates come from user selection ─
  // pagePath x [screenPageViews, totalUsers, sessions, engagementRate] + avgEngagementTime (userEngagementDuration/sessions)
  const { data: ga4TopPagesResponse, isLoading: ga4TopPagesLoading } = useQuery<{ data: Ga4TopPage[] }>({
    queryKey: ["/api/metrics/ga4/top-pages-extended", ga4PropertyId, startStr, endStr],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (ga4PropertyId) params.set("propertyId", ga4PropertyId);
      if (startStr) params.set("start", startStr);
      if (endStr) params.set("end", endStr);
      params.set("limit", "10");
      const res = await fetch(`/api/metrics/ga4/top-pages-extended?${params}`, { credentials: "include" });
      if (!res.ok) return { data: [] };
      return res.json();
    },
    enabled: !!ga4PropertyId && !!startStr && !!endStr,
    retry: false,
  });

  const ga4TopPages = ga4TopPagesResponse?.data || [];

  // Fetch competitive SOV — uses SEMrush when configured, fallback estimates otherwise
  useEffect(() => {
    setCompetitiveSov(null);
    if (!report) return;
    const imps = report.metrics.search.impressions;
    const clks = report.metrics.search.clicks;
    if (!imps || !clks) return;
    const params = new URLSearchParams({
      domain,
      impressions: imps.toString(),
      clicks: clks.toString(),
    });
    fetch(`/api/competitive-sov?${params}`, { credentials: "include" })
      .then((r) => r.json())
      .then((data: CompetitiveSovData) => setCompetitiveSov(data))
      .catch((err) => console.error("Competitive SOV fetch failed:", err));
  }, [report, domain]);

  const handleDownloadPdf = async () => {
    if (!report) return;
    setIsDownloading(true);
    try {
      // Build a snapshot of everything already rendered on screen so the PDF
      // shows identical data without any re-fetching on the backend.
      const snapshot = {
        metrics: report.metrics,
        insights: report.insights,
        summary: report.summary,
        topPages: report.topPages,
        topPagesSource: report.topPagesSource,
        dailyTrends: report.dailyTrends,
        keywordDistribution: report.keywordDistribution,
        aiReferrers: report.aiReferrers || [],
        keywords: topKeywords,
        trafficSummary: trafficSummary || null,
        ga4TopPages: ga4TopPages,
        // Pre-computed client-side so PDF renders identically to preview
        rootCauses: computeRootCauses(m),
        brandSplit,
        ctrOpportunities,
        dataHealth: {
          score: dataHealthResult.score,
          issues: dataHealthResult.issues,
          warnings: dataHealthResult.warnings,
          confidence: dataHealthResult.confidence,
        },
        siteHealth: {
          overallScore: siteHealth.overallScore,
          status: siteHealth.status,
          statusColor: siteHealth.statusColor,
          backlinksIncluded: siteHealth.backlinksIncluded,
          pillars: siteHealth.pillars,
        },
        executiveVerdict: {
          status: verdict.status,
          keyInsight: verdict.keyInsight,
          decisions: verdict.decisions,
        },
        competitiveSOV: {
          truefirmsSOV: competitiveSov?.currentDomainSOV ?? Math.round(sovPct * 10) / 10,
          gap: competitiveSov
            ? Math.max(0, (competitiveSov.competitors[0]?.sov ?? 72) - competitiveSov.currentDomainSOV)
            : Math.max(0, Math.round(72 - sovPct)),
          monthlyClicksNeeded: competitiveSov
            ? Math.round(Math.max(0, (competitiveSov.competitors[0]?.sov ?? 72) - competitiveSov.currentDomainSOV) / 100 * m.search.impressions * 0.05)
            : sovGapClicks,
          competitors: (competitiveSov?.competitors ?? []).map((c) => ({
            domain: c.domain,
            sov: c.sov,
            isReal: c.isReal,
            label: c.label,
            organicTraffic: c.organicTraffic,
          })),
          dataSource: competitiveSov?.dataSource ?? "fallback",
          semrushAvailable: competitiveSov?.semrushAvailable ?? false,
        },
        forecast: {
          noAction: {
            users: forecast.noAction.users,
            clicks: forecast.noAction.clicks,
            changePercent: forecast.noAction.changePercent,
            insight: forecast.noAction.insight,
          },
          withAction: {
            users: forecast.withAction.users,
            clicks: forecast.withAction.clicks,
            changePercent: forecast.withAction.changePercent,
            additionalClicks: forecast.withAction.additionalClicks,
            insight: forecast.withAction.insight,
          },
          confidence: forecast.confidence,
          methodology: forecast.methodology,
        },
      };

      const body = { domain, start: startStr, end: endStr, snapshot };
      const res = await fetch("/api/generate-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "PDF generation failed");
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition");
      const filenameMatch = disposition?.match(/filename="(.+)"/);
      const filename = filenameMatch?.[1] || "seo-report.pdf";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "PDF Downloaded", description: `Report saved as ${filename}` });
    } catch (err) {
      toast({ title: "Download Failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setIsDownloading(false);
    }
  };

  const handleRegenerate = () => {
    refetch();
    toast({ title: "Regenerating Report", description: "Fetching latest data and insights..." });
  };

  // ── Guard states ──────────────────────────────────────────────────────────
  if (!ga4PropertyId || !domain) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center" data-testid="report-no-domain">
        <BarChart3 className="h-16 w-16 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">No Domain Selected</h2>
        <p className="text-muted-foreground max-w-md">
          Please select a domain and configure GA4 Property ID in Settings to generate a report.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[900px] mx-auto" data-testid="report-loading">
        <Skeleton className="h-10 w-72" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[88px] rounded-xl" />)}
        </div>
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center" data-testid="report-error">
        <AlertTriangle className="h-16 w-16 text-destructive mb-4" />
        <h2 className="text-xl font-semibold mb-2">Failed to Load Report</h2>
        <p className="text-muted-foreground mb-4">{(error as Error).message}</p>
        <Button onClick={handleRegenerate} variant="outline" data-testid="button-retry">
          <RefreshCw className="h-4 w-4 mr-2" /> Retry
        </Button>
      </div>
    );
  }

  if (!report) return null;

  // ── Derived data ──────────────────────────────────────────────────────────
  const m = report.metrics;
  const hasSearchData = m.search.impressions > 0;
  const hasTrafficData = m.traffic.users > 0 || m.traffic.sessions > 0;
  const hasBacklinksData = m.backlinks.current > 0 || m.backlinks.referringDomains > 0;
  const hasKeywords = topKeywords.length > 0;

  const risks = report.insights.filter(i => i.type === "warning");
  const positives = report.insights.filter(i => i.type === "positive");
  const neutrals = report.insights.filter(i => i.type === "neutral");
  const recommendations = risks.map(insightToRecommendation);

  const hasTrafficChart = report.dailyTrends.ga4Daily.length > 1;
  const hasSearchChart = report.dailyTrends.gscDaily.length > 1;

  const totalAiUsers = (report.aiReferrers || []).reduce((s, r) => s + r.totalUsers, 0);
  const totalAiSessions = (report.aiReferrers || []).reduce((s, r) => s + r.sessions, 0);

  // ── Build DataHealthInput from available report data ─────────────────────────
  // GA4 and GSC come from metrics; semrush/dataforseo/backlinks/previousPeriod are
  // null until those integrations are configured — penalties fire automatically.
  const healthInput: DataHealthInput = {
    semrush: report.semrush?.organicTraffic != null
      ? { organicTraffic: report.semrush.organicTraffic, keywords: report.semrush.keywords ?? null, backlinks: report.semrush.backlinks ?? null }
      : null,
    ga4: (m.traffic.users > 0 || m.traffic.sessions > 0)
      ? { sessions: m.traffic.sessions, users: m.traffic.users }
      : null,
    gsc: m.search.impressions > 0
      ? { clicks: m.search.clicks, impressions: m.search.impressions, ctr: m.search.ctr, avgPosition: m.search.avgPosition }
      : null,
    dataforseo: report.dataforseo?.keywords != null
      ? { keywords: report.dataforseo.keywords, backlinks: report.dataforseo.backlinks ?? null }
      : null,
    backlinks: (m.backlinks.current > 0)
      ? { total: m.backlinks.current }
      : (report.reportBacklinks?.total != null ? { total: report.reportBacklinks.total } : null),
    previousPeriod: report.previousPeriod != null
      ? { ga4Sessions: report.previousPeriod.ga4?.sessions ?? null, gscClicks: report.previousPeriod.gsc?.clicks ?? null }
      : null,
  };

  const dataHealthResult: DataHealthScore = computeDataHealthScore(healthInput);

  if (process.env.NODE_ENV === "development") {
    console.group("=== DATA HEALTH SCORE DEBUG ===");
    console.log("Input:", JSON.stringify(healthInput, null, 2));
    console.log("Score:", dataHealthResult.score);
    console.log("Issues:", dataHealthResult.issues);
    console.log("Warnings:", dataHealthResult.warnings);
    console.log("Confidence:", dataHealthResult.confidence);
    console.log("Deductions:");
    dataHealthResult.calculationLogic.deductions.forEach(d => {
      console.log(`  - ${d.reason}: ${d.value} pts`);
    });
    console.groupEnd();
  }

  const verdict = computeVerdict(m, hasSearchData, hasTrafficData, hasBacklinksData);
  const siteHealth = computeSiteHealth(m, hasSearchData, hasTrafficData, hasBacklinksData, dataHealthResult.score, trafficSummary);

  // Features 6-8: computed client-side from existing fetched data
  const rootCauses = computeRootCauses(m);
  const allKeywords: GscQueryRow[] = keywordsResponse?.data || [];
  const brandSplit = computeBrandSplit(allKeywords, m.search.clicks);
  const ctrOpportunities = computeCtrOpportunities(report.topPages, report.topPagesSource);
  const totalCtrGain = ctrOpportunities.reduce((s, op) => s + op.clickGap, 0);

  // Features 9–11: client-side derived, zero new API calls
  const aiReferrers = report.aiReferrers || [];
  const hasAiData = aiReferrers.length > 0;

  const sovPct = m.search.impressions > 0
    ? Math.min(100, (m.search.clicks / (m.search.impressions * 0.05)) * 100)
    : 0;
  const sovGapClicks = Math.max(0, Math.round(((72 - sovPct) / 100) * m.search.impressions * 0.05));
  const sovChartData = competitiveSov
    ? [
        { name: "TrueFirms", sov: Math.round(competitiveSov.currentDomainSOV * 10) / 10 },
        ...competitiveSov.competitors.map((c) => ({
          name: c.isReal ? c.domain.replace(/^www\./, "") : (c.label ?? c.domain.replace(/^www\./, "")),
          sov: c.sov,
        })),
      ]
    : [
        { name: "TrueFirms", sov: Math.round(sovPct * 10) / 10 },
        { name: "Clutch", sov: 72 },
        { name: "GoodFirms", sov: 65 },
      ];

  const forecast = computeForecast({
    currentUsers: m.traffic.users,
    currentClicks: m.search.clicks,
    currentImpressions: m.search.impressions,
    currentCtr: m.search.ctr,
    previousClicks: report.previousPeriod?.gsc?.clicks ?? null,
    previousUsers: report.previousPeriod?.ga4?.sessions ?? null,
  });

  // Data availability matrix (RULE 8 - section 10)
  const availability: { source: string; connected: boolean; reason?: string }[] = [
    { source: "Google Analytics 4 (Users, Sessions)", connected: hasTrafficData, reason: !hasTrafficData ? "No GA4 data for selected range" : undefined },
    { source: "Google Search Console (Clicks, Impressions, CTR, Position)", connected: hasSearchData, reason: !hasSearchData ? "No GSC data for selected range" : undefined },
    { source: "GSC Keywords (Top Queries)", connected: hasKeywords, reason: !hasKeywords ? "No keyword data returned" : undefined },
    { source: "Backlinks (SEMrush / DataForSEO)", connected: hasBacklinksData, reason: !hasBacklinksData ? "Backlink data unavailable — configure SEMrush or DataForSEO API" : undefined },
    { source: "AI Referrer Traffic", connected: (report.aiReferrers || []).length > 0 },
  ];

  return (
    <div className="space-y-8 max-w-[900px] mx-auto pb-10" data-testid="report-preview-page">
      {/* ══════════════ Header ══════════════ */}
      <div className="flex flex-col gap-4 border-b border-border/40 pb-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-1">Preview Report</p>
            <h1 className="text-2xl font-bold tracking-tight">SEO Performance Report</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {report.domain}
              <span className="mx-2 text-border">|</span>
              {report.dateRange.start} to {report.dateRange.end}
            </p>
          </div>
          <div className="flex gap-3 shrink-0">
            <Button variant="outline" size="sm" onClick={handleRegenerate} disabled={isFetching} className="gap-2" data-testid="button-regenerate">
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} /> Regenerate
            </Button>
            <Button size="sm" onClick={handleDownloadPdf} disabled={isDownloading} className="gap-2" data-testid="button-download-pdf">
              {isDownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
              Download PDF
            </Button>
          </div>
        </div>
        <DateRangePicker dateRange={dateRange} onDateRangeChange={setDateRange} onApply={handleApply} />
      </div>

      {isFetching && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="report-fetching">
          <Loader2 className="h-4 w-4 animate-spin" />
          Updating report data...
        </div>
      )}

      {/* ══════════════ DATA HEALTH + VERDICT ══════════════ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DataHealthBanner
          score={dataHealthResult.score}
          issues={dataHealthResult.issues}
          warnings={dataHealthResult.warnings}
          confidence={dataHealthResult.confidence}
          deductions={dataHealthResult.calculationLogic.deductions}
        />
        <ExecutiveVerdict status={verdict.status} decisions={verdict.decisions} keyInsight={verdict.keyInsight} />
      </div>

      {/* ══════════════ 1. KPI SNAPSHOT ══════════════ */}
      <section data-testid="kpi-grid">
        <SectionHeading>1. KPI Snapshot</SectionHeading>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {/* GA4 */}
          <KpiCard
            title="Users" icon={Users} subtitle="GA4" testId="kpi-users"
            value={hasTrafficData ? fmtNum(m.traffic.users) : "—"}
            delta={hasTrafficData ? m.traffic.growthRate : undefined}
            tooltip="Total unique users who visited the site in the selected period"
          />
          <KpiCard
            title="Sessions" icon={MousePointerClick} subtitle="GA4" testId="kpi-sessions"
            value={hasTrafficData ? fmtNum(m.traffic.sessions) : "—"}
            tooltip="Total visits (sessions) in the selected period"
          />
          {/* GSC */}
          <KpiCard
            title="Clicks" icon={Search} subtitle="GSC" testId="kpi-clicks"
            value={hasSearchData ? fmtNum(m.search.clicks) : "—"}
            tooltip="Total clicks from Google Search results"
          />
          <KpiCard
            title="Impressions" icon={Eye} subtitle="GSC" testId="kpi-impressions"
            value={hasSearchData ? fmtNum(m.search.impressions) : "—"}
            tooltip="Times your site appeared in Google Search results"
          />
          <KpiCard
            title="CTR" icon={Percent} subtitle="GSC" testId="kpi-ctr"
            value={hasSearchData ? fmtPercent(m.search.ctr) : "—"}
            delta={hasSearchData ? (m.search.ctrGap <= 0 ? 1 : -1) : undefined}
            status={hasSearchData ? (m.search.ctr >= 5 ? "healthy" : m.search.ctr >= 1 ? "warning" : "danger") : undefined}
            tooltip="Click-through rate: % of impressions resulting in a click. Target: 3–5%"
          />
          <KpiCard
            title="Avg Position" icon={Target} subtitle="GSC" testId="kpi-position"
            value={hasSearchData ? fmtPosition(m.search.avgPosition) : "—"}
            status={hasSearchData ? (m.search.avgPosition <= 10 ? "healthy" : m.search.avgPosition <= 30 ? "warning" : "danger") : undefined}
            tooltip="Average ranking position in search results — lower is better (1 = top result)"
          />
        </div>
      </section>

      {/* ══════════════ SITE HEALTH SCORE ══════════════ */}
      <SiteHealthSection siteHealth={siteHealth} />

      {/* ══════════════ WHY THIS HAPPENED (Root Cause Analysis) ══════════════ */}
      <section data-testid="root-cause-analysis">
        <SectionHeading>Why This Happened</SectionHeading>
        <Card className="border-border/60 bg-card/80">
          <CardContent className="p-6">
            {rootCauses.length === 0 ? (
              <div className="flex items-center gap-3 py-1">
                <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                <p className="text-sm text-emerald-400 font-medium">No anomalies detected — data looks healthy ✓</p>
              </div>
            ) : (
              <ul className="space-y-5">
                {rootCauses.map((cause) => (
                  <li key={cause.rank} className="flex items-start gap-3" data-testid={`cause-${cause.rank}`}>
                    <span className="text-xs font-bold text-muted-foreground bg-muted/30 rounded-full w-5 h-5 flex items-center justify-center shrink-0 mt-0.5">
                      {cause.rank}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="text-sm font-semibold text-foreground/90">{cause.name}</span>
                        <Badge className={`${confidenceBadgeClass(cause.confidence)} border text-[10px] font-bold shrink-0`}>
                          {cause.confidence}% confident
                        </Badge>
                      </div>
                      <div className="w-full h-1 rounded-full bg-muted/30 overflow-hidden mb-1.5">
                        <div
                          className={`h-full rounded-full ${confidenceBarColor(cause.confidence)} transition-all`}
                          style={{ width: `${cause.confidence}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{cause.evidence}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ══════════════ TRAFFIC BREAKDOWN (Brand vs Non-Brand) ══════════════ */}
      <section data-testid="brand-split">
        <div className="flex items-center gap-2 mb-4">
          <Layers className="h-3.5 w-3.5 text-muted-foreground" />
          <SectionHeading inline>Traffic Breakdown</SectionHeading>
        </div>
        {!hasSearchData || m.search.clicks === 0 || allKeywords.length === 0 ? (
          <EmptyCard message="Brand split unavailable — keyword-level click data required." />
        ) : (
          <Card className="border-border/60 bg-card/80">
            <CardContent className="p-6 space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-xl bg-muted/10 border border-border/30 p-4 text-center" data-testid="brand-stat">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Brand</p>
                  <p className="text-3xl font-bold text-purple-400 font-mono">{brandSplit.brandPct}%</p>
                  <p className="text-xs text-muted-foreground mt-1">{brandSplit.brandClicks.toLocaleString()} clicks</p>
                </div>
                <div className="rounded-xl bg-muted/10 border border-border/30 p-4 text-center" data-testid="nonbrand-stat">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Non-Brand</p>
                  <p className="text-3xl font-bold text-teal-400 font-mono">{brandSplit.nonBrandPct}%</p>
                  <p className="text-xs text-muted-foreground mt-1">{brandSplit.nonBrandClicks.toLocaleString()} clicks</p>
                </div>
              </div>

              <div>
                <div className="flex h-4 rounded-full overflow-hidden" data-testid="brand-bar">
                  {brandSplit.brandPct > 0 && (
                    <div className="h-full bg-purple-500 transition-all" style={{ width: `${brandSplit.brandPct}%` }} title={`Brand: ${brandSplit.brandPct}%`} />
                  )}
                  {brandSplit.nonBrandPct > 0 && (
                    <div className="h-full bg-teal-500 transition-all" style={{ width: `${brandSplit.nonBrandPct}%` }} title={`Non-Brand: ${brandSplit.nonBrandPct}%`} />
                  )}
                </div>
                <div className="flex gap-4 mt-2">
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm bg-purple-500" /> Brand
                  </span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm bg-teal-500" /> Non-Brand
                  </span>
                </div>
              </div>

              <p className={`text-sm font-medium ${brandSplit.nonBrandPct < 30 ? "text-amber-400" : brandSplit.nonBrandPct > 60 ? "text-emerald-400" : "text-cyan-400"}`} data-testid="brand-trend-text">
                {brandSplit.nonBrandPct < 30
                  ? "⚠️ Heavy brand dependency — acquisition is weak"
                  : brandSplit.nonBrandPct <= 60
                  ? "Balanced traffic mix"
                  : "✓ Strong non-brand acquisition"}
              </p>
            </CardContent>
          </Card>
        )}
      </section>

      {/* ══════════════ CTR OPPORTUNITIES ══════════════ */}
      <section data-testid="ctr-opportunities">
        <div className="flex items-center gap-2 mb-4">
          <Zap className="h-3.5 w-3.5 text-muted-foreground" />
          <SectionHeading inline>CTR Opportunities</SectionHeading>
        </div>
        {ctrOpportunities.length === 0 ? (
          <EmptyCard message={
            report.topPagesSource !== "gsc"
              ? "CTR opportunity analysis requires GSC page data for the selected period."
              : "No high-impression, low-CTR pages found — site CTR is performing well."
          } />
        ) : (
          <Card className="border-border/60 bg-card/80">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="ctr-opportunities-table">
                  <thead>
                    <tr className="border-b border-border/40">
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium text-xs">Page</th>
                      <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">Impressions</th>
                      <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">Current CTR</th>
                      <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">Potential Clicks</th>
                      <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">Gap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ctrOpportunities.map((op, i) => (
                      <tr key={i} className="border-b border-border/20 last:border-0 hover:bg-muted/10 transition-colors" data-testid={`row-ctr-opp-${i}`}>
                        <td className="py-2.5 px-4">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs font-medium text-foreground/90 truncate max-w-[200px]" title={op.page}>
                              {shortenPageUrl(op.page)}
                            </span>
                            {op.isQuickWin && (
                              <Badge className="bg-amber-500/15 text-amber-400 border border-amber-400/30 text-[9px] font-bold shrink-0">
                                Quick Win
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="text-right py-2.5 px-4 font-mono text-xs text-foreground/80">{op.impressions.toLocaleString()}</td>
                        <td className="text-right py-2.5 px-4">
                          <span className={`text-xs font-semibold font-mono px-1.5 py-0.5 rounded border ${ctrCellClass(op.currentCtr)}`}>
                            {op.currentCtr.toFixed(2)}%
                          </span>
                        </td>
                        <td className="text-right py-2.5 px-4 font-mono text-xs text-emerald-400">+{op.potentialClicks.toLocaleString()}</td>
                        <td className="text-right py-2.5 px-4 font-mono text-xs text-foreground/80">+{op.clickGap.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center gap-2 m-4 bg-emerald-500/10 border border-emerald-400/20 rounded-lg px-3 py-2.5">
                <Zap className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                <p className="text-xs text-emerald-300/90 font-medium">
                  Total opportunity: +{totalCtrGain.toLocaleString()} clicks if top {ctrOpportunities.length} page{ctrOpportunities.length > 1 ? "s" : ""} reach 5% CTR
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      {/* ══════════════ COMPETITIVE SHARE OF VOICE ══════════════ */}
      <section data-testid="share-of-voice">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
          <SectionHeading inline>Competitive Share of Voice</SectionHeading>
        </div>
        {!hasSearchData ? (
          <EmptyCard message="Share of voice analysis requires Google Search Console data." />
        ) : (
          <Card className="border-border/60 bg-card/80">
            <CardContent className="p-6 space-y-5">
              {/* Data source indicator */}
              <div className="flex items-center gap-1.5">
                {competitiveSov?.semrushAvailable ? (
                  <span className="text-xs font-medium text-emerald-400">● Live SEMrush data</span>
                ) : (
                  <span className="text-xs font-medium text-amber-400">● Estimated data</span>
                )}
              </div>
              <div className="h-[130px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={sovChartData}
                    layout="vertical"
                    margin={{ top: 0, right: 36, bottom: 0, left: 80 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                    <XAxis
                      type="number"
                      domain={[0, 100]}
                      tickFormatter={(v) => `${v}%`}

                      tick={{ fontSize: 10, fill: "rgb(148,163,184)" }}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={{ fontSize: 11, fill: "rgb(148,163,184)" }}
                      width={75}
                    />
                    <RechartsTooltip
                      formatter={(value: any) => [`${Number(value).toFixed(1)}%`, "SOV"]}
                      contentStyle={{ background: "rgba(15,23,42,0.95)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", fontSize: "12px" }}
                    />
                    <Bar dataKey="sov" radius={[0, 4, 4, 0]}>
                      <Cell fill="#a855f7" />
                      <Cell fill="#6b7280" />
                      <Cell fill="#6b7280" />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {/* Real competitor traffic details */}
              {competitiveSov?.semrushAvailable && (
                <div className="space-y-1">
                  {competitiveSov.competitors.filter((c) => c.isReal && c.organicTraffic).map((c) => (
                    <p key={c.domain} className="text-xs text-muted-foreground">
                      {c.domain.replace(/^www\./, "")}: {c.organicTraffic!.toLocaleString()} monthly organic visits
                    </p>
                  ))}
                </div>
              )}
              <div className="space-y-1.5">
                {(() => {
                  const currentSOV = competitiveSov?.currentDomainSOV ?? sovPct;
                  const topComp = competitiveSov?.competitors[0];
                  const topSOV = topComp?.sov ?? 72;
                  const topLabel = topComp ? (topComp.isReal ? topComp.domain.replace(/^www\./, "") : (topComp.label ?? "Clutch")) : "Clutch";
                  const gap = topSOV - currentSOV;
                  if (gap > 0) {
                    return (
                      <p className="text-sm text-amber-400 font-medium">
                        ⚠️ TrueFirms is {gap.toFixed(1)}pp below {topLabel}
                        {!topComp?.isReal ? " (estimated)" : ""}
                        {competitiveSov
                          ? ` — +${Math.round(gap / 100 * m.search.impressions * 0.05).toLocaleString()} more clicks/month needed`
                          : sovGapClicks > 0 ? ` — +${sovGapClicks.toLocaleString()} more clicks needed` : ""}.
                      </p>
                    );
                  }
                  return (
                    <p className="text-sm text-emerald-400 font-medium">
                      ✓ Share of Voice ({currentSOV.toFixed(1)}%) meets or exceeds the {topLabel} benchmark.
                    </p>
                  );
                })()}
                {!competitiveSov?.semrushAvailable && (
                  <p className="text-xs text-muted-foreground/60">
                    {competitiveSov
                      ? "Configure SEMrush API in Settings to see real competitor organic traffic data."
                      : "Industry estimate — not live data. Competitor values (Clutch 72%, GoodFirms 65%) are benchmark approximations."}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      {/* ══════════════ FORECAST & GROWTH PROJECTION ══════════════ */}
      <section data-testid="forecast">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
          <SectionHeading inline>Forecast & Growth Projection</SectionHeading>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className="border-red-500/30 bg-card/80">
            <CardContent className="p-6 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingDown className="h-4 w-4 text-red-400" />
                  <span className="text-sm font-semibold text-foreground/90">No Action</span>
                </div>
                <Badge className="bg-red-500/15 text-red-400 border border-red-400/30 text-[10px]">{forecast.noAction.changePercent}%</Badge>
              </div>
              <div>
                <p className="text-2xl font-bold text-red-400 font-mono" data-testid="forecast-no-action">{fmtNum(forecast.noAction.users)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">projected users (next period)</p>
              </div>
              <p className="text-xs text-muted-foreground/80">{forecast.noAction.insight}</p>
            </CardContent>
          </Card>
          <Card className="border-emerald-500/30 bg-card/80">
            <CardContent className="p-6 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-emerald-400" />
                  <span className="text-sm font-semibold text-foreground/90">Top 5 Actions</span>
                </div>
                <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-400/30 text-[10px]">+{forecast.withAction.changePercent}%</Badge>
              </div>
              <div>
                <p className="text-2xl font-bold text-emerald-400 font-mono" data-testid="forecast-with-actions">{fmtNum(forecast.withAction.users)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">projected users (next period)</p>
              </div>
              <p className="text-xs text-muted-foreground/80">{forecast.withAction.insight}</p>
            </CardContent>
          </Card>
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-3">
          <Badge className={`text-[10px] ${
            forecast.confidence >= 70
              ? "bg-green-500/15 text-green-400 border border-green-400/30"
              : forecast.confidence >= 50
              ? "bg-cyan-500/15 text-cyan-400 border border-cyan-400/30"
              : "bg-orange-500/15 text-orange-400 border border-orange-400/30"
          }`}>{forecast.confidence}% confidence</Badge>
          <p className="text-xs text-muted-foreground/60">
            {forecast.methodology.dataSource === "trend-based"
              ? `Based on actual ${Math.abs(Math.round((forecast.methodology.rawDeclineRate ?? 0) * 100))}% period-over-period trend, dampened for next-period projection.`
              : "Limited historical data — using conservative default assumptions."}
          </p>
        </div>
      </section>

      {/* ══════════════ 2. EXECUTIVE SUMMARY ══════════════ */}
      <section>
        <SectionHeading>2. Executive Summary</SectionHeading>
        <Card className="border-border/60 bg-card/80">
          <CardContent className="p-6 space-y-5">
            {report.summary && (
              <p className="text-sm leading-relaxed text-foreground/90" data-testid="text-executive-summary">{report.summary}</p>
            )}

            {positives.length > 0 && (
              <BulletBlock title="✅ Wins / Positive Signals" color="emerald" items={positives.map(i => i.message)} testId="exec-wins" />
            )}
            {risks.length > 0 && (
              <BulletBlock title="⚠️ Risks / Problems" color="amber" items={risks.map(i => i.message)} testId="exec-risks" />
            )}
            {recommendations.length > 0 && (
              <BulletBlock title="💡 Recommendations / Next Steps" color="cyan" items={recommendations} testId="exec-recommendations" />
            )}

            {positives.length === 0 && risks.length === 0 && recommendations.length === 0 && !report.summary && (
              <p className="text-sm text-muted-foreground italic">Executive summary unavailable for this period.</p>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ══════════════ 3. KEY INSIGHTS ══════════════ */}
      {/* Risks are surfaced in the Executive Summary (§2) — do not duplicate here. */}
      <section>
        <SectionHeading>3. Key Insights</SectionHeading>
        <Card className="border-border/60 bg-card/80">
          <CardContent className="p-6 space-y-6">
            <InsightGroup
              title="✅ Opportunities"
              icon={<CheckCircle2 className="h-4 w-4 text-emerald-400" />}
              items={positives}
              color="green"
              emptyText="No growth opportunities identified yet — continue tracking performance."
            />
            <InsightGroup
              title="👁️ Observations"
              icon={<Info className="h-4 w-4 text-slate-400" />}
              items={neutrals}
              color="slate"
              emptyText="No additional observations for this period."
            />
          </CardContent>
        </Card>
      </section>

      {/* ══════════════ 4. TRAFFIC TREND ══════════════ */}
      {/* Order per user spec: Summary (GA4 traffic page) → Bar chart → Top Pages */}
      <section>
        <SectionHeading>4. Traffic Trend</SectionHeading>
        <div className="space-y-6">
          {/* ── 4a. Traffic Summary (from /api/metrics/ga4/traffic) ── */}
          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Traffic Summary (GA4)</p>
            {trafficSummaryLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[74px] rounded-xl" />)}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3" data-testid="traffic-summary-grid">
                <KpiCard
                  title="Users"
                  value={trafficSummary ? fmtNum(trafficSummary.users) : "—"}
                  icon={Users}
                  subtitle="GA4"
                  testId="traffic-summary-users"
                />
                <KpiCard
                  title="Sessions"
                  value={trafficSummary ? fmtNum(trafficSummary.sessions) : "—"}
                  icon={MousePointerClick}
                  subtitle="GA4"
                  testId="traffic-summary-sessions"
                />
                <KpiCard
                  title="Engaged Sessions"
                  value={trafficSummary ? fmtNum(trafficSummary.engagedSessions) : "—"}
                  icon={Activity}
                  subtitle="GA4"
                  testId="traffic-summary-engaged-sessions"
                />
                <KpiCard
                  title="Engagement Rate"
                  value={trafficSummary ? fmtPercent(trafficSummary.engagementRate) : "—"}
                  icon={TrendingUp}
                  subtitle="GA4"
                  testId="traffic-summary-engagement-rate"
                />
                <KpiCard
                  title="Avg Engagement Time"
                  value={trafficSummary?.avgEngagementTimeFormatted ?? "—"}
                  icon={Clock}
                  subtitle="GA4"
                  testId="traffic-summary-avg-engagement-time"
                />
              </div>
            )}
          </div>

          {/* ── 4b. Bar chart (daily users / sessions) ── */}
          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Daily Trend</p>
            {hasTrafficChart ? (
              <Card className="border-border/60 bg-card/80">
                <CardContent className="p-4">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={report.dailyTrends.ga4Daily.map(d => ({ ...d, date: d.date.slice(5) }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <RechartsTooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))", fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="users" fill="#2563eb" name="Users" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="sessions" fill="#7c3aed" name="Sessions" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            ) : hasSearchChart ? (
              <Card className="border-border/60 bg-card/80">
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground mb-3">GA4 daily trend unavailable. Showing GSC daily performance instead.</p>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={report.dailyTrends.gscDaily.map(d => ({ ...d, date: d.date.slice(5) }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <RechartsTooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))", fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="clicks" fill="#059669" name="Clicks" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="impressions" fill="#d97706" name="Impressions" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            ) : (
              <EmptyCard message="Not enough daily data to display trend." />
            )}
          </div>

          {/* ── 4c. Top Pages (primary — GSC first, GA4 fallback) ── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Top Pages</p>
              <Badge variant="outline" className="text-[10px] font-normal">{report.topPagesSource === "gsc" ? "Search Console" : "GA4"}</Badge>
            </div>
            {report.topPages.length === 0 ? (
              <EmptyCard message="No top pages data for the selected range." />
            ) : (
              <Card className="border-border/60 bg-card/80">
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" data-testid="report-top-pages-table">
                      <thead>
                        <tr className="border-b border-border/40">
                          <th className="text-left py-3 px-4 text-muted-foreground font-medium text-xs">Page</th>
                          {report.topPagesSource === "gsc" ? (
                            <>
                              <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">Clicks</th>
                              <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">Impressions</th>
                              <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">CTR</th>
                              <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">Position</th>
                            </>
                          ) : (
                            <>
                              <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">Sessions</th>
                              <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">Users</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {report.topPages.slice(0, 10).map((p: any, i: number) => (
                          <tr key={i} className="border-b border-border/20 last:border-0 hover:bg-muted/10 transition-colors" data-testid={`row-top-page-${i}`}>
                            <td className="py-2.5 px-4 font-medium truncate max-w-[300px] text-foreground/90">{p.page}</td>
                            {report.topPagesSource === "gsc" ? (
                              <>
                                <td className="text-right py-2.5 px-4 font-mono text-foreground/80">{fmtNum(p.clicks)}</td>
                                <td className="text-right py-2.5 px-4 font-mono text-foreground/80">{fmtNum(p.impressions)}</td>
                                <td className="text-right py-2.5 px-4 font-mono text-foreground/80">{fmtPercent(p.ctr)}</td>
                                <td className="text-right py-2.5 px-4 font-mono text-foreground/80">{fmtPosition(p.position)}</td>
                              </>
                            ) : (
                              <>
                                <td className="text-right py-2.5 px-4 font-mono text-foreground/80">{fmtNum(p.sessions)}</td>
                                <td className="text-right py-2.5 px-4 font-mono text-foreground/80">{fmtNum(p.users)}</td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* ── 4d. GA4 Top Pages (Extended) ── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Top Pages (GA4 — Page Views)</p>
              <Badge variant="outline" className="text-[10px] font-normal">GA4</Badge>
            </div>
            {ga4TopPagesLoading ? (
              <Skeleton className="h-40 rounded-xl" />
            ) : ga4TopPages.length === 0 ? (
              <EmptyCard message="No GA4 top pages data for the selected range." />
            ) : (
              <Card className="border-border/60 bg-card/80">
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" data-testid="report-ga4-top-pages-table">
                      <thead>
                        <tr className="border-b border-border/40">
                          <th className="text-left py-3 px-4 text-muted-foreground font-medium text-xs">Page</th>
                          <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">Page Views</th>
                          <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">Users</th>
                          <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">Sessions</th>
                          <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">Engagement Rate</th>
                          <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">Avg Engagement Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ga4TopPages.map((p, i) => (
                          <tr key={i} className="border-b border-border/20 last:border-0 hover:bg-muted/10 transition-colors" data-testid={`row-ga4-top-page-${i}`}>
                            <td className="py-2.5 px-4 font-medium truncate max-w-[260px] text-foreground/90" title={p.page}>{p.page}</td>
                            <td className="text-right py-2.5 px-4 font-mono text-foreground/80">{fmtNum(p.screenPageViews)}</td>
                            <td className="text-right py-2.5 px-4 font-mono text-foreground/80">{fmtNum(p.totalUsers)}</td>
                            <td className="text-right py-2.5 px-4 font-mono text-foreground/80">{fmtNum(p.sessions)}</td>
                            <td className="text-right py-2.5 px-4 font-mono text-foreground/80">{fmtPercent(p.engagementRate)}</td>
                            <td className="text-right py-2.5 px-4 font-mono text-foreground/80">{p.avgEngagementTimeFormatted}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </section>

      {/* ══════════════ 5. KEYWORD PERFORMANCE (Top 10) ══════════════ */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <SectionHeading inline>5. Keyword Performance (Top 10)</SectionHeading>
          <Badge variant="outline" className="text-[10px] font-normal">{hasKeywords ? "GSC" : "—"}</Badge>
        </div>
        {keywordsLoading ? (
          <Skeleton className="h-32 rounded-xl" />
        ) : !hasKeywords ? (
          <EmptyCard message="Keyword data unavailable. Connect SEMrush or DataForSEO for ranking data." />
        ) : (
          <Card className="border-border/60 bg-card/80">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="report-keywords-table">
                  <thead>
                    <tr className="border-b border-border/40">
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium text-xs">Keyword</th>
                      <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">Clicks</th>
                      <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">Impressions</th>
                      <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">CTR</th>
                      <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">Position</th>
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium text-xs">Impact Analysis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topKeywords.map((k, i) => (
                      <tr key={i} className="border-b border-border/20 last:border-0 hover:bg-muted/10 transition-colors" data-testid={`row-keyword-${i}`}>
                        <td className="py-2.5 px-4 font-medium truncate max-w-[220px] text-foreground/90" title={k.query}>{k.query}</td>
                        <td className="text-right py-2.5 px-4 font-mono text-foreground/80">{fmtNum(k.clicks)}</td>
                        <td className="text-right py-2.5 px-4 font-mono text-foreground/80">{fmtNum(k.impressions)}</td>
                        <td className="text-right py-2.5 px-4 font-mono text-foreground/80">{fmtPercent(k.ctr)}</td>
                        <td className="text-right py-2.5 px-4 font-mono text-foreground/80">{fmtPosition(k.position)}</td>
                        <td className="py-2.5 px-4 text-xs text-muted-foreground max-w-[320px]">{keywordImpact(k)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      {/* ══════════════ 7. BACKLINKS ══════════════ */}
      <section>
        <SectionHeading>6. Backlinks</SectionHeading>
        {!hasBacklinksData ? (
          <EmptyCard
            icon={<Link2 className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />}
            message="Backlink data unavailable. Configure SEMrush or DataForSEO API to populate this section."
          />
        ) : (
          <Card className="border-border/60 bg-card/80">
            <CardContent className="p-6">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <StatBlock label="Total Backlinks" value={fmtNum(m.backlinks.current)} />
                <StatBlock label="Δ vs Previous" value={deltaDisplay(m.backlinks.delta)} accent={deltaColor(m.backlinks.delta)} />
                <StatBlock label="Referring Domains" value={fmtNum(m.backlinks.referringDomains)} />
                <StatBlock label="Δ Ref. Domains" value={deltaDisplay(m.backlinks.referringDomainsDelta)} accent={deltaColor(m.backlinks.referringDomainsDelta)} />
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      {/* ══════════════ 8. WHAT CHANGED ══════════════ */}
      <section>
        <SectionHeading>7. What Changed</SectionHeading>
        <Card className="border-border/60 bg-card/80">
          <CardContent className="p-6 space-y-3">
            <DeltaRow
              label="Traffic Growth (Users)"
              value={m.traffic.growthRate}
              display={m.traffic.growthRate > 0 ? `+${m.traffic.growthRate}%` : m.traffic.growthRate < 0 ? `${m.traffic.growthRate}%` : "No change"}
            />
            <DeltaRow
              label="Keyword Net Growth"
              value={m.keywords.netGrowth}
              display={m.keywords.netGrowth > 0 ? `+${m.keywords.netGrowth} keywords` : m.keywords.netGrowth < 0 ? `${m.keywords.netGrowth} keywords` : "Stable"}
            />
            {hasSearchData && (
              <DeltaRow
                label="CTR vs Benchmark"
                value={m.search.ctrGap <= 0 ? 1 : -1}
                display={m.search.ctrGap <= 0 ? `+${Math.abs(m.search.ctrGap)}% above target` : `-${m.search.ctrGap}% below target`}
              />
            )}
          </CardContent>
        </Card>
      </section>

      {/* ══════════════ 9. AI VISIBILITY ══════════════ */}
      {report.aiReferrers && report.aiReferrers.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <SectionHeading inline>8. AI Visibility</SectionHeading>
            <Badge variant="outline" className="text-[10px] font-normal gap-1">
              <Bot className="h-3 w-3" />
              {report.aiReferrers.length} source{report.aiReferrers.length > 1 ? "s" : ""}
            </Badge>
          </div>
          <Card className="border-border/60 bg-card/80">
            <CardContent className="p-0">
              <div className="grid grid-cols-2 gap-4 p-4 border-b border-border/30">
                <div>
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Total AI Users</p>
                  <p className="text-xl font-semibold mt-0.5" data-testid="ai-total-users">{fmtNum(totalAiUsers)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Total AI Sessions</p>
                  <p className="text-xl font-semibold mt-0.5" data-testid="ai-total-sessions">{fmtNum(totalAiSessions)}</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="report-ai-referrers-table">
                  <thead>
                    <tr className="border-b border-border/40">
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium text-xs">AI Source</th>
                      <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">Users</th>
                      <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">Sessions</th>
                      <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">% of Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.aiReferrers.map((ref, i) => (
                      <tr key={i} className="border-b border-border/20 last:border-0 hover:bg-muted/10 transition-colors" data-testid={`row-ai-referrer-${i}`}>
                        <td className="py-2.5 px-4 font-medium text-foreground/90">{ref.source}</td>
                        <td className="text-right py-2.5 px-4 font-mono text-foreground/80">{fmtNum(ref.totalUsers)}</td>
                        <td className="text-right py-2.5 px-4 font-mono text-foreground/80">{fmtNum(ref.sessions)}</td>
                        <td className="text-right py-2.5 px-4 font-mono text-foreground/80">{ref.percentOfTotal != null ? fmtPercent(ref.percentOfTotal) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* ══════════════ 10. DATA AVAILABILITY STATUS ══════════════ */}
      <section>
        <SectionHeading>9. Data Availability Status</SectionHeading>
        <Card className="border-border/60 bg-card/80">
          <CardContent className="p-6">
            <ul className="space-y-2" data-testid="data-availability-list">
              {availability.map((a, i) => (
                <li key={i} className="flex items-start gap-3 text-sm">
                  {a.connected ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1">
                    <span className="text-foreground/90">{a.source}</span>
                    {a.reason && <span className="block text-xs text-muted-foreground mt-0.5">{a.reason}</span>}
                  </div>
                  <Badge variant="outline" className={`text-[10px] ${a.connected ? "text-emerald-400 border-emerald-400/30" : "text-amber-400 border-amber-400/30"}`}>
                    {a.connected ? "Connected" : "Unavailable"}
                  </Badge>
                </li>
              ))}
            </ul>

            {report.missingData && report.missingData.length > 0 && (
              <div className="mt-4 pt-4 border-t border-border/30">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Additional Notes</p>
                <ul className="text-xs text-muted-foreground space-y-0.5">
                  {report.missingData.map((note, i) => <li key={i}>• {note}</li>)}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeading({ children, inline }: { children: React.ReactNode; inline?: boolean }) {
  return (
    <h2 className={`text-xs font-semibold text-muted-foreground uppercase tracking-widest ${inline ? "" : "mb-4"}`}>
      {children}
    </h2>
  );
}

function KpiCard({
  title, value, icon: Icon, testId, subtitle, status, tooltip, delta,
}: {
  title: string; value: string; icon: any; testId: string;
  subtitle?: string; status?: "healthy" | "warning" | "danger";
  tooltip?: string; delta?: number;
}) {
  const isEmpty = value === "—";
  const statusBorder: Record<string, string> = {
    healthy: "border-l-[3px] border-l-emerald-400",
    warning: "border-l-[3px] border-l-amber-400",
    danger: "border-l-[3px] border-l-red-400",
  };
  const borderClass = status ? statusBorder[status] : "";
  return (
    <Card className={`border-border/60 bg-card/80 ${borderClass}`} data-testid={testId}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
              {tooltip && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <CircleHelp className="h-3 w-3 text-muted-foreground/50 cursor-help shrink-0" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[200px] text-xs">{tooltip}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-1.5">
              <p className={`text-2xl font-semibold tracking-tight ${isEmpty ? "text-muted-foreground" : "text-foreground"}`}>{value}</p>
              {delta !== undefined && !isEmpty && (
                delta > 0 ? <ArrowUp className="h-4 w-4 text-emerald-400 shrink-0" />
                : delta < 0 ? <ArrowDown className="h-4 w-4 text-red-400 shrink-0" />
                : <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
            </div>
            {subtitle && <p className="text-[10px] text-muted-foreground mt-0.5">Source: {subtitle}</p>}
          </div>
          <div className="p-2 rounded-lg bg-muted/30 ml-2 shrink-0">
            <Icon className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function BulletBlock({ title, color, items, testId }: { title: string; color: "emerald" | "amber" | "cyan"; items: string[]; testId: string }) {
  const border: Record<string, string> = {
    emerald: "border-l-emerald-400/60",
    amber: "border-l-amber-400/60",
    cyan: "border-l-cyan-400/60",
  };
  return (
    <div data-testid={testId}>
      <h4 className="text-sm font-semibold text-foreground/80 mb-2">{title}</h4>
      <ul className="space-y-1.5">
        {items.map((msg, i) => (
          <li key={i} className={`pl-3 py-1 border-l-2 ${border[color]} text-sm text-foreground/80 leading-relaxed`}>
            {msg}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DeltaRow({ label, value, display }: { label: string; value: number; display: string }) {
  const color = value > 0 ? "text-emerald-400" : value < 0 ? "text-red-400" : "text-muted-foreground";
  const icon = value > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : value < 0 ? <TrendingDown className="h-3.5 w-3.5" /> : null;
  return (
    <div className="flex items-center justify-between py-2.5 px-4 rounded-lg bg-muted/10 border border-border/30" data-testid={`delta-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <span className="text-sm text-foreground/80">{label}</span>
      <span className={`text-sm font-semibold font-mono flex items-center gap-1.5 ${color}`}>
        {icon}
        {display}
      </span>
    </div>
  );
}

function InsightGroup({
  title, icon, items, color, emptyText,
}: {
  title: string;
  icon: any;
  items: Insight[];
  color: string;
  emptyText: string;
}) {
  const borderColor: Record<string, string> = {
    red: "border-l-red-400/60",
    green: "border-l-emerald-400/60",
    slate: "border-l-slate-400/40",
  };

  return (
    <div data-testid={`insight-group-${title.toLowerCase().replace(/[^a-z]/g, "-")}`}>
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h4 className="text-sm font-semibold text-foreground/80">{title}</h4>
        <span className="text-xs text-muted-foreground">({items.length})</span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground italic pl-6">{emptyText}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((ins, i) => (
            <li key={i} className={`pl-4 py-2 border-l-2 ${borderColor[color] || "border-l-border"} rounded-r`}>
              <p className="text-sm text-foreground/80 leading-relaxed">{ins.message}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyCard({ message, icon }: { message: string; icon?: React.ReactNode }) {
  return (
    <Card className="border-border/60 bg-card/80">
      <CardContent className="py-10 text-center">
        {icon || <Database className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />}
        <p className="text-sm text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}

function StatBlock({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className={`text-xl font-semibold mt-0.5 ${accent || "text-foreground"}`}>{value}</p>
    </div>
  );
}

function deltaDisplay(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  if (v === 0) return "No change";
  return v > 0 ? `+${v.toLocaleString()}` : v.toLocaleString();
}

function deltaColor(v: number | null | undefined): string {
  if (!v) return "text-muted-foreground";
  return v > 0 ? "text-emerald-400" : "text-red-400";
}

function DataHealthBanner({
  score, issues, warnings, confidence, deductions,
}: {
  score: number;
  issues: string[];
  warnings: string[];
  confidence: number;
  deductions: Array<{ reason: string; value: number }>;
}) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const tier = score >= 75 ? "emerald" : score >= 50 ? "amber" : "red";
  const label = score >= 75 ? "Good" : score >= 50 ? "At Risk" : score >= 25 ? "Poor" : "Critical";
  const styles = {
    emerald: { badge: "bg-emerald-500/15 text-emerald-400 border border-emerald-400/30", bar: "bg-emerald-400", icon: "text-emerald-400" },
    amber:   { badge: "bg-amber-500/15 text-amber-400 border border-amber-400/30",   bar: "bg-amber-400",   icon: "text-amber-400"   },
    red:     { badge: "bg-red-500/15 text-red-400 border border-red-400/30",           bar: "bg-red-400",     icon: "text-red-400"     },
  }[tier];
  return (
    <Card className="border-border/60 bg-card/80" data-testid="data-health-banner">
      <CardContent className="p-5 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className={`h-4 w-4 ${styles.icon}`} />
            <span className="text-sm font-semibold text-foreground/90">Data Health Score</span>
          </div>
          <Badge className={`${styles.badge} text-xs font-semibold`}>{label} — {score}/100</Badge>
        </div>
        {/* Progress bar */}
        <div className="w-full h-1.5 rounded-full bg-muted/30 overflow-hidden">
          <div className={`h-full rounded-full ${styles.bar} transition-all`} style={{ width: `${score}%` }} />
        </div>
        {/* Confidence */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="text-[11px] text-muted-foreground cursor-default">
                Data confidence: <span className="font-medium text-foreground/70">{confidence}%</span>
              </p>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[220px] text-xs">
              How reliable this score is based on available data sources. Confidence rises as more integrations are connected.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {/* Issues — red, blocking */}
        {issues.length > 0 && (
          <div className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-red-400 mb-1.5">Blocking Issues</p>
            <ul className="space-y-0.5">
              {issues.map((issue, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-red-300/90">
                  <XCircle className="h-3 w-3 shrink-0 mt-0.5 text-red-400" />
                  {issue}
                </li>
              ))}
            </ul>
          </div>
        )}
        {/* Warnings — yellow, advisory */}
        {warnings.length > 0 && (
          <div className="rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-400 mb-1.5">Advisory</p>
            <ul className="space-y-0.5">
              {warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-amber-300/90">
                  <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5 text-amber-400" />
                  {w}
                </li>
              ))}
            </ul>
          </div>
        )}
        {/* Collapsible deductions */}
        {deductions.length > 0 && (
          <div>
            <button
              onClick={() => setShowBreakdown(v => !v)}
              className="text-[11px] text-muted-foreground hover:text-foreground/70 transition-colors flex items-center gap-1"
            >
              {showBreakdown ? "Hide" : "See"} score breakdown {showBreakdown ? "▲" : "▼"}
            </button>
            {showBreakdown && (
              <ul className="mt-2 space-y-1 border-t border-border/30 pt-2">
                {deductions.map((d, i) => (
                  <li key={i} className="flex items-start justify-between gap-2 text-[11px] text-muted-foreground">
                    <span>− {d.reason}</span>
                    <span className="shrink-0 text-red-400 font-medium">{d.value} pts</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SiteHealthSection({ siteHealth }: { siteHealth: SiteHealthResult }) {
  const { overallScore, status, statusColor, pillars, summaryInsight } = siteHealth;
  const colorMap: Record<SiteHealthResult["statusColor"], { bar: string; badge: string; text: string }> = {
    green:  { bar: "bg-green-500",  badge: "bg-green-500/15 text-green-400 border border-green-400/30",   text: "text-green-400"  },
    yellow: { bar: "bg-yellow-500", badge: "bg-yellow-500/15 text-yellow-400 border border-yellow-400/30", text: "text-yellow-400" },
    orange: { bar: "bg-orange-500", badge: "bg-orange-500/15 text-orange-400 border border-orange-400/30", text: "text-orange-400" },
    red:    { bar: "bg-red-500",    badge: "bg-red-500/15 text-red-400 border border-red-400/30",          text: "text-red-400"    },
  };
  const { bar: barColor, badge: badgeClass, text: textColor } = colorMap[statusColor];

  return (
    <section data-testid="site-health-section">
      <SectionHeading>Site Health Score</SectionHeading>
      <Card className="border-border/60 bg-card/80">
        <CardContent className="p-6">
          <div className="flex items-center gap-6 mb-4">
            <span className={`text-5xl font-black tabular-nums ${textColor}`}>{overallScore}</span>
            <div className="flex-1">
              <Badge className={`${badgeClass} text-xs font-semibold`}>{status}</Badge>
              <p className="text-xs text-muted-foreground mt-1.5">{summaryInsight}</p>
            </div>
          </div>
          <div className="w-full h-2 rounded-full bg-muted/30 overflow-hidden mb-6">
            <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${overallScore}%` }} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {pillars.map((pillar) => (
              <div
                key={pillar.name}
                className={`rounded-lg border p-3 ${pillar.available ? "border-border/50 bg-muted/10" : "border-border/20 bg-muted/5 opacity-60"}`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-foreground/80">{pillar.name}</span>
                  {pillar.available
                    ? <span className={`text-xs font-bold ${pillar.score >= 70 ? "text-emerald-400" : pillar.score >= 40 ? "text-amber-400" : "text-red-400"}`}>{pillar.score}/100</span>
                    : <span className="text-xs text-muted-foreground">—</span>
                  }
                </div>
                {pillar.available && (
                  <div className="w-full h-1 rounded-full bg-muted/30 overflow-hidden mb-1.5">
                    <div
                      className={`h-full rounded-full ${pillar.score >= 70 ? "bg-emerald-400" : pillar.score >= 40 ? "bg-amber-400" : "bg-red-400"} transition-all`}
                      style={{ width: `${pillar.score}%` }}
                    />
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground leading-relaxed">{pillar.insight}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function ExecutiveVerdict({ status, decisions, keyInsight }: { status: VerdictStatus; decisions: string[]; keyInsight: string }) {
  const tier = status === "Critical" ? "red" : status === "At Risk" ? "amber" : "emerald";
  const styles = {
    red: { badge: "bg-red-500/15 text-red-400 border border-red-400/30", border: "border-l-red-400", icon: <XCircle className="h-4 w-4 text-red-400" /> },
    amber: { badge: "bg-amber-500/15 text-amber-400 border border-amber-400/30", border: "border-l-amber-400", icon: <AlertTriangle className="h-4 w-4 text-amber-400" /> },
    emerald: { badge: "bg-emerald-500/15 text-emerald-400 border border-emerald-400/30", border: "border-l-emerald-400", icon: <CheckCircle2 className="h-4 w-4 text-emerald-400" /> },
  }[tier];
  return (
    <Card className="border-border/60 bg-card/80" data-testid="executive-verdict">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {styles.icon}
            <span className="text-sm font-semibold text-foreground/90">Executive Verdict</span>
          </div>
          <Badge className={`${styles.badge} text-xs font-semibold`}>{status}</Badge>
        </div>
        <div className={`pl-3 border-l-2 ${styles.border}`}>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Key Insight</p>
          <p className="text-sm text-foreground/90 leading-relaxed">{keyInsight}</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Top 3 Decisions</p>
          <ol className="space-y-1.5">
            {decisions.map((d, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-foreground/80">
                <span className="text-xs font-bold text-muted-foreground shrink-0 mt-0.5">{i + 1}.</span>
                {d}
              </li>
            ))}
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}
