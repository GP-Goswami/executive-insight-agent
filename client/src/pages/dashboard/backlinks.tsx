import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { DataTable, Column } from "@/components/dashboard/data-table";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { FilterPanel } from "@/components/dashboard/filter-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useDomain } from "@/hooks/use-domain";
import { Link2, Globe, ExternalLink, Database, AlertCircle } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { subDays } from "date-fns";

interface BacklinkData {
  domain: string;
  targetUrl: string;
  anchorText: string;
  discoveredAt: string;
  type?: string;
  source?: string;
}

interface BacklinksResponse {
  backlinks?: BacklinkData[];
  overview?: {
    totalBacklinks: number;
    referringDomains: number;
  };
}

export default function BacklinksPage() {
  const { domain } = useDomain();
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });
  const [appliedRange, setAppliedRange] = useState<DateRange | undefined>(dateRange);
  const [filters, setFilters] = useState<Record<string, string>>({});

  const { data: backlinksData, isLoading, error } = useQuery<BacklinksResponse & { message?: string; configured?: boolean }>({
    queryKey: ["/api/metrics/backlinks", domain, appliedRange?.from?.toISOString(), appliedRange?.to?.toISOString()],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (domain) params.set("domain", domain);
      params.set("limit", "100");
      const res = await fetch(`/api/metrics/backlinks?${params}`);
      const data = await res.json();
      if (!res.ok) {
        if (data.configured !== undefined) {
          return data;
        }
        throw new Error(data.message || "Failed to fetch backlinks");
      }
      return data;
    },
    enabled: !!domain,
    retry: false,
  });

  const backlinks = backlinksData?.backlinks || [];
  const overview = backlinksData?.overview;

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
      key: "domain",
      label: "Domain",
      type: "text" as const,
      placeholder: "Search domains...",
    },
    {
      key: "type",
      label: "Link Type",
      type: "select" as const,
      options: [
        { label: "Follow", value: "follow" },
        { label: "Nofollow", value: "nofollow" },
      ],
    },
  ];

  const columns: Column<BacklinkData>[] = [
    {
      key: "domain",
      header: "Referring Domain",
      render: (row) => (
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{row.domain}</span>
          <a href={`https://${row.domain}`} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-3 w-3 text-muted-foreground" />
          </a>
        </div>
      ),
    },
    {
      key: "anchorText",
      header: "Anchor Text",
      render: (row) => (
        <span className="text-sm text-muted-foreground truncate max-w-[200px] block">
          {row.anchorText || "(no anchor)"}
        </span>
      ),
    },
    {
      key: "targetUrl",
      header: "Target URL",
      render: (row) => (
        <span className="text-sm text-muted-foreground truncate max-w-[150px] block">
          {row.targetUrl}
        </span>
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (row) => (
        <Badge variant="secondary">{row.type || "follow"}</Badge>
      ),
    },
    {
      key: "discoveredAt",
      header: "Discovered",
      render: (row) => (
        <span className="text-sm text-muted-foreground">{row.discoveredAt || "-"}</span>
      ),
    },
  ];

  const hasOverviewData = overview?.totalBacklinks != null;
  const hasBacklinksData = backlinks.length > 0;
  const hasRealData = hasOverviewData || hasBacklinksData;
  const totalBacklinks = overview?.totalBacklinks ?? (hasBacklinksData ? backlinks.length : null);
  const referringDomains = overview?.referringDomains ?? (hasBacklinksData ? new Set(backlinks.map(b => b.domain)).size : null);
  const dataSource = hasBacklinksData ? backlinks[0].source : null;
  const apiLimitationMessage = backlinksData?.message;
  const isApiLimitation = !hasRealData && apiLimitationMessage && backlinksData?.configured === true;

  if (error) {
    return (
      <div className="space-y-6" data-testid="backlinks-page">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Backlinks Explorer</h1>
            <p className="text-muted-foreground">
              Monitor backlink growth and referring domains
            </p>
          </div>
        </div>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Configuration Required</AlertTitle>
          <AlertDescription>
            {(error as Error).message || "SEMrush API is not configured. Please add SEMRUSH_API_KEY to secrets and enter a domain to view backlinks."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="backlinks-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Backlinks Explorer</h1>
          <p className="text-muted-foreground">
            Monitor backlink growth and referring domains
          </p>
          {dataSource && domain && (
            <Badge variant="secondary" className="mt-2 gap-1">
              <Database className="h-3 w-3" />
              Live data from {dataSource === "semrush" ? "SEMrush" : "DataForSEO"} for {domain}
            </Badge>
          )}
        </div>
        <DateRangePicker
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          onApply={handleApply}
        />
      </div>

      {!domain && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Domain Required</AlertTitle>
          <AlertDescription>
            Please enter a domain in the Settings page to view backlink data.
          </AlertDescription>
        </Alert>
      )}

      {domain && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <KpiCard
              title="Total Backlinks"
              value={totalBacklinks != null ? totalBacklinks : "-"}
              icon={Link2}
              accent="cyan"
            />
            <KpiCard
              title="Referring Domains"
              value={referringDomains != null ? referringDomains : "-"}
              icon={Globe}
              accent="purple"
            />
            <KpiCard
              title="Backlinks Shown"
              value={hasBacklinksData ? backlinks.length : "-"}
              icon={Link2}
              accent="green"
            />
          </div>

          {!hasRealData && !isLoading && (
            <Alert variant={isApiLimitation ? "default" : "destructive"}>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{isApiLimitation ? "API Subscription Required" : "No Backlinks Data Available"}</AlertTitle>
              <AlertDescription>
                {apiLimitationMessage || (
                  <>
                    Backlinks data could not be retrieved. This may be because:
                    <ul className="list-disc list-inside mt-2 space-y-1">
                      <li>SEMrush Backlinks API requires a separate subscription</li>
                      <li>DataForSEO API credentials are not configured or have insufficient credits</li>
                      <li>The domain has no tracked backlinks</li>
                    </ul>
                    Check Settings to ensure your API credentials are properly configured.
                  </>
                )}
              </AlertDescription>
            </Alert>
          )}

          <FilterPanel
            filters={filterConfig}
            values={filters}
            onChange={handleFilterChange}
            onReset={handleFilterReset}
          />

          <Card className="border-white/10 bg-card/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Recent Backlinks
              </CardTitle>
            </CardHeader>
            <CardContent>
              {backlinks.length === 0 && !isLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Link2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No backlink data found for {domain}.</p>
                  <p className="text-sm mt-2">Make sure the domain has backlinks tracked in SEMrush.</p>
                </div>
              ) : (
                <DataTable
                  columns={columns}
                  data={backlinks}
                  isLoading={isLoading}
                  testIdPrefix="backlinks"
                  pageSize={10}
                  totalItems={backlinks.length}
                />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
