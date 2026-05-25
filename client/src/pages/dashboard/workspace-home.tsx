// Workspace Home — default landing page at /dashboard.
// Shows a high-level health summary for the active tenant:
//   • Overall health indicator (derived from open P0/P1 anomalies)
//   • Open anomaly count with P0/P1/P2 severity breakdown
//   • Pending review queue count
//   • Last report generated timestamp
//   • Quick links: View Report / Review Queue / Agent Console

import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  FileText,
  Terminal,
  XCircle,
  Clock,
  TrendingUp,
  Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDomain } from "@/hooks/use-domain";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Anomaly {
  id: string;
  severity: string;
  status: string;
  metric: string;
  detectedAt: string | null;
}

interface ReportDraft {
  id: string;
  status: string;
  createdAt: string | null;
  weekNumber: number | null;
  content?: {
    trafficSnapshot?: { sessions: number };
    anomaliesSection?: { count: number; p0Count: number; p1Count: number };
  } | null;
}

// ── Health computation ────────────────────────────────────────────────────────

function computeHealth(anomalies: Anomaly[]): {
  label: string;
  color: string;
  icon: typeof CheckCircle2;
  score: number;
} {
  const p0 = anomalies.filter((a) => a.severity === "P0").length;
  const p1 = anomalies.filter((a) => a.severity === "P1").length;

  if (p0 > 0) {
    return { label: "Critical", color: "text-red-400", icon: XCircle, score: 30 };
  }
  if (p1 > 1) {
    return { label: "Degraded", color: "text-orange-400", icon: AlertTriangle, score: 55 };
  }
  if (p1 === 1) {
    return { label: "Warning", color: "text-yellow-400", icon: AlertTriangle, score: 72 };
  }
  return { label: "Healthy", color: "text-emerald-400", icon: CheckCircle2, score: 95 };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  sub,
  icon: Icon,
  accent,
  loading,
}: {
  title: string;
  value: string | number;
  sub?: string;
  icon: typeof Activity;
  accent: string;
  loading?: boolean;
}) {
  return (
    <Card className="bg-card border-white/10">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">{title}</p>
            {loading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <p className="text-3xl font-bold text-foreground">{value}</p>
            )}
            {sub && !loading && (
              <p className="text-xs text-muted-foreground">{sub}</p>
            )}
          </div>
          <div className={cn("p-2 rounded-lg", accent)}>
            <Icon className="h-5 w-5 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function QuickLink({
  to,
  icon: Icon,
  label,
  description,
}: {
  to: string;
  icon: typeof FileText;
  label: string;
  description: string;
}) {
  return (
    <Link href={to}>
      <Card className="bg-card border-white/10 hover:border-white/25 cursor-pointer transition-colors group">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-white/5 group-hover:bg-white/10 transition-colors">
              <Icon className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{label}</p>
              <p className="text-xs text-muted-foreground truncate">{description}</p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WorkspaceHome() {
  const { ga4PropertyId, domain } = useDomain();

  const { data: anomalies = [], isLoading: anomaliesLoading } = useQuery<Anomaly[]>({
    queryKey: ["/api/agents/anomalies", "open", ga4PropertyId],
    queryFn: async () => {
      if (!ga4PropertyId) return [];
      const res = await fetch(
        `/api/agents/anomalies?status=open&tenantId=${encodeURIComponent(ga4PropertyId)}`
      );
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!ga4PropertyId,
    refetchInterval: 60_000,
  });

  const { data: reports = [], isLoading: reportsLoading } = useQuery<ReportDraft[]>({
    queryKey: ["/api/agents/reports", ga4PropertyId],
    queryFn: async () => {
      if (!ga4PropertyId) return [];
      const res = await fetch(
        `/api/agents/reports?tenantId=${encodeURIComponent(ga4PropertyId)}`
      );
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!ga4PropertyId,
    refetchInterval: 120_000,
  });

  const openAnomalies = anomalies.filter((a) => a.status === "open");
  const p0Count = openAnomalies.filter((a) => a.severity === "P0").length;
  const p1Count = openAnomalies.filter((a) => a.severity === "P1").length;
  const p2Count = openAnomalies.filter((a) => a.severity === "P2").length;

  const pendingCount = reports.filter(
    (r) => r.status === "pending_analyst" || r.status === "qa_review"
  ).length;

  const lastReport = reports[0] ?? null;
  const lastReportTime = lastReport?.createdAt
    ? new Date(lastReport.createdAt).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : null;

  const health = computeHealth(openAnomalies);
  const HealthIcon = health.icon;
  const isLoading = anomaliesLoading || reportsLoading;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Workspace</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {domain ? `Active property: ${domain}` : "Select a property to get started"}
        </p>
      </div>

      {/* Health Banner */}
      <Card
        className={cn(
          "border",
          health.label === "Healthy"
            ? "bg-emerald-950/30 border-emerald-800/40"
            : health.label === "Critical"
            ? "bg-red-950/30 border-red-800/40"
            : "bg-yellow-950/30 border-yellow-800/40"
        )}
      >
        <CardContent className="pt-5 pb-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {isLoading ? (
                <Skeleton className="h-8 w-8 rounded-full" />
              ) : (
                <HealthIcon className={cn("h-8 w-8", health.color)} />
              )}
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Overall Health
                </p>
                {isLoading ? (
                  <Skeleton className="h-6 w-24 mt-1" />
                ) : (
                  <p className={cn("text-xl font-bold", health.color)}>{health.label}</p>
                )}
              </div>
            </div>

            {!isLoading && (
              <div className="flex items-center gap-2">
                <div className="h-2 w-48 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      health.score >= 90
                        ? "bg-emerald-500"
                        : health.score >= 60
                        ? "bg-yellow-500"
                        : "bg-red-500"
                    )}
                    style={{ width: `${health.score}%` }}
                  />
                </div>
                <span className="text-sm font-medium text-foreground w-10 text-right">
                  {health.score}
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Open Anomalies"
          value={isLoading ? "—" : openAnomalies.length}
          sub={
            !isLoading && openAnomalies.length > 0
              ? `P0: ${p0Count}  P1: ${p1Count}  P2: ${p2Count}`
              : !isLoading
              ? "No open anomalies"
              : undefined
          }
          icon={AlertTriangle}
          accent="bg-orange-500/20"
          loading={isLoading}
        />
        <StatCard
          title="Pending Review"
          value={isLoading ? "—" : pendingCount}
          sub={!isLoading ? (pendingCount === 1 ? "report awaiting analyst" : "reports awaiting analyst") : undefined}
          icon={ClipboardList}
          accent="bg-blue-500/20"
          loading={isLoading}
        />
        <StatCard
          title="Last Report"
          value={isLoading ? "—" : lastReportTime ?? "None"}
          sub={
            !isLoading && lastReport
              ? `Week ${lastReport.weekNumber ?? "—"} · ${lastReport.status}`
              : !isLoading
              ? "No reports yet"
              : undefined
          }
          icon={Clock}
          accent="bg-purple-500/20"
          loading={isLoading}
        />
      </div>

      {/* Anomaly Severity Breakdown */}
      {!isLoading && openAnomalies.length > 0 && (
        <Card className="bg-card border-white/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Anomaly Severity Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {(
              [
                { label: "P0 — Critical", count: p0Count, color: "bg-red-500", text: "text-red-400" },
                { label: "P1 — High", count: p1Count, color: "bg-orange-500", text: "text-orange-400" },
                { label: "P2 — Medium", count: p2Count, color: "bg-yellow-500", text: "text-yellow-400" },
              ] as const
            ).map(({ label, count, color, text }) => (
              <div key={label} className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-28 shrink-0">{label}</span>
                <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className={cn("h-full rounded-full", color)}
                    style={{
                      width: openAnomalies.length > 0 ? `${(count / openAnomalies.length) * 100}%` : "0%",
                    }}
                  />
                </div>
                <Badge
                  variant="outline"
                  className={cn("text-xs border-white/10 w-7 justify-center", text)}
                >
                  {count}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Quick Links */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
          Quick Links
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <QuickLink
            to="/dashboard/report-preview"
            icon={FileText}
            label="View Report"
            description="Latest GA4 + GSC executive report"
          />
          <QuickLink
            to="/dashboard/review-queue"
            icon={ClipboardList}
            label="Review Queue"
            description={
              pendingCount > 0
                ? `${pendingCount} report${pendingCount > 1 ? "s" : ""} waiting for review`
                : "Review AI-generated report drafts"
            }
          />
          <QuickLink
            to="/dashboard/agent-console"
            icon={Terminal}
            label="Agent Console"
            description="Live runs, cost tracking, scheduler"
          />
        </div>
      </div>

      {/* Recent Activity */}
      {!isLoading && reports.length > 0 && (
        <Card className="bg-card border-white/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Recent Reports
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {reports.slice(0, 5).map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0"
              >
                <div className="flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-sm text-foreground">
                    Week {r.weekNumber ?? "—"} Report
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs border-white/10",
                      r.status === "approved"
                        ? "text-emerald-400"
                        : r.status === "pending_analyst"
                        ? "text-yellow-400"
                        : r.status === "qa_failed"
                        ? "text-red-400"
                        : "text-muted-foreground"
                    )}
                  >
                    {r.status.replace(/_/g, " ")}
                  </Badge>
                  {r.createdAt && (
                    <span className="text-xs text-muted-foreground">
                      {new Date(r.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!isLoading && !ga4PropertyId && (
        <Card className="bg-card border-white/10">
          <CardContent className="py-12 text-center">
            <Activity className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-foreground font-medium">No property selected</p>
            <p className="text-muted-foreground text-sm mt-1">
              Use the domain selector in the header to choose a GA4 property.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
