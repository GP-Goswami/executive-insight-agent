import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useDomain } from "@/hooks/use-domain";
import { Users, MousePointerClick, Target, TrendingUp, AlertCircle, Clock, Activity } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { subDays, format } from "date-fns";
import { SourceToggle, type DataSource } from "@/components/dashboard/source-toggle";

// ── Interfaces ────────────────────────────────────────────────────────────────

interface OverviewMetrics {
  summary: {
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
    sessions: number;
    users: number;
    source: { clicks: string; traffic: string };
    dataCoverage: string;
  };
  seo: { rankings: any[]; backlinks: any[]; topPages: any[]; source: string; estimated: boolean };
  noData?: boolean;
}

interface GA4TrafficData {
  users: number;
  sessions: number;
  engagedSessions: number;
  engagementRate: number;  // real % from GA4
  avgSessionDuration: string; // "mm:ss" formatted
  source: string;
  error?: string;
}

export default function TrafficPage() {
  const { domain, ga4PropertyId } = useDomain();
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 30),
    to: subDays(new Date(), 1),
  });
  const [appliedRange, setAppliedRange] = useState<DateRange | undefined>(dateRange);
  const [activeSource, setActiveSource] = useState<DataSource>("semrush");

  // ── SEMrush/Overview data ──────────────────────────────────────────────────
  const { data: metricsResponse, isLoading: metricsLoading } = useQuery<
    OverviewMetrics & { message?: string; configured?: boolean; noData?: boolean }
  >({
    queryKey: ["/api/metrics/overview", domain, ga4PropertyId, appliedRange?.from?.toISOString(), appliedRange?.to?.toISOString()],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (domain) params.set("domain", domain);
      if (ga4PropertyId) params.set("propertyId", ga4PropertyId);
      if (appliedRange?.from) params.set("start", format(appliedRange.from, "yyyy-MM-dd"));
      if (appliedRange?.to) params.set("end", format(appliedRange.to, "yyyy-MM-dd"));
      const res = await fetch(`/api/metrics/overview?${params}`, { credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        if (data.configured !== undefined || data.noData) return data;
        throw new Error(data.message || "Failed to fetch metrics");
      }
      return data;
    },
    enabled: !!domain || !!ga4PropertyId,
    retry: false,
  });

  // ── Real GA4 traffic data (engaged sessions, engagement rate, avg duration) ─
  const { data: ga4Traffic, isLoading: ga4Loading, error: ga4Error } = useQuery<GA4TrafficData>({
    queryKey: ["/api/metrics/traffic", ga4PropertyId, appliedRange?.from?.toISOString(), appliedRange?.to?.toISOString()],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (ga4PropertyId) params.set("propertyId", ga4PropertyId);
      if (appliedRange?.from) params.set("start", format(appliedRange.from, "yyyy-MM-dd"));
      if (appliedRange?.to) params.set("end", format(appliedRange.to, "yyyy-MM-dd"));
      const res = await fetch(`/api/metrics/traffic?${params}`, { credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        // Return zero-filled on error so the UI doesn't break
        return { users: 0, sessions: 0, engagedSessions: 0, engagementRate: 0, avgSessionDuration: "0:00", source: "ga4", error: data.error };
      }
      return data;
    },
    enabled: !!ga4PropertyId && activeSource === "ga4",
    retry: false,
  });

  const overviewMetrics = metricsResponse?.summary;
  const noDataFound = metricsResponse?.noData;

  const handleApply = () => setAppliedRange(dateRange);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const fmt = (n: number | undefined) => (n ?? 0).toLocaleString();

  return (
    <div className="space-y-6" data-testid="traffic-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Traffic Overview</h1>
          <p className="text-muted-foreground">Analyze traffic performance and user engagement metrics</p>
        </div>
        <DateRangePicker dateRange={dateRange} onDateRangeChange={setDateRange} onApply={handleApply} />
      </div>

      <SourceToggle activeSource={activeSource} onSourceChange={setActiveSource} />

      {/* ── SEMrush Section ── */}
      {activeSource === "semrush" && (
        <div className="space-y-6">
          {!domain && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Domain Required</AlertTitle>
              <AlertDescription>Please enter a domain in Settings to view SEMrush traffic metrics.</AlertDescription>
            </Alert>
          )}
          {noDataFound && domain && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>No Data Available</AlertTitle>
              <AlertDescription>No SEMrush data found for "{domain}".</AlertDescription>
            </Alert>
          )}
          {overviewMetrics && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <KpiCard
                title="Estimated Traffic"
                value={fmt(overviewMetrics.users)}
                icon={Users}
                accent="purple"
                changeLabel="SEMrush Organic"
              />
              <KpiCard
                title="Organic Traffic"
                value={fmt(overviewMetrics.sessions || overviewMetrics.users)}
                icon={Target}
                accent="green"
                changeLabel="SEMrush / DataForSEO"
              />
              <KpiCard
                title="Search Clicks"
                value={fmt(overviewMetrics.clicks)}
                icon={MousePointerClick}
                accent="cyan"
                changeLabel="Source: GSC"
              />
            </div>
          )}
          {metricsLoading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1,2,3].map(i => <KpiCard key={i} title="Loading…" value="—" icon={Users} accent="purple" />)}
            </div>
          )}
        </div>
      )}

      {/* ── GA4 Section — real data from /api/metrics/traffic ── */}
      {activeSource === "ga4" && (
        <div className="space-y-6">
          {!ga4PropertyId && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>GA4 Property ID Required</AlertTitle>
              <AlertDescription>Please configure your GA4 property ID in Settings to view traffic.</AlertDescription>
            </Alert>
          )}

          {ga4Error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>GA4 Error</AlertTitle>
              <AlertDescription>{(ga4Error as Error).message || "Failed to fetch GA4 traffic data."}</AlertDescription>
            </Alert>
          )}

          {ga4Traffic?.error && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>GA4 Notice</AlertTitle>
              <AlertDescription>{ga4Traffic.error}</AlertDescription>
            </Alert>
          )}

          {ga4PropertyId && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <KpiCard
                title="Users"
                value={ga4Loading ? "—" : fmt(ga4Traffic?.users)}
                icon={Users}
                accent="cyan"
                changeLabel="Source: GA4"
              />
              <KpiCard
                title="Sessions"
                value={ga4Loading ? "—" : fmt(ga4Traffic?.sessions)}
                icon={MousePointerClick}
                accent="purple"
                changeLabel="Source: GA4"
              />
              <KpiCard
                title="Engaged Sessions"
                value={ga4Loading ? "—" : fmt(ga4Traffic?.engagedSessions)}
                icon={Activity}
                accent="green"
                changeLabel="Source: GA4 (real)"
              />
              <KpiCard
                title="Engagement Rate"
                value={ga4Loading ? "—" : `${ga4Traffic?.engagementRate ?? 0}%`}
                icon={TrendingUp}
                accent="amber"
                changeLabel="Source: GA4 (real)"
              />
              <KpiCard
                title="Avg Session Duration"
                value={ga4Loading ? "—" : (ga4Traffic?.avgSessionDuration ?? "0:00")}
                icon={Clock}
                accent="cyan"
                changeLabel="Source: GA4 (real)"
              />
            </div>
          )}
        </div>
      )}

      {/* ── GSC Section ── */}
      {activeSource === "gsc" && (
        <div className="space-y-6">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Google Search Console Note</AlertTitle>
            <AlertDescription>
              GSC does not provide raw user traffic. Showing approximate search clicks as traffic instead.
            </AlertDescription>
          </Alert>
          {overviewMetrics && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <KpiCard
                title="Search Clicks (GSC)"
                value={fmt(overviewMetrics.clicks)}
                icon={MousePointerClick}
                accent="cyan"
                changeLabel="Source: GSC"
              />
              <KpiCard
                title="Impressions (GSC)"
                value={fmt(overviewMetrics.impressions)}
                icon={Users}
                accent="purple"
                changeLabel="Source: GSC"
              />
              <KpiCard
                title="Avg Position (GSC)"
                value={(overviewMetrics.position ?? 0).toFixed(1)}
                icon={TrendingUp}
                accent="amber"
                changeLabel="Source: GSC"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
