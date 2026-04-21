/**
 * GscModule — fetches Google Search Console data via the backend service account.
 * No OAuth token required — uses GOOGLE_SERVICE_ACCOUNT_JSON configured on the server.
 *
 * Rules (strict):
 *  - Summary: property-level totals (clicks, impressions, CTR, position)
 *  - Pages: top 10 pages by clicks
 *  - Falls back to 0 for all metrics if API fails or returns no data
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
  Target,
  TrendingUp,
  Users,
  Database,
  FileText,
  CheckCircle2,
} from "lucide-react";
import { format } from "date-fns";

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface GscModuleProps {
  /** Full site URL including protocol and trailing slash: "https://www.truefirms.co/" */
  siteUrl: string;
  startDate: Date;
  endDate: Date;
}

interface GSCSummary {
  clicks: number;
  impressions: number;
  /** Already converted to percentage (ctr * 100) */
  ctr: number;
  position: number;
}

interface GSCPage {
  page_url: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GscModule({ siteUrl, startDate, endDate }: GscModuleProps) {
  const formattedStart = format(startDate, "yyyy-MM-dd");
  const formattedEnd = format(endDate, "yyyy-MM-dd");

  // ── Summary — backend service account (no OAuth token needed) ──────────────
  const {
    data: summaryData,
    isLoading: summaryLoading,
    error: summaryError,
  } = useQuery<GSCSummary>({
    queryKey: ["gsc-summary-backend", siteUrl, formattedStart, formattedEnd],
    queryFn: async () => {
      console.log("[GscModule] Fetching summary via backend:", { siteUrl, formattedStart, formattedEnd });
      const params = new URLSearchParams({
        siteUrl,
        start: formattedStart,
        end: formattedEnd,
      });
      const res = await fetch(`/api/metrics/gsc/summary?${params}`, {
        credentials: "include",
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = err?.message || `GSC API error (${res.status})`;
        console.error("[GscModule] Summary error:", msg);
        // Return zeroed data instead of throwing — fail gracefully
        return { clicks: 0, impressions: 0, ctr: 0, position: 0 };
      }

      const json = await res.json();
      console.log("[GscModule] Summary response:", json);

      // Backend returns { clicks, impressions, ctr (fraction), position }
      return {
        clicks: json.clicks ?? 0,
        impressions: json.impressions ?? 0,
        // Backend already returns ctr as a percentage (e.g. 3.45 = 3.45%)
        ctr: parseFloat((json.ctr ?? 0).toFixed(2)),
        position: json.position ?? 0,
      };
    },
    enabled: !!siteUrl,
    retry: false,
  });

  // ── Top Pages — backend service account ────────────────────────────────────
  const {
    data: pagesData,
    isLoading: pagesLoading,
    error: pagesError,
  } = useQuery<GSCPage[]>({
    queryKey: ["gsc-pages-backend", siteUrl, formattedStart, formattedEnd],
    queryFn: async () => {
      console.log("[GscModule] Fetching top pages via backend:", { siteUrl });
      const params = new URLSearchParams({
        siteUrl,
        start: formattedStart,
        end: formattedEnd,
      });
      const res = await fetch(`/api/metrics/gsc/pages?${params}`, {
        credentials: "include",
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("[GscModule] Pages error:", err?.message);
        // Return empty array — fail gracefully
        return [];
      }

      const json = await res.json();
      console.log("[GscModule] Pages response:", json);

      const rows: any[] = json.data || [];
      return rows.slice(0, 10).map((row) => ({
        page_url: row.page ?? row.keys?.[0] ?? "—",
        clicks: row.clicks ?? 0,
        impressions: row.impressions ?? 0,
        // Backend already returns ctr as a percentage (e.g. 3.45 = 3.45%)
        ctr: parseFloat((row.ctr ?? 0).toFixed(2)),
        position: (row.position ?? 0).toFixed(1),
      }));
    },
    enabled: !!siteUrl,
    retry: false,
  });

  // ── Derived states ─────────────────────────────────────────────────────────
  const isLoading = summaryLoading || pagesLoading;
  const hasNoData =
    !isLoading && summaryData && summaryData.impressions === 0;

  const columns: Array<Column<GSCPage>> = [
    {
      key: "page_url",
      header: "Page URL",
      render: (row) => (
        <span className="text-sm font-medium truncate max-w-[320px] block" title={row.page_url}>
          {row.page_url}
        </span>
      ),
    },
    {
      key: "clicks",
      header: "Clicks",
      align: "right",
      render: (row) => (row.clicks ?? 0).toLocaleString(),
    },
    {
      key: "impressions",
      header: "Impressions",
      align: "right",
      render: (row) => (row.impressions ?? 0).toLocaleString(),
    },
    {
      key: "ctr",
      header: "CTR (%)",
      align: "right",
      render: (row) => `${row.ctr}%`,
    },
    {
      key: "position",
      header: "Position",
      align: "right",
    },
  ];

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Connected badge */}
      <div className="flex items-center gap-2 text-sm text-green-400">
        <CheckCircle2 className="h-4 w-4" />
        <span>Connected via service account — no token required</span>
      </div>

      {/* No data banner */}
      {hasNoData && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>No GSC Data</AlertTitle>
          <AlertDescription>
            No data available for the selected date range. Try widening the date range or verify that{" "}
            <strong>{siteUrl}</strong> is the exact URL as shown in Search Console (with trailing slash).
          </AlertDescription>
        </Alert>
      )}

      {/* Error banners — show 0 values but still indicate the issue */}
      {(summaryError || pagesError) && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>GSC Partial Error</AlertTitle>
          <AlertDescription>
            {(summaryError as Error)?.message ||
              (pagesError as Error)?.message ||
              "Could not load some GSC data. Values defaulted to 0."}
          </AlertDescription>
        </Alert>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Total Clicks"
          value={isLoading ? "—" : (summaryData?.clicks ?? 0).toLocaleString()}
          icon={MousePointerClick}
          accent="cyan"
          changeLabel="Source: GSC (Service Account)"
        />
        <KpiCard
          title="Total Impressions"
          value={isLoading ? "—" : (summaryData?.impressions ?? 0).toLocaleString()}
          icon={Users}
          accent="purple"
          changeLabel="Source: GSC (Service Account)"
        />
        <KpiCard
          title="Avg CTR"
          value={isLoading ? "—" : `${summaryData?.ctr ?? 0}%`}
          icon={Target}
          accent="green"
          changeLabel="Source: GSC (Service Account)"
        />
        <KpiCard
          title="Avg Position"
          value={isLoading ? "—" : (summaryData?.position ?? 0).toFixed(1)}
          icon={TrendingUp}
          accent="amber"
          changeLabel="Source: GSC (Service Account)"
        />
      </div>

      {/* Top Pages Table */}
      <Card className="border-white/10 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Top Pages (Google Search Console)
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
              <p>No page data available for the selected date range.</p>
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={pagesData}
              isLoading={isLoading}
              testIdPrefix="top-pages-gsc"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
