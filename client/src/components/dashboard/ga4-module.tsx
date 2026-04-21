/**
 * GA4Module — fetches GA4 metrics directly from the backend
 * and renders KPI cards + top landing pages table.
 *
 * This component calls the backend service-account endpoints,
 * so no Bearer token is required here.
 */
import { useQuery } from "@tanstack/react-query";
import { KpiCard } from "./kpi-card";
import { DataTable } from "./data-table";
import type { Column } from "./data-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertCircle,
  MousePointerClick,
  Users,
  Target,
  TrendingUp,
  Clock,
  Database,
  FileText,
} from "lucide-react";
import { format } from "date-fns";

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface GA4ModuleProps {
  propertyId: string;
  domain?: string;
  startDate: Date;
  endDate: Date;
}

interface GA4Summary {
  totalUsers: number;
  sessions: number;
  engagedSessions: number;
  averageSessionDuration: number;
  engagementRate: number;
  screenPageViews: number;
}

interface GA4TopPage {
  page: string;
  users: number;
  sessions: number;
  conversions: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GA4Module({ propertyId, domain, startDate, endDate }: GA4ModuleProps) {
  const startStr = format(startDate, "yyyy-MM-dd");
  const endStr = format(endDate, "yyyy-MM-dd");

  // ── Summary metrics ────────────────────────────────────────────────────────
  const {
    data: summaryData,
    isLoading: summaryLoading,
    error: summaryError,
  } = useQuery<GA4Summary>({
    queryKey: ["ga4-summary", propertyId, startStr, endStr],
    queryFn: async () => {
      const params = new URLSearchParams({
        propertyId,
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      });
      if (domain) params.set("domain", domain);

      console.log("[GA4Module] Fetching summary:", { propertyId, startStr, endStr });

      const res = await fetch(`/api/metrics/overview?${params}`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `GA4 summary failed (${res.status})`);
      }
      const json = await res.json();
      console.log("[GA4Module] Summary response:", json);

      // Extract from nested summary field
      const s = json.summary ?? json;
      return {
        totalUsers: s.users ?? s.totalUsers ?? 0,
        sessions: s.sessions ?? 0,
        engagedSessions: s.engagedSessions ?? 0,
        averageSessionDuration: s.averageSessionDuration ?? 0,
        engagementRate: s.engagementRate ?? 0,
        screenPageViews: s.pageviews ?? s.screenPageViews ?? 0,
      };
    },
    enabled: !!propertyId,
    retry: false,
  });

  // ── Top pages ──────────────────────────────────────────────────────────────
  const {
    data: pagesData,
    isLoading: pagesLoading,
    error: pagesError,
  } = useQuery<GA4TopPage[]>({
    queryKey: ["ga4-top-pages", propertyId, startStr, endStr],
    queryFn: async () => {
      const params = new URLSearchParams({
        propertyId,
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      });
      if (domain) params.set("domain", domain);

      console.log("[GA4Module] Fetching top pages:", { propertyId });

      const res = await fetch(`/api/metrics/top-pages?${params}`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `GA4 top pages failed (${res.status})`);
      }
      const json = await res.json();
      console.log("[GA4Module] Top pages response:", json);
      return (json.data ?? []).map((row: any) => ({
        page: row.page ?? row.pagePath ?? "—",
        users: row.users ?? row.totalUsers ?? 0,
        sessions: row.sessions ?? 0,
        conversions: row.conversions ?? 0,
      }));
    },
    enabled: !!propertyId,
    retry: false,
  });

  // ── Table columns ──────────────────────────────────────────────────────────
  const columns: Array<Column<GA4TopPage>> = [
    {
      key: "page",
      header: "Landing Page",
      render: (row) => (
        <span className="text-sm font-medium truncate max-w-[320px] block" title={row.page}>
          {row.page}
        </span>
      ),
    },
    {
      key: "users",
      header: "Users",
      align: "right",
      render: (row) => (row.users ?? 0).toLocaleString(),
    },
    {
      key: "sessions",
      header: "Sessions",
      align: "right",
      render: (row) => (row.sessions ?? 0).toLocaleString(),
    },
    {
      key: "conversions",
      header: "Conversions",
      align: "right",
      render: (row) => (row.conversions ?? 0).toLocaleString(),
    },
  ];

  // Format duration seconds → "m:ss"
  const formatDuration = (seconds: number): string => {
    if (!seconds || seconds === 0) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const hasError = summaryError || pagesError;
  const isLoading = summaryLoading || pagesLoading;

  if (hasError) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>GA4 Error</AlertTitle>
          <AlertDescription>
            {(summaryError as Error)?.message || (pagesError as Error)?.message || "Failed to load GA4 data. Ensure the service account has Viewer access to this GA4 property."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        <KpiCard
          title="Total Users"
          value={isLoading ? "—" : (summaryData?.totalUsers ?? 0).toLocaleString()}
          icon={Users}
          accent="cyan"
          changeLabel="Source: GA4"
        />
        <KpiCard
          title="Sessions"
          value={isLoading ? "—" : (summaryData?.sessions ?? 0).toLocaleString()}
          icon={MousePointerClick}
          accent="purple"
          changeLabel="Source: GA4"
        />
        <KpiCard
          title="Engaged Sessions"
          value={isLoading ? "—" : (summaryData?.engagedSessions ?? 0).toLocaleString()}
          icon={Target}
          accent="green"
          changeLabel="Source: GA4"
        />
        <KpiCard
          title="Engagement Rate"
          value={isLoading ? "—" : `${((summaryData?.engagementRate ?? 0) * 100).toFixed(1)}%`}
          icon={TrendingUp}
          accent="amber"
          changeLabel="Source: GA4"
        />
        <KpiCard
          title="Avg Session Duration"
          value={isLoading ? "—" : formatDuration(summaryData?.averageSessionDuration ?? 0)}
          icon={Clock}
          accent="cyan"
          changeLabel="Source: GA4"
        />
      </div>

      {/* Top Landing Pages */}
      <Card className="border-white/10 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Top Landing Pages (GA4)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pagesLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              <Database className="h-12 w-12 mx-auto mb-4 opacity-30 animate-pulse" />
              <p>Loading top pages…</p>
            </div>
          ) : !pagesData || pagesData.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p>No data available for the selected date range.</p>
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={pagesData}
              isLoading={pagesLoading}
              testIdPrefix="ga4-top-pages"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
