import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { DataTable, Column } from "@/components/dashboard/data-table";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { FilterPanel } from "@/components/dashboard/filter-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDomain } from "@/hooks/use-domain";
import { TrendingUp, TrendingDown, Award, Target, Minus, Database, AlertCircle, Search, MousePointerClick, Eye } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { subDays, format } from "date-fns";

interface GSCRankingData {
  keyword: string;
  position: number;
  previousPosition: number | null;
  change: number;
  url: string;
  clicks: number;
  impressions: number;
  ctr: number;
  source: "gsc";
}

interface SemrushRankingData {
  keyword: string;
  position: number;
  previousPosition: number;
  change: number;
  url: string;
  searchVolume: number;
  location: string;
  traffic?: number;
  cpc?: number;
  source: "semrush";
}

type RankingData = GSCRankingData | SemrushRankingData;

interface GSCResponse {
  data: GSCRankingData[];
  summary?: {
    totalKeywords: number;
    improvements: number;
    declines: number;
    avgPosition: number;
  };
  source: "gsc";
  message?: string;
  configured?: boolean;
  permissionError?: boolean;
}

interface SemrushResponse {
  message?: string;
  configured?: boolean;
  noData?: boolean;
  data?: SemrushRankingData[];
}

export default function RankingsPage() {
  const { domain, gscSiteUrl, ga4PropertyId } = useDomain();
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });
  const [appliedRange, setAppliedRange] = useState<DateRange | undefined>(dateRange);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [dataSource, setDataSource] = useState<"gsc" | "semrush">("gsc");

  const { data: gscResponse, isLoading: gscLoading, error: gscError } = useQuery<GSCResponse>({
    queryKey: ["/api/metrics/gsc/rankings", gscSiteUrl, appliedRange?.from?.toISOString(), appliedRange?.to?.toISOString()],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (gscSiteUrl) params.set("siteUrl", gscSiteUrl);
      if (appliedRange?.from) params.set("start", appliedRange.from.toISOString());
      if (appliedRange?.to) params.set("end", appliedRange.to.toISOString());
      const res = await fetch(`/api/metrics/gsc/rankings?${params}`);
      const data = await res.json();
      return data;
    },
    enabled: !!gscSiteUrl,
    retry: false,
  });

  const { data: semrushResponse, isLoading: semrushLoading } = useQuery<SemrushRankingData[] | SemrushResponse>({
    queryKey: ["/api/metrics/rankings", domain],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (domain) params.set("domain", domain);
      params.set("limit", "100");
      const res = await fetch(`/api/metrics/rankings?${params}`);
      const data = await res.json();
      return data;
    },
    enabled: !!domain && dataSource === "semrush",
    retry: false,
  });

  const { data: queriesResponse } = useQuery({
    queryKey: ["/api/metrics/gsc/queries", gscSiteUrl, appliedRange],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (gscSiteUrl) params.set("siteUrl", gscSiteUrl);
      if (appliedRange?.from) params.set("start", appliedRange.from.toISOString());
      if (appliedRange?.to) params.set("end", appliedRange.to.toISOString());
      const res = await fetch(`/api/metrics/gsc/queries?${params}`);
      return res.json();
    },
    enabled: !!gscSiteUrl,
  });

  const { data: pagesResponse } = useQuery({
    queryKey: ["/api/metrics/gsc/pages", gscSiteUrl, appliedRange],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (gscSiteUrl) params.set("siteUrl", gscSiteUrl);
      if (appliedRange?.from) params.set("start", appliedRange.from.toISOString());
      if (appliedRange?.to) params.set("end", appliedRange.to.toISOString());
      const res = await fetch(`/api/metrics/gsc/pages?${params}`);
      return res.json();
    },
    enabled: !!gscSiteUrl,
  });

  const { data: overviewResponse } = useQuery({
    queryKey: ["/api/metrics/overview", domain, appliedRange],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (domain) params.set("domain", domain);
      if (appliedRange?.from) params.set("start", appliedRange.from.toISOString());
      if (appliedRange?.to) params.set("end", appliedRange.to.toISOString());
      if (ga4PropertyId) params.set("propertyId", ga4PropertyId);
      const res = await fetch(`/api/metrics/overview?${params}`);
      return res.json();
    },
    enabled: !!domain && !!appliedRange,
  });

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
      key: "keyword",
      label: "Keyword",
      type: "text" as const,
      placeholder: "Search keywords...",
    },
    {
      key: "positionRange",
      label: "Position Range",
      type: "select" as const,
      options: [
        { label: "Top 3", value: "1-3" },
        { label: "Top 10", value: "1-10" },
        { label: "11-20", value: "11-20" },
        { label: "21-50", value: "21-50" },
        { label: "51+", value: "51+" },
      ],
    },
  ];

  const gscColumns: Column<GSCRankingData>[] = [
    {
      key: "keyword",
      header: "Keyword",
      render: (row) => <span className="font-medium">{row.keyword}</span>,
    },
    {
      key: "position",
      header: "Position",
      align: "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-2">
          <span
            className={
              row.position <= 3
                ? "text-green-400 font-bold"
                : row.position <= 10
                ? "text-cyan-400"
                : "text-muted-foreground"
            }
          >
            {row.position}
          </span>
          {row.position <= 3 && <Award className="h-4 w-4 text-amber-400" />}
        </div>
      ),
    },
    {
      key: "change",
      header: "Change",
      align: "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          {row.change > 0 && <TrendingUp className="h-4 w-4 text-green-400" />}
          {row.change < 0 && <TrendingDown className="h-4 w-4 text-red-400" />}
          {row.change === 0 && <Minus className="h-4 w-4 text-muted-foreground" />}
          <span
            className={
              row.change > 0
                ? "text-green-400"
                : row.change < 0
                ? "text-red-400"
                : "text-muted-foreground"
            }
          >
            {row.change > 0 && "+"}
            {row.change}
          </span>
        </div>
      ),
    },
    {
      key: "clicks",
      header: "Clicks",
      align: "right",
      render: (row) => <span className="font-mono">{row.clicks.toLocaleString()}</span>,
    },
    {
      key: "impressions",
      header: "Impressions",
      align: "right",
      render: (row) => <span className="font-mono">{row.impressions.toLocaleString()}</span>,
    },
    {
      key: "ctr",
      header: "CTR",
      align: "right",
      render: (row) => <span className="font-mono">{row.ctr}%</span>,
    },
    {
      key: "url",
      header: "URL",
      render: (row) => (
        <span className="text-sm text-muted-foreground truncate max-w-[200px] block">
          {row.url}
        </span>
      ),
    },
  ];

  const semrushColumns: Column<SemrushRankingData>[] = [
    {
      key: "keyword",
      header: "Keyword",
      render: (row) => <span className="font-medium">{row.keyword}</span>,
    },
    {
      key: "position",
      header: "Position",
      align: "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-2">
          <span
            className={
              row.position <= 3
                ? "text-green-400 font-bold"
                : row.position <= 10
                ? "text-cyan-400"
                : "text-muted-foreground"
            }
          >
            {row.position}
          </span>
          {row.position <= 3 && <Award className="h-4 w-4 text-amber-400" />}
        </div>
      ),
    },
    {
      key: "change",
      header: "Change",
      align: "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          {row.change > 0 && <TrendingUp className="h-4 w-4 text-green-400" />}
          {row.change < 0 && <TrendingDown className="h-4 w-4 text-red-400" />}
          {row.change === 0 && <Minus className="h-4 w-4 text-muted-foreground" />}
          <span
            className={
              row.change > 0
                ? "text-green-400"
                : row.change < 0
                ? "text-red-400"
                : "text-muted-foreground"
            }
          >
            {row.change > 0 && "+"}
            {row.change}
          </span>
        </div>
      ),
    },
    {
      key: "searchVolume",
      header: "Volume",
      align: "right",
      render: (row) => <span className="font-mono">{row.searchVolume.toLocaleString()}</span>,
    },
    {
      key: "url",
      header: "URL",
      render: (row) => (
        <span className="text-sm text-muted-foreground truncate max-w-[200px] block">
          {row.url}
        </span>
      ),
    },
    {
      key: "location",
      header: "Location",
      render: (row) => <Badge variant="secondary">{row.location}</Badge>,
    },
  ];
  const summary = gscResponse?.summary || null;
  const queries = queriesResponse?.data || [];
  const pages = pagesResponse?.data || [];
  const ga4 = overviewResponse?.summary || null;
  const gscData = gscResponse?.data || [];
  const gscSummary = gscResponse?.summary;
  const gscHasData = gscData.length > 0;
  const gscPermissionError = gscResponse?.permissionError;
  const gscNotConfigured = !gscSiteUrl;

  const semrushData = Array.isArray(semrushResponse) ? semrushResponse : [];
  const semrushHasData = semrushData.length > 0;

  const isLoading = dataSource === "gsc" ? gscLoading : semrushLoading;
  const currentData = dataSource === "gsc" ? gscData : semrushData;
  const hasData = dataSource === "gsc" ? gscHasData : semrushHasData;

  const top3Count = currentData.filter((r) => r.position <= 3).length;
  const top10Count = currentData.filter((r) => r.position <= 10).length;
  const improved = currentData.filter((r) => r.change > 0).length;
  const declined = currentData.filter((r) => r.change < 0).length;
  const avgPosition = hasData ? currentData.reduce((acc, r) => acc + r.position, 0) / currentData.length : 0;

  const needsConfiguration = (dataSource === "gsc" && gscNotConfigured) || (dataSource === "semrush" && !domain);

  return (
    <div className="space-y-6" data-testid="rankings-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Rankings Explorer</h1>
          <p className="text-muted-foreground">
            Monitor keyword positions and track ranking changes over time
          </p>
        </div>
        <DateRangePicker
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          onApply={handleApply}
        />
      </div>

      <Tabs value={dataSource} onValueChange={(v) => setDataSource(v as "gsc" | "semrush")}>
        <TabsList>
          <TabsTrigger value="gsc" className="gap-2" data-testid="tab-gsc">
            <Search className="h-4 w-4" />
            Google Search Console
          </TabsTrigger>
          <TabsTrigger value="semrush" className="gap-2" data-testid="tab-semrush">
            <Database className="h-4 w-4" />
            SEMrush
          </TabsTrigger>
        </TabsList>

        <TabsContent value="gsc" className="space-y-6 mt-6">
          {gscNotConfigured && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>GSC Configuration Required</AlertTitle>
              <AlertDescription>
                Please configure your GSC Site URL in the Settings page to view Google Search Console rankings data.
              </AlertDescription>
            </Alert>
          )}

          {gscPermissionError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Permission Denied</AlertTitle>
              <AlertDescription>
                The service account does not have access to this site. Please add the service account email to Google Search Console with read access.
              </AlertDescription>
            </Alert>
          )}

          {gscSiteUrl && !gscPermissionError && (
            <>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="gap-1">
                  <Database className="h-3 w-3" />
                  Live data from Google Search Console
                </Badge>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                <KpiCard
                  title="Total Keywords"
                  value={gscHasData ? gscSummary?.totalKeywords || gscData.length : "-"}
                  icon={Search}
                  accent="cyan"
                />
                <KpiCard
                  title="Top 10 Keywords"
                  value={gscHasData ? top10Count : "-"}
                  icon={Award}
                  accent="amber"
                />
                <KpiCard
                  title="Avg Position"
                  value={gscHasData ? avgPosition.toFixed(1) : "-"}
                  icon={Target}
                  accent="purple"
                />
                <Card className="border-white/10 bg-card/50 backdrop-blur-sm">
                  <CardContent className="p-6">
                    <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                      Improved
                    </p>
                    <p className="mt-2 text-3xl font-bold tracking-tight text-green-400 font-mono">
                      {gscHasData ? improved : "-"}
                    </p>
                    <div className="mt-2 flex items-center gap-1">
                      <TrendingUp className="h-4 w-4 text-green-400" />
                      <span className="text-xs text-muted-foreground">vs previous period</span>
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-white/10 bg-card/50 backdrop-blur-sm">
                  <CardContent className="p-6">
                    <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                      Declined
                    </p>
                    <p className="mt-2 text-3xl font-bold tracking-tight text-red-400 font-mono">
                      {gscHasData ? declined : "-"}
                    </p>
                    <div className="mt-2 flex items-center gap-1">
                      <TrendingDown className="h-4 w-4 text-red-400" />
                      <span className="text-xs text-muted-foreground">vs previous period</span>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <FilterPanel
                filters={filterConfig}
                values={filters}
                onChange={handleFilterChange}
                onReset={handleFilterReset}
              />

              <Card className="border-white/10 bg-card/50 backdrop-blur-sm">
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                    Keyword Rankings from GSC
                  </CardTitle>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <MousePointerClick className="h-4 w-4" />
                      <span>Total Clicks: {gscData.reduce((sum, r) => sum + r.clicks, 0).toLocaleString()}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Eye className="h-4 w-4" />
                      <span>Total Impressions: {gscData.reduce((sum, r) => sum + r.impressions, 0).toLocaleString()}</span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {gscData.length === 0 && !gscLoading ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>No ranking data found for this site.</p>
                      <p className="text-sm mt-2">Data may take a few days to appear in Google Search Console.</p>
                    </div>
                  ) : (
                    <DataTable
                      columns={gscColumns}
                      data={gscData}
                      isLoading={gscLoading}
                      testIdPrefix="gsc-rankings"
                      pageSize={10}
                      totalItems={gscData.length}
                    />
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="semrush" className="space-y-6 mt-6">
          {!domain && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Domain Required</AlertTitle>
              <AlertDescription>
                Please enter a domain in the Settings page to view SEMrush keyword rankings.
              </AlertDescription>
            </Alert>
          )}

          {domain && (
            <>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="gap-1">
                  <Database className="h-3 w-3" />
                  Data from SEMrush for {domain}
                </Badge>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                <KpiCard
                  title="Top 3 Keywords"
                  value={semrushHasData ? semrushData.filter(r => r.position <= 3).length : "-"}
                  icon={Award}
                  accent="amber"
                />
                <KpiCard
                  title="Top 10 Keywords"
                  value={semrushHasData ? semrushData.filter(r => r.position <= 10).length : "-"}
                  icon={TrendingUp}
                  accent="cyan"
                />
                <KpiCard
                  title="Avg Position"
                  value={semrushHasData ? (semrushData.reduce((acc, r) => acc + r.position, 0) / semrushData.length).toFixed(1) : "-"}
                  icon={Target}
                  accent="purple"
                />
                <Card className="border-white/10 bg-card/50 backdrop-blur-sm">
                  <CardContent className="p-6">
                    <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                      Improved
                    </p>
                    <p className="mt-2 text-3xl font-bold tracking-tight text-green-400 font-mono">
                      {semrushHasData ? semrushData.filter(r => r.change > 0).length : "-"}
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-white/10 bg-card/50 backdrop-blur-sm">
                  <CardContent className="p-6">
                    <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                      Declined
                    </p>
                    <p className="mt-2 text-3xl font-bold tracking-tight text-red-400 font-mono">
                      {semrushHasData ? semrushData.filter(r => r.change < 0).length : "-"}
                    </p>
                  </CardContent>
                </Card>
              </div>

              <Card className="border-white/10 bg-card/50 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                    Keyword Rankings from SEMrush
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {semrushData.length === 0 && !semrushLoading ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>No ranking data found for {domain}.</p>
                      <p className="text-sm mt-2">Make sure SEMrush API is configured and the domain has organic rankings.</p>
                    </div>
                  ) : (
                    <DataTable
                      columns={semrushColumns}
                      data={semrushData}
                      isLoading={semrushLoading}
                      testIdPrefix="semrush-rankings"
                      pageSize={10}
                      totalItems={semrushData.length}
                    />
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
