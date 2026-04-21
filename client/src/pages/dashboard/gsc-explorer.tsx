import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { DataTable, Column } from "@/components/dashboard/data-table";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { FilterPanel } from "@/components/dashboard/filter-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useDomain } from "@/hooks/use-domain";
import { MousePointerClick, Eye, Percent, TrendingUp, AlertCircle, Search, Database } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { subDays } from "date-fns";

interface QueryData {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface PageData {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface ApiResponse {
  data?: QueryData[] | PageData[];
  message?: string;
  configured?: boolean;
  source?: string;
}

export default function GscExplorerPage() {
  const { gscSiteUrl } = useDomain();
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });
  const [appliedRange, setAppliedRange] = useState<DateRange | undefined>(dateRange);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState("queries");

  const { data: summaryResponse, isLoading: summaryLoading } = useQuery({
    queryKey: ["/api/metrics/gsc/summary", gscSiteUrl, appliedRange?.from?.toISOString(), appliedRange?.to?.toISOString()],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (gscSiteUrl) params.set("siteUrl", gscSiteUrl);
      if (appliedRange?.from) params.set("start", appliedRange.from.toISOString());
      if (appliedRange?.to) params.set("end", appliedRange.to.toISOString());
      const res = await fetch(`/api/metrics/gsc/summary?${params}`);
      if (!res.ok) {
        throw new Error("Failed to fetch GSC summary");
      }
      return await res.json();
    },
    enabled: !!gscSiteUrl,
    retry: false,
  });

  const { data: queriesResponse, isLoading: queriesLoading, error: queriesError } = useQuery<ApiResponse>({
    queryKey: ["/api/metrics/gsc/queries", gscSiteUrl, appliedRange?.from?.toISOString(), appliedRange?.to?.toISOString()],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (gscSiteUrl) params.set("siteUrl", gscSiteUrl);
      if (appliedRange?.from) params.set("start", appliedRange.from.toISOString());
      if (appliedRange?.to) params.set("end", appliedRange.to.toISOString());
      const res = await fetch(`/api/metrics/gsc/queries?${params}`);
      const data = await res.json();
      if (!res.ok) {
        if (data.configured !== undefined) {
          return data;
        }
        throw new Error(data.message || "Failed to fetch GSC queries");
      }
      return data;
    },
    enabled: !!gscSiteUrl,
    retry: false,
  });

  const { data: pagesResponse, isLoading: pagesLoading } = useQuery<ApiResponse>({
    queryKey: ["/api/metrics/gsc/pages", gscSiteUrl, appliedRange?.from?.toISOString(), appliedRange?.to?.toISOString()],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (gscSiteUrl) params.set("siteUrl", gscSiteUrl);
      if (appliedRange?.from) params.set("start", appliedRange.from.toISOString());
      if (appliedRange?.to) params.set("end", appliedRange.to.toISOString());
      const res = await fetch(`/api/metrics/gsc/pages?${params}`);
      const data = await res.json();
      if (!res.ok) {
        if (data.configured !== undefined) {
          return data;
        }
        throw new Error(data.message || "Failed to fetch GSC pages");
      }
      return data;
    },
    enabled: !!gscSiteUrl,
    retry: false,
  });

  const queries = (queriesResponse?.data || []) as QueryData[];
  const pages = (pagesResponse?.data || []) as PageData[];
  const isNotConfigured = queriesResponse?.configured === false;
  const needsSiteUrl = !gscSiteUrl || (queriesResponse?.message && queriesResponse.data?.length === 0);

  const handleApply = () => {
    setAppliedRange(dateRange);
  };

  const handleFilterChange = (key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const handleFilterReset = () => {
    setFilters({});
  };

  const filterConfig = [
    {
      key: "query",
      label: "Query",
      type: "text" as const,
      placeholder: "Search queries...",
    },
    {
      key: "page",
      label: "Page",
      type: "text" as const,
      placeholder: "Search pages...",
    },
    {
      key: "country",
      label: "Country",
      type: "select" as const,
      options: [
        { label: "United States", value: "US" },
        { label: "United Kingdom", value: "UK" },
        { label: "Germany", value: "DE" },
        { label: "France", value: "FR" },
        { label: "Canada", value: "CA" },
      ],
    },
    {
      key: "device",
      label: "Device",
      type: "select" as const,
      options: [
        { label: "Desktop", value: "DESKTOP" },
        { label: "Mobile", value: "MOBILE" },
        { label: "Tablet", value: "TABLET" },
      ],
    },
  ];

  const queryColumns: Column<QueryData>[] = [
    {
      key: "query",
      header: "Query",
      render: (row) => <span className="font-medium">{row.query}</span>,
    },
    { key: "clicks", header: "Clicks", align: "right" },
    { key: "impressions", header: "Impressions", align: "right" },
    {
      key: "ctr",
      header: "CTR",
      align: "right",
      render: (row) => <span className="font-mono">{row.ctr.toFixed(1)}%</span>,
    },
    {
      key: "position",
      header: "Position",
      align: "right",
      render: (row) => (
        <span className={row.position <= 10 ? "text-green-400" : "text-muted-foreground"}>
          {row.position.toFixed(1)}
        </span>
      ),
    },
  ];

  const pageColumns: Column<PageData>[] = [
    {
      key: "page",
      header: "Page",
      render: (row) => (
        <span className="font-medium truncate max-w-[300px] block">{row.page}</span>
      ),
    },
    { key: "clicks", header: "Clicks", align: "right" },
    { key: "impressions", header: "Impressions", align: "right" },
    {
      key: "ctr",
      header: "CTR",
      align: "right",
      render: (row) => <span className="font-mono">{row.ctr.toFixed(1)}%</span>,
    },
    {
      key: "position",
      header: "Position",
      align: "right",
      render: (row) => (
        <span className={row.position <= 10 ? "text-green-400" : "text-muted-foreground"}>
          {row.position.toFixed(1)}
        </span>
      ),
    },
  ];

  const hasData = queries.length > 0 || pages.length > 0;

  const summary = summaryResponse || { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  const hasSummary = summary.clicks > 0 || summary.impressions > 0;

  if (isNotConfigured) {
    return (
      <div className="space-y-6" data-testid="gsc-explorer-page">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Search Console Explorer</h1>
            <p className="text-muted-foreground">
              Analyze queries, pages, and search performance from Google Search Console
            </p>
          </div>
        </div>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Configuration Required</AlertTitle>
          <AlertDescription>
            {queriesResponse?.message || "Google Search Console is not configured. Please add GOOGLE_SERVICE_ACCOUNT_JSON to secrets and select a verified site to view GSC data."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="gsc-explorer-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Search Console Explorer</h1>
          <p className="text-muted-foreground">
            Analyze queries, pages, and search performance from Google Search Console
          </p>
          {gscSiteUrl && queries.length > 0 && (
            <Badge variant="secondary" className="mt-2 gap-1">
              <Database className="h-3 w-3" />
              Live data from GSC for {gscSiteUrl}
            </Badge>
          )}
        </div>
        <DateRangePicker
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          onApply={handleApply}
        />
      </div>

      {!gscSiteUrl && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>GSC Configuration Required</AlertTitle>
          <AlertDescription>
            <p className="mb-2">To view Search Console data:</p>
            <ol className="list-decimal list-inside space-y-1 text-sm">
              <li>Add the service account email as a user in Google Search Console with read access</li>
              <li>Enter your GSC site URL in Settings (e.g., https://example.com/ or sc-domain:example.com)</li>
            </ol>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Total Clicks"
          value={hasSummary ? summary.clicks : "-"}
          icon={MousePointerClick}
          accent="cyan"
        />
        <KpiCard
          title="Impressions"
          value={hasSummary ? summary.impressions : "-"}
          icon={Eye}
          accent="purple"
        />
        <KpiCard
          title="Avg CTR"
          value={hasSummary ? `${summary.ctr.toFixed(2)}%` : "-"}
          icon={Percent}
          accent="green"
        />
        <KpiCard
          title="Avg Position"
          value={hasSummary ? summary.position.toFixed(1) : "-"}
          icon={TrendingUp}
          accent="amber"
        />
      </div>

      <FilterPanel
        filters={filterConfig}
        values={filters}
        onChange={handleFilterChange}
        onReset={handleFilterReset}
      />

      <Card className="border-white/10 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="bg-muted/50">
              <TabsTrigger value="queries" data-testid="tab-queries">
                Queries
              </TabsTrigger>
              <TabsTrigger value="pages" data-testid="tab-pages">
                Pages
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          {activeTab === "queries" && (
            queries.length === 0 && !queriesLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No query data found for the selected period.</p>
                <p className="text-sm mt-2">Make sure a GSC site URL is configured in settings.</p>
              </div>
            ) : (
              <DataTable
                columns={queryColumns}
                data={queries}
                isLoading={queriesLoading}
                testIdPrefix="gsc-queries"
                pageSize={10}
                totalItems={queries.length}
              />
            )
          )}
          {activeTab === "pages" && (
            pages.length === 0 && !pagesLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No page data found for the selected period.</p>
                <p className="text-sm mt-2">Make sure a GSC site URL is configured in settings.</p>
              </div>
            ) : (
              <DataTable
                columns={pageColumns}
                data={pages}
                isLoading={pagesLoading}
                testIdPrefix="gsc-pages"
                pageSize={10}
                totalItems={pages.length}
              />
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
}
