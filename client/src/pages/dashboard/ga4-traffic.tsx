import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useDomain } from "@/hooks/use-domain";
import { Users, MousePointerClick, Activity, TrendingUp, Clock, AlertCircle } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { subDays, format } from "date-fns";

interface TrafficMetrics {
  users: number;
  sessions: number;
  engagedSessions: number;
  avgEngagementTimeSeconds: number;
  avgEngagementTimeFormatted: string;
  engagementRate: number;
  source: string;
}

export default function Ga4TrafficPage() {
  const { ga4PropertyId } = useDomain();
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });
  const [appliedRange, setAppliedRange] = useState<DateRange | undefined>(dateRange);

  const { data, isLoading, error } = useQuery<TrafficMetrics>({
    queryKey: [
      "/api/metrics/ga4/traffic",
      ga4PropertyId,
      appliedRange?.from && format(appliedRange.from, "yyyy-MM-dd"),
      appliedRange?.to && format(appliedRange.to, "yyyy-MM-dd"),
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (ga4PropertyId) params.set("propertyId", ga4PropertyId);
      if (appliedRange?.from) params.set("start", format(appliedRange.from, "yyyy-MM-dd"));
      if (appliedRange?.to) params.set("end", format(appliedRange.to, "yyyy-MM-dd"));

      const res = await fetch(`/api/metrics/ga4/traffic?${params}`, { credentials: "include" });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.message || "Failed to fetch traffic metrics");
      }
      return json;
    },
    enabled: !!ga4PropertyId && !!appliedRange?.from && !!appliedRange?.to,
    retry: false,
  });

  const handleApply = () => setAppliedRange(dateRange);
  const fmt = (n: number | undefined) => (n ?? 0).toLocaleString();

  return (
    <div className="space-y-6" data-testid="ga4-traffic-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Traffic</h1>
          <p className="text-muted-foreground">User engagement metrics from Google Analytics 4</p>
        </div>
        <DateRangePicker
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          onApply={handleApply}
        />
      </div>

      {!ga4PropertyId && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>GA4 Property ID Required</AlertTitle>
          <AlertDescription>
            Configure your GA4 Property ID in Settings to view traffic metrics.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{(error as Error).message}</AlertDescription>
        </Alert>
      )}

      {ga4PropertyId && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <KpiCard
            title="Users"
            value={isLoading ? "—" : fmt(data?.users)}
            icon={Users}
            accent="cyan"
            changeLabel="Source: GA4"
          />
          <KpiCard
            title="Sessions"
            value={isLoading ? "—" : fmt(data?.sessions)}
            icon={MousePointerClick}
            accent="purple"
            changeLabel="Source: GA4"
          />
          <KpiCard
            title="Engaged Sessions"
            value={isLoading ? "—" : fmt(data?.engagedSessions)}
            icon={Activity}
            accent="green"
            changeLabel="Source: GA4"
          />
          <KpiCard
            title="Engagement Rate"
            value={isLoading ? "—" : `${data?.engagementRate ?? 0}%`}
            icon={TrendingUp}
            accent="amber"
            changeLabel="Source: GA4"
          />
          <KpiCard
            title="Avg Engagement Time"
            value={isLoading ? "—" : (data?.avgEngagementTimeFormatted ?? "00:00:00")}
            icon={Clock}
            accent="cyan"
            changeLabel="Source: GA4"
          />
        </div>
      )}
    </div>
  );
}
