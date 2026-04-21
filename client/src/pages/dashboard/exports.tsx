import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable, Column } from "@/components/dashboard/data-table";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileDown, Link as LinkIcon, Copy, Check, Clock, Eye } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { subDays, format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

interface ShareLink {
  id: string;
  token: string;
  createdAt: string;
  expiresAt: string | null;
  views: number;
  filters: string;
}

export default function ExportsPage() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });
  const [reportType, setReportType] = useState("executive");
  const [exportFormat, setExportFormat] = useState("pdf");
  const [copied, setCopied] = useState<string | null>(null);
  const { toast } = useToast();

  const handleApply = () => {
    toast({
      title: "Date range applied",
      description: "Your export will include data from the selected date range.",
    });
  };

  const handleGeneratePdf = () => {
    toast({
      title: "Generating PDF",
      description: "Your report is being generated. This may take a few moments.",
    });
  };

  const handleCreateShareLink = () => {
    toast({
      title: "Share link created",
      description: "A new shareable link has been generated.",
    });
  };

  const handleCopyLink = (token: string) => {
    navigator.clipboard.writeText(`https://app.example.com/share/${token}`);
    setCopied(token);
    setTimeout(() => setCopied(null), 2000);
    toast({
      title: "Link copied",
      description: "Share link copied to clipboard.",
    });
  };

  const shareLinks: ShareLink[] = [
    { id: "1", token: "abc123xyz", createdAt: "2025-12-28", expiresAt: "2026-01-28", views: 12, filters: "Last 30 days, All sources" },
    { id: "2", token: "def456uvw", createdAt: "2025-12-25", expiresAt: null, views: 45, filters: "Last 90 days, AI referrers" },
    { id: "3", token: "ghi789rst", createdAt: "2025-12-20", expiresAt: "2025-12-27", views: 8, filters: "Custom range, GSC only" },
  ];

  const columns: Column<ShareLink>[] = [
    {
      key: "token",
      header: "Share Link",
      render: (row) => (
        <div className="flex items-center gap-2">
          <LinkIcon className="h-4 w-4 text-cyan-400" />
          <code className="text-sm font-mono bg-muted/50 px-2 py-0.5 rounded">
            ...{row.token.slice(-8)}
          </code>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => handleCopyLink(row.token)}
            data-testid={`button-copy-${row.id}`}
          >
            {copied === row.token ? (
              <Check className="h-3.5 w-3.5 text-green-400" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      ),
    },
    {
      key: "filters",
      header: "Filters",
      render: (row) => (
        <span className="text-sm text-muted-foreground">{row.filters}</span>
      ),
    },
    {
      key: "views",
      header: "Views",
      align: "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Eye className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{row.views}</span>
        </div>
      ),
    },
    {
      key: "createdAt",
      header: "Created",
      render: (row) => (
        <span className="text-sm text-muted-foreground">{row.createdAt}</span>
      ),
    },
    {
      key: "expiresAt",
      header: "Expires",
      render: (row) => (
        <div className="flex items-center gap-1">
          {row.expiresAt ? (
            <>
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{row.expiresAt}</span>
            </>
          ) : (
            <Badge variant="secondary" className="text-xs">Never</Badge>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6" data-testid="exports-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Exports & Sharing</h1>
          <p className="text-muted-foreground">
            Generate PDF reports and create shareable dashboard links
          </p>
        </div>
        <DateRangePicker
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          onApply={handleApply}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-white/10 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Generate PDF Report</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Report Type</label>
              <Select value={reportType} onValueChange={setReportType}>
                <SelectTrigger className="bg-muted/50 border-white/10" data-testid="select-report-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-white/10">
                  <SelectItem value="executive">Executive Overview</SelectItem>
                  <SelectItem value="ai-traffic">AI Traffic Report</SelectItem>
                  <SelectItem value="gsc">Search Console Report</SelectItem>
                  <SelectItem value="rankings">Rankings Report</SelectItem>
                  <SelectItem value="backlinks">Backlinks Report</SelectItem>
                  <SelectItem value="full">Full Dashboard Export</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Export Format</label>
              <Select value={exportFormat} onValueChange={setExportFormat}>
                <SelectTrigger className="bg-muted/50 border-white/10" data-testid="select-export-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-white/10">
                  <SelectItem value="pdf">PDF Document</SelectItem>
                  <SelectItem value="pdf-dark">PDF (Dark Theme)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="pt-4 border-t border-white/10">
              <div className="flex items-center justify-between text-sm mb-4">
                <span className="text-muted-foreground">Date Range</span>
                <span>
                  {dateRange?.from && dateRange?.to
                    ? `${format(dateRange.from, "MMM d")} - ${format(dateRange.to, "MMM d, yyyy")}`
                    : "Select date range"}
                </span>
              </div>
              <Button
                className="w-full gradient-cyan-purple text-white glow-cyan gap-2"
                onClick={handleGeneratePdf}
                data-testid="button-generate-pdf"
              >
                <FileDown className="h-4 w-4" />
                Generate PDF
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Create Share Link</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Create a read-only shareable link that allows others to view the current 
              dashboard with your selected filters and date range.
            </p>

            <div className="space-y-3">
              <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30">
                <span className="text-sm">Current View</span>
                <Badge variant="secondary">Executive Overview</Badge>
              </div>
              <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30">
                <span className="text-sm">Date Range</span>
                <span className="text-sm text-muted-foreground">
                  {dateRange?.from && dateRange?.to
                    ? `${format(dateRange.from, "MMM d")} - ${format(dateRange.to, "MMM d")}`
                    : "All time"}
                </span>
              </div>
              <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30">
                <span className="text-sm">Expiration</span>
                <Select defaultValue="30">
                  <SelectTrigger className="w-32 h-8 bg-transparent border-0" data-testid="select-expiration">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-white/10">
                    <SelectItem value="7">7 days</SelectItem>
                    <SelectItem value="30">30 days</SelectItem>
                    <SelectItem value="90">90 days</SelectItem>
                    <SelectItem value="never">Never</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button
              variant="outline"
              className="w-full border-cyan-500/50 text-cyan-400 gap-2"
              onClick={handleCreateShareLink}
              data-testid="button-create-share-link"
            >
              <LinkIcon className="h-4 w-4" />
              Create Share Link
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="border-white/10 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Active Share Links
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={shareLinks}
            testIdPrefix="share-links"
            emptyMessage="No share links created yet"
          />
        </CardContent>
      </Card>
    </div>
  );
}
