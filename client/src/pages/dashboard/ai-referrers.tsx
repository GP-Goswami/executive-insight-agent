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
import { Bot, Users, Eye, AlertCircle } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { subDays } from "date-fns";
import { SourceToggle, type DataSource } from "@/components/dashboard/source-toggle";

interface AiReferrerData {
  source: string;
  totalUsers: number;
  sessions: number;
  avgSessionDuration: string;
  bounceRate: number;
  topLandingPage: string;
  engagementRate?: number;
}

interface ApiResponse {
  data?: AiReferrerData[];
  message?: string;
  configured?: boolean;
}

export default function AiReferrersPage() {
  const { ga4PropertyId } = useDomain();
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });
  const [appliedRange, setAppliedRange] = useState<DateRange | undefined>(dateRange);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [activeSource, setActiveSource] = useState<DataSource>("ga4");

  const { data: response, isLoading, error } = useQuery<ApiResponse>({
    queryKey: ["/api/metrics/ai-referrers", ga4PropertyId, appliedRange?.from?.toISOString(), appliedRange?.to?.toISOString()],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (ga4PropertyId) params.set("propertyId", ga4PropertyId);
      if (appliedRange?.from) params.set("start", appliedRange.from.toISOString());
      if (appliedRange?.to) params.set("end", appliedRange.to.toISOString());
      const res = await fetch(`/api/metrics/ai-referrers?${params}`, { credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        if (data.configured === false || data.configured === true) {
          return data;
        }
        throw new Error(data.message || "Failed to fetch AI referrers");
      }
      return data;
    },
    enabled: !!ga4PropertyId,
    retry: false,
  });

  const aiReferrers = response?.data || [];
  const isNotConfigured = response?.configured === false;
  const needsPropertyId = !ga4PropertyId;

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
      key: "source",
      label: "AI Source",
      type: "select" as const,
      options: [
        { label: "ChatGPT", value: "chatgpt" },
        { label: "Google Gemini", value: "gemini" },
        { label: "Perplexity", value: "perplexity" },
        { label: "Microsoft Copilot", value: "copilot" },
        { label: "Claude", value: "claude" },
      ],
    },
    {
      key: "device",
      label: "Device",
      type: "select" as const,
      options: [
        { label: "Desktop", value: "desktop" },
        { label: "Mobile", value: "mobile" },
        { label: "Tablet", value: "tablet" },
      ],
    },
    {
      key: "landingPage",
      label: "Landing Page",
      type: "text" as const,
      placeholder: "Search pages...",
    },
  ];

  const hasData = aiReferrers.length > 0;
  const totalAiUsers = aiReferrers.reduce((acc, d) => acc + d.totalUsers, 0);
  const totalSessions = aiReferrers.reduce((acc, d) => acc + d.sessions, 0);

  const columns: Column<AiReferrerData>[] = [
    {
      key: "source",
      header: "AI Source",
      render: (row) => (
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-cyan-400" />
          <span className="font-medium">{row.source}</span>
        </div>
      ),
    },
    { key: "totalUsers", header: "Users", align: "right" },
    { key: "sessions", header: "Sessions", align: "right" },
    { key: "avgSessionDuration", header: "Avg Duration", align: "right" },
    {
      key: "bounceRate",
      header: "Engagement Rate",
      align: "right",
      render: (row) => (
        <span className={row.engagementRate && row.engagementRate < 40 ? "text-amber-400" : "text-green-400"}>
          {row.engagementRate || 100 - row.bounceRate}%
        </span>
      ),
    },
    {
      key: "topLandingPage",
      header: "Top Landing Page",
      render: (row) => (
        <span className="text-sm text-muted-foreground truncate max-w-[200px] block">
          {row.topLandingPage}
        </span>
      ),
    },
  ];

  if (error || isNotConfigured) {
    return (
      <div className="space-y-6" data-testid="ai-referrers-page">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">AI Referrer Explorer</h1>
            <p className="text-muted-foreground">
              Track traffic from AI platforms like ChatGPT, Gemini, and Perplexity
            </p>
          </div>
        </div>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Configuration Required</AlertTitle>
          <AlertDescription>
            {(error as Error)?.message || "Google Analytics is not configured. Please add GOOGLE_SERVICE_ACCOUNT_JSON to secrets to view AI referrer data."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="ai-referrers-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AI Referrer Explorer</h1>
          <p className="text-muted-foreground">
            Track traffic from AI platforms like ChatGPT, Gemini, and Perplexity
          </p>
        </div>
        <DateRangePicker
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          onApply={handleApply}
        />
      </div>

      <SourceToggle activeSource={activeSource} onSourceChange={setActiveSource} />

      {activeSource === "ga4" && needsPropertyId && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>GA4 Property ID Required</AlertTitle>
          <AlertDescription>
            {response?.message || "Please configure your GA4 property ID in Settings to view AI referrer data."}
          </AlertDescription>
        </Alert>
      )}

      {activeSource === "gsc" && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Not Available</AlertTitle>
          <AlertDescription>
            Not available for GSC (No referrer data provided by Google Search Console).
          </AlertDescription>
        </Alert>
      )}

      {activeSource === "semrush" && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>No Data</AlertTitle>
          <AlertDescription>
            Data not available for selected source (SEMrush does not provide explicit AI referrers).
          </AlertDescription>
        </Alert>
      )}

      {activeSource === "ga4" && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <KpiCard
              title="Total AI Users"
              value={hasData ? totalAiUsers : "-"}
              icon={Bot}
              accent="purple"
            />
            <KpiCard
              title="AI Sessions"
              value={hasData ? totalSessions : "-"}
              icon={Users}
              accent="cyan"
            />
            <KpiCard
              title="AI Sources Tracked"
              value={hasData ? aiReferrers.length : "-"}
              icon={Eye}
              accent="green"
            />
          </div>

          <FilterPanel
            filters={filterConfig}
            values={filters}
            onChange={handleFilterChange}
            onReset={handleFilterReset}
          />

          {aiReferrers.length > 0 && (
            <Card className="border-white/10 bg-card/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                  Traffic by Source
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {aiReferrers.map((item) => {
                    const percentage = totalAiUsers > 0 ? (item.totalUsers / totalAiUsers) * 100 : 0;
                    return (
                      <div key={item.source} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium">{item.source}</span>
                          <span className="text-muted-foreground font-mono">
                            {item.totalUsers.toLocaleString()}
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-muted/50 overflow-hidden">
                          <div
                            className="h-full rounded-full gradient-cyan-purple transition-all"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="border-white/10 bg-card/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                AI Referrer Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              {aiReferrers.length === 0 && !isLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Bot className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No AI referrer data found for the selected period.</p>
                  <p className="text-sm mt-2">Make sure your GA4 property is configured and receiving traffic from AI platforms.</p>
                </div>
              ) : (
                <DataTable
                  columns={columns}
                  data={aiReferrers}
                  isLoading={isLoading}
                  testIdPrefix="ai-referrers"
                />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
