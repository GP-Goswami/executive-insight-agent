import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { DataTable, Column } from "@/components/dashboard/data-table";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useDomain } from "@/hooks/use-domain";
import {
  Users,
  MousePointerClick,
  Target,
  Link2,
  Bot,
  TrendingUp,
  Database,
  AlertCircle,
  FileText,
} from "lucide-react";
import type { DateRange } from "react-day-picker";
import { subDays } from "date-fns";

interface OverviewMetrics {
  summary: {
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
    sessions: number;
    users: number;
    source: {
      clicks: string;
      traffic: string;
    };
    dataCoverage: string;
  };
  seo: {
    rankings: any[];
    backlinks: any[];
    topPages: any[];
    source: string;
    estimated: boolean;
  };
  meta: {
    validated: boolean;
    mismatchDetected: boolean;
    lastUpdated: string;
    errors: string[];
  };
  noData?: boolean;
}

interface TopPage {
  page: string;
  screenPageViews: number;
  totalUsers: number;
  sessions: number;
  avgEngagementTimeFormatted: string;
  engagementRate: number;
}

interface ApiResponse {
  data?: TopPage[];
  message?: string;
  configured?: boolean;
  source?: string;
}

export default function ExecutiveOverview() {
  const { domain, ga4PropertyId, gscSiteUrl } = useDomain();
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 30),
    to: subDays(new Date(), 1),
  });
  const [appliedRange, setAppliedRange] = useState<DateRange | undefined>(dateRange);

  const { data: metricsResponse, isLoading: metricsLoading, error: metricsError } = useQuery<OverviewMetrics & { message?: string; configured?: boolean; noData?: boolean }>({
    queryKey: ["/api/metrics/overview", domain, ga4PropertyId, appliedRange?.from?.toISOString(), appliedRange?.to?.toISOString()],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (domain) params.set("domain", domain);
      if (ga4PropertyId) params.set("propertyId", ga4PropertyId);
      if (appliedRange?.from) params.set("start", appliedRange.from.toISOString());
      if (appliedRange?.to) params.set("end", appliedRange.to.toISOString());
      const res = await fetch(`/api/metrics/overview?${params}`);
      const data = await res.json();
      if (!res.ok) {
        if (data.configured !== undefined || data.noData) {
          return data;
        }
        throw new Error(data.message || "Failed to fetch metrics");
      }
      return data;
    },
    enabled: !!domain,
    retry: false,
  });

  const metrics = metricsResponse?.summary;
  const seo = metricsResponse?.seo;
  const meta = metricsResponse?.meta;
  const metricsMessage = (metricsResponse as any)?.message;

  const { data: topPagesResponse, isLoading: topPagesLoading, error: topPagesError } = useQuery<ApiResponse>({
    queryKey: ["/api/metrics/ga4/top-pages-extended", ga4PropertyId, appliedRange?.from?.toISOString(), appliedRange?.to?.toISOString()],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (ga4PropertyId) params.set("propertyId", ga4PropertyId);
      if (appliedRange?.from) params.set("start", appliedRange.from.toISOString().slice(0, 10));
      if (appliedRange?.to) params.set("end", appliedRange.to.toISOString().slice(0, 10));
      params.set("limit", "10");
      const res = await fetch(`/api/metrics/ga4/top-pages-extended?${params}`, { credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        if (data.configured === false || data.configured === true) {
          return data;
        }
        throw new Error(data.message || "Failed to fetch top pages");
      }
      return data;
    },
    enabled: !!ga4PropertyId,
    retry: false,
  });

  const topPages = topPagesResponse?.data || [];
  const topPagesNeedsConfig = !ga4PropertyId;
  const topPagesNeedsPropertyId = false;

  const handleApply = () => {
    setAppliedRange(dateRange);
  };

  const topPagesColumns: Column<TopPage>[] = [
    {
      key: "page",
      header: "Page",
      render: (row) => (
        <span className="text-sm font-medium truncate max-w-[260px] block">{row.page}</span>
      ),
    },
    { key: "screenPageViews", header: "Pageviews", align: "right" },
    { key: "totalUsers", header: "Users", align: "right" },
    { key: "avgEngagementTimeFormatted", header: "Avg. Time on Page", align: "right" },
    { key: "sessions", header: "Sessions", align: "right" },
    {
      key: "engagementRate",
      header: "Engagement Rate",
      align: "right",
      render: (row) => <span>{row.engagementRate}%</span>,
    },
  ];

  const hasMetrics = metrics && !metricsError && !metricsResponse?.noData;
  const isLiveData = metrics?.source?.clicks === "GSC";
  const noDataFound = metricsResponse?.noData;

  return (
    <div className="space-y-6" data-testid="executive-overview-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Executive Overview</h1>
          <p className="text-muted-foreground">
            Consolidated performance metrics across all channels
          </p>
          {metrics && (
            <div className="flex flex-wrap gap-2 mt-2">
              <Badge variant="outline" className="bg-cyan-500/10 text-cyan-400 border-cyan-500/20 gap-1">
                <Database className="h-3 w-3" />
                Traffic: {metrics.source.traffic}
              </Badge>
              <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/20 gap-1">
                <Target className="h-3 w-3" />
                Search: {metrics.source.clicks}
              </Badge>
              <Badge variant="outline" className="bg-purple-500/10 text-purple-400 border-purple-500/20 gap-1">
                <Bot className="h-3 w-3" />
                SEO: {seo?.source} (Estimated)
              </Badge>
              {meta?.mismatchDetected && (
                <Badge variant="destructive" className="animate-pulse">
                  Mismatch Detected - Refetching
                </Badge>
              )}
            </div>
          )}
        </div>
        <DateRangePicker
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          onApply={handleApply}
        />
      </div>

      {metricsError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Configuration Required</AlertTitle>
          <AlertDescription>
            {(metricsError as Error).message || "SEMrush API is not configured. Please add SEMRUSH_API_KEY to secrets and enter a domain to view metrics."}
          </AlertDescription>
        </Alert>
      )}

      {!domain && !metricsError && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Domain Required</AlertTitle>
          <AlertDescription>
            Please enter a domain in the Settings page to view executive metrics.
          </AlertDescription>
        </Alert>
      )}

      {noDataFound && domain && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>No Data Available</AlertTitle>
          <AlertDescription>
            {metricsMessage || `No SEMrush data found for "${domain}". This domain may not have enough organic traffic or rankings tracked.`}
          </AlertDescription>
        </Alert>
      )}

      {metrics && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              title="Ground-Truth Clicks"
              value={metrics.clicks}
              icon={Users}
              accent="cyan"
              changeLabel="Source: GSC"
            />
            <KpiCard
              title="GA4 Organic Traffic"
              value={metrics.users}
              icon={Target}
              accent="green"
              changeLabel="Source: GA4"
            />
            <KpiCard
              title="Total Backlinks"
              value={seo?.backlinks && seo.backlinks.length > 0 ? seo.backlinks[0].count || 0 : "-"}
              icon={Link2}
              accent="purple"
              changeLabel="Estimated (DataForSEO)"
              showTrend={false}
            />
            <KpiCard
              title="Top 10 Rankings"
              value={seo?.rankings?.filter((r: any) => r.position <= 10).length || 0}
              icon={TrendingUp}
              accent="amber"
              changeLabel="Estimated (DataForSEO)"
              showTrend={false}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4">
            <KpiCard
              title="Total Impressions"
              value={metrics.impressions}
              icon={MousePointerClick}
              accent="cyan"
              changeLabel="Source: GSC"
            />
            <KpiCard
              title="Avg Search Position"
              value={metrics.position}
              icon={Target}
              accent="green"
              changeLabel="Source: GSC"
              invertColors
            />
          </div>
        </>
      )}

      <Card className="border-white/10 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Top Landing Pages
          </CardTitle>
        </CardHeader>
        <CardContent>
          {topPagesError ? (
            <div className="text-center py-8 text-destructive">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>{(topPagesError as Error).message || "Failed to fetch top pages"}</p>
            </div>
          ) : topPagesNeedsConfig ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>{topPagesResponse?.message || "GA4 is not configured."}</p>
              <p className="text-sm mt-2">Configure GA4 property ID in Settings to view top landing pages.</p>
            </div>
          ) : topPages.length === 0 && !topPagesLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No page data available for this period.</p>
            </div>
          ) : (
            <DataTable
              columns={topPagesColumns}
              data={topPages}
              isLoading={metricsLoading || topPagesLoading}
              testIdPrefix="top-pages"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
