import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useDomain } from "@/hooks/use-domain";
import { useToast } from "@/hooks/use-toast";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend,
} from "recharts";
import {
  FileDown, RefreshCw, Users, MousePointerClick, Search, Target,
  TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, Info,
  BarChart3, Loader2, Eye, Percent, Bot, Link2, Database,
  XCircle, Activity, Clock,
} from "lucide-react";
import { subDays } from "date-fns";
import type { DateRange } from "react-day-picker";

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

// ── Component ─────────────────────────────────────────────────────────────────

export default function ReportPreviewPage() {
  const { domain, ga4PropertyId, gscSiteUrl } = useDomain();
  const { toast } = useToast();
  const [isDownloading, setIsDownloading] = useState(false);

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

      {/* ══════════════ 1. KPI SNAPSHOT ══════════════ */}
      <section data-testid="kpi-grid">
        <SectionHeading>1. KPI Snapshot</SectionHeading>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {/* GA4 */}
          <KpiCard title="Users" value={hasTrafficData ? fmtNum(m.traffic.users) : "—"} icon={Users} subtitle="GA4" testId="kpi-users" />
          <KpiCard title="Sessions" value={hasTrafficData ? fmtNum(m.traffic.sessions) : "—"} icon={MousePointerClick} subtitle="GA4" testId="kpi-sessions" />
          {/* GSC */}
          <KpiCard title="Clicks" value={hasSearchData ? fmtNum(m.search.clicks) : "—"} icon={Search} subtitle="GSC" testId="kpi-clicks" />
          <KpiCard title="Impressions" value={hasSearchData ? fmtNum(m.search.impressions) : "—"} icon={Eye} subtitle="GSC" testId="kpi-impressions" />
          <KpiCard title="CTR" value={hasSearchData ? fmtPercent(m.search.ctr) : "—"} icon={Percent} subtitle="GSC" testId="kpi-ctr" />
          <KpiCard title="Avg Position" value={hasSearchData ? fmtPosition(m.search.avgPosition) : "—"} icon={Target} subtitle="GSC" testId="kpi-position" />
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
                      <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))", fontSize: 12 }} />
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
                      <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))", fontSize: 12 }} />
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

function KpiCard({ title, value, icon: Icon, testId, subtitle }: { title: string; value: string; icon: any; testId: string; subtitle?: string }) {
  const isEmpty = value === "—";
  return (
    <Card className="border-border/60 bg-card/80" data-testid={testId}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
            <p className={`mt-1.5 text-2xl font-semibold tracking-tight ${isEmpty ? "text-muted-foreground" : "text-foreground"}`}>{value}</p>
            {subtitle && <p className="text-[10px] text-muted-foreground mt-0.5">Source: {subtitle}</p>}
          </div>
          <div className="p-2 rounded-lg bg-muted/30">
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
