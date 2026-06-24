// Workspace Home — default landing page at /dashboard.
// Sections:
//   1. Overall Health Banner  — Site Health + Data Health scores
//   2. Active Alerts row      — P0 / P1 anomaly counts → scrolls to anomaly list
//   3. Agent Status row       — last run per A08/A09/A10/A02-A04
//   4. Quick Actions          — 4 buttons incl. Generate Report (A10 trigger)
//   5. Recent Activity feed   — last 5 runs + last approval + last anomaly

import { useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { subDays, format } from "date-fns";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock,
  FileText,
  Loader2,
  PlayCircle,
  Terminal,
  TrendingUp,
  XCircle,
  Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDomain } from "@/hooks/use-domain";
import { useToast } from "@/hooks/use-toast";
import { computeDataHealthScore, type DataHealthInput } from "@/lib/compute-data-health";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface QuickMetrics {
  metrics: {
    search: { ctr: number; impressions: number; avgPosition: number; clicks: number };
    traffic: { users: number; sessions: number; growthRate: number };
    backlinks: { current: number; referringDomains: number; delta: number; referringDomainsDelta: number };
  };
  semrush?: { organicTraffic: number | null; keywords?: number | null; backlinks?: number | null } | null;
  dataforseo?: { keywords: number | null; backlinks?: number | null } | null;
  reportBacklinks?: { total: number | null } | null;
  previousPeriod?: {
    ga4?: { sessions: number | null } | null;
    gsc?: { clicks: number | null } | null;
  } | null;
}

interface AgentRun {
  id: string;
  agentId: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  output?: { findings?: Record<string, unknown> } | null;
  error?: string | null;
}

interface Anomaly {
  id: string;
  severity: string;
  status: string;
  metric: string;
  detectedAt: string | null;
  rootCause?: string | null;
}

interface ReportDraft {
  id: string;
  status: string;
  weekNumber: number | null;
  createdAt: string | null;
  approvedAt: string | null;
}

// ── Health score computation (mirrors report-preview.tsx without touching it) ──

function computeSiteHealthScore(
  m: QuickMetrics["metrics"],
  hasSearch: boolean,
  hasTraffic: boolean,
  hasBacklinks: boolean,
  dataHealthScore: number,
): number {
  let total = 0;
  let count = 0;

  if (hasSearch) {
    const ctrScore = m.search.ctr >= 5 ? 100 : m.search.ctr >= 3 ? 75 : m.search.ctr >= 1 ? 50 : 25;
    const posBonus = m.search.avgPosition <= 10 ? 25 : m.search.avgPosition <= 20 ? 15 : m.search.avgPosition <= 30 ? 5 : 0;
    total += Math.min(100, ctrScore + posBonus);
    count++;
  }

  // Data Integrity pillar
  total += dataHealthScore;
  count++;

  if (hasTraffic) {
    const g = m.traffic.growthRate;
    total += Math.min(100, (g >= 20 ? 75 : g >= 0 ? 60 : g >= -20 ? 40 : 15) + 20);
    count++;
  }

  if (hasBacklinks) {
    const bd = m.backlinks.delta;
    const rdd = m.backlinks.referringDomainsDelta;
    total += Math.min(100, (bd > 50 ? 60 : bd > 0 ? 45 : bd > -20 ? 30 : 10) + (rdd > 0 ? 40 : rdd === 0 ? 25 : 10));
    count++;
  }

  return count > 0 ? Math.round(total / count) : 0;
}

function scoreColor(score: number): { bar: string; text: string; bg: string; border: string } {
  if (score > 75) return { bar: "bg-emerald-500", text: "text-emerald-400", bg: "bg-emerald-950/30", border: "border-emerald-800/40" };
  if (score >= 50) return { bar: "bg-amber-500", text: "text-amber-400", bg: "bg-amber-950/30", border: "border-amber-800/40" };
  return { bar: "bg-red-500", text: "text-red-400", bg: "bg-red-950/30", border: "border-red-800/40" };
}

function scoreLabel(score: number): string {
  if (score > 75) return "Good";
  if (score >= 50) return "Fair";
  return "Poor";
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const AGENT_LABELS: Record<string, string> = {
  A08: "Anomaly Detection",
  A09: "Recommendation Synthesis",
  A10: "Report Composition",
  A11: "Quality Review",
  A12: "Client Comms",
  A02: "Keyword Intelligence",
  A04: "Content Performance",
};

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function lastRunOf(runs: AgentRun[], ...ids: string[]): AgentRun | undefined {
  return runs.find((r) => ids.includes(r.agentId));
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function HealthTile({
  label,
  score,
  loading,
}: {
  label: string;
  score: number;
  loading: boolean;
}) {
  const c = scoreColor(score);
  return (
    <div className={cn("flex-1 rounded-xl border p-4", c.bg, c.border)}>
      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">{label}</p>
      {loading ? (
        <Skeleton className="h-8 w-16 mb-2" />
      ) : (
        <>
          <p className={cn("text-3xl font-bold", c.text)}>{score}</p>
          <p className={cn("text-xs font-medium mt-0.5", c.text)}>{scoreLabel(score)}</p>
          <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div className={cn("h-full rounded-full transition-all", c.bar)} style={{ width: `${score}%` }} />
          </div>
        </>
      )}
    </div>
  );
}

function AgentStatusCard({
  label,
  run,
  loading,
  detail,
}: {
  label: string;
  run?: AgentRun;
  loading: boolean;
  detail?: string;
}) {
  const isRunning = run?.status === "running";
  const isSuccess = run?.status === "completed";
  const isError = run?.status === "failed";

  return (
    <Card className="bg-card border-white/10">
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground uppercase tracking-wide truncate">{label}</p>
            {loading ? (
              <Skeleton className="h-4 w-20 mt-1.5" />
            ) : run ? (
              <>
                <p className="text-sm font-medium text-foreground mt-0.5">
                  {relativeTime(run.completedAt ?? run.startedAt)}
                </p>
                {detail && <p className="text-xs text-muted-foreground truncate">{detail}</p>}
              </>
            ) : (
              <p className="text-sm text-muted-foreground mt-0.5">Never run</p>
            )}
          </div>
          <div className="shrink-0 mt-0.5">
            {loading ? (
              <Skeleton className="h-4 w-4 rounded-full" />
            ) : isRunning ? (
              <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />
            ) : isSuccess ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            ) : isError ? (
              <XCircle className="h-4 w-4 text-red-400" />
            ) : (
              <Clock className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WorkspaceHome() {
  const { ga4PropertyId, domain, gscSiteUrl } = useDomain();
  const { toast } = useToast();
  const qc = useQueryClient();
  const anomalySectionRef = useRef<HTMLDivElement>(null);

  const end = subDays(new Date(), 1);
  const start = subDays(end, 30);
  const startStr = format(start, "yyyy-MM-dd");
  const endStr = format(end, "yyyy-MM-dd");

  // ── Report data (health scores) ─────────────────────────────────────────────
  const { data: reportData, isLoading: reportLoading } = useQuery<QuickMetrics>({
    queryKey: ["/api/report-data", ga4PropertyId, domain, startStr, endStr],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (ga4PropertyId) p.set("propertyId", ga4PropertyId);
      if (domain) p.set("domain", domain);
      if (gscSiteUrl) p.set("gscSiteUrl", gscSiteUrl);
      p.set("start", startStr);
      p.set("end", endStr);
      const res = await fetch(`/api/report-data?${p}`, { credentials: "include" });
      if (!res.ok) return null as unknown as QuickMetrics;
      return res.json();
    },
    enabled: !!ga4PropertyId,
    staleTime: 5 * 60_000,
  });

  // ── Agent runs ──────────────────────────────────────────────────────────────
  const { data: runs = [], isLoading: runsLoading } = useQuery<AgentRun[]>({
    queryKey: ["/api/agents/runs", ga4PropertyId],
    queryFn: async () => {
      if (!ga4PropertyId) return [];
      const res = await fetch(`/api/agents/runs?tenantId=${encodeURIComponent(ga4PropertyId)}&limit=30`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!ga4PropertyId,
    refetchInterval: 30_000,
  });

  // ── Anomalies ───────────────────────────────────────────────────────────────
  const { data: anomalies = [], isLoading: anomaliesLoading } = useQuery<Anomaly[]>({
    queryKey: ["/api/agents/anomalies", ga4PropertyId],
    queryFn: async () => {
      if (!ga4PropertyId) return [];
      const res = await fetch(`/api/agents/anomalies?tenantId=${encodeURIComponent(ga4PropertyId)}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!ga4PropertyId,
    refetchInterval: 60_000,
  });

  // ── Report drafts ───────────────────────────────────────────────────────────
  const { data: reports = [], isLoading: reportsLoading } = useQuery<ReportDraft[]>({
    queryKey: ["/api/agents/reports", ga4PropertyId],
    queryFn: async () => {
      if (!ga4PropertyId) return [];
      const res = await fetch(`/api/agents/reports?tenantId=${encodeURIComponent(ga4PropertyId)}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!ga4PropertyId,
    refetchInterval: 60_000,
  });

  // ── Generate Report mutation ─────────────────────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const handleGenerateReport = async () => {
    if (!ga4PropertyId || generating) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/agents/report/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: ga4PropertyId }),
      });
      if (!res.ok) throw new Error("Request failed");
      toast({ title: "Report composition started", description: "A10 agent is running. Check Review Queue shortly." });
      qc.invalidateQueries({ queryKey: ["/api/agents/runs", ga4PropertyId] });
      qc.invalidateQueries({ queryKey: ["/api/agents/reports", ga4PropertyId] });
    } catch {
      toast({ title: "Failed to start report", variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  // ── Derived data ─────────────────────────────────────────────────────────────
  const m = reportData?.metrics;
  const hasSearch = (m?.search.impressions ?? 0) > 0;
  const hasTraffic = (m?.traffic.users ?? 0) > 0 || (m?.traffic.sessions ?? 0) > 0;
  const hasBacklinks = (m?.backlinks.current ?? 0) > 0;

  const healthInput: DataHealthInput | null = m
    ? {
        semrush: reportData?.semrush?.organicTraffic != null
          ? { organicTraffic: reportData.semrush.organicTraffic, keywords: reportData.semrush.keywords ?? null, backlinks: reportData.semrush.backlinks ?? null }
          : null,
        ga4: hasTraffic ? { sessions: m.traffic.sessions, users: m.traffic.users } : null,
        gsc: hasSearch ? { clicks: m.search.clicks, impressions: m.search.impressions, ctr: m.search.ctr, avgPosition: m.search.avgPosition } : null,
        dataforseo: reportData?.dataforseo?.keywords != null
          ? { keywords: reportData.dataforseo.keywords, backlinks: reportData.dataforseo.backlinks ?? null }
          : null,
        backlinks: hasBacklinks ? { total: m.backlinks.current } : (reportData?.reportBacklinks?.total != null ? { total: reportData.reportBacklinks.total } : null),
        previousPeriod: reportData?.previousPeriod != null
          ? { ga4Sessions: reportData.previousPeriod.ga4?.sessions ?? null, gscClicks: reportData.previousPeriod.gsc?.clicks ?? null }
          : null,
      }
    : null;

  const dataHealthScore = healthInput ? computeDataHealthScore(healthInput).score : 0;
  const siteHealthScore = m ? computeSiteHealthScore(m, hasSearch, hasTraffic, hasBacklinks, dataHealthScore) : 0;
  const healthLoading = reportLoading;

  const openAnomalies = anomalies.filter((a) => a.status === "open");
  const p0Count = openAnomalies.filter((a) => a.severity === "P0").length;
  const p1Count = openAnomalies.filter((a) => a.severity === "P1").length;
  const latestAnomaly = openAnomalies[0] ?? anomalies[0] ?? null;

  const pendingCount = reports.filter((r) => r.status === "pending_analyst" || r.status === "qa_review").length;
  const lastApproved = reports.find((r) => r.status === "approved") ?? null;

  const runA08 = lastRunOf(runs, "A08");
  const runA09 = lastRunOf(runs, "A09");
  const runA10 = lastRunOf(runs, "A10");
  const runA02A04 = lastRunOf(runs, "A02", "A04");

  const a08Detail = (() => {
    const f = runA08?.output?.findings as Record<string, unknown> | undefined;
    const n = f?.anomaliesFound ?? f?.anomalies;
    return typeof n === "number" ? `${n} anomalies found` : undefined;
  })();

  const a09Detail = (() => {
    const f = runA09?.output?.findings as Record<string, unknown> | undefined;
    const recs = f?.recommendations;
    return Array.isArray(recs) ? `${recs.length} recommendations` : typeof f?.count === "number" ? `${f.count} recommendations` : undefined;
  })();

  const a10Detail = (() => {
    const f = runA10?.output?.findings as Record<string, unknown> | undefined;
    if (!f) return undefined;
    const wk = f.weekNumber;
    return typeof wk === "number" ? `Week ${wk} draft` : undefined;
  })();

  // Recent activity — merge runs, approvals, anomalies into a time-sorted list
  type FeedItem = { key: string; icon: typeof Activity; label: string; time: string | null; color: string };
  const feed: FeedItem[] = [];

  runs.slice(0, 5).forEach((r) => {
    feed.push({
      key: r.id,
      icon: Bot,
      label: `${AGENT_LABELS[r.agentId] ?? r.agentId} — ${r.status}`,
      time: r.completedAt ?? r.startedAt,
      color: r.status === "completed" ? "text-emerald-400" : r.status === "failed" ? "text-red-400" : "text-blue-400",
    });
  });

  if (lastApproved) {
    feed.push({
      key: `approved-${lastApproved.id}`,
      icon: CheckCircle2,
      label: `Week ${lastApproved.weekNumber ?? "—"} report approved`,
      time: lastApproved.approvedAt,
      color: "text-emerald-400",
    });
  }

  if (latestAnomaly) {
    feed.push({
      key: `anomaly-${latestAnomaly.id}`,
      icon: AlertTriangle,
      label: `Anomaly detected: ${latestAnomaly.metric} (${latestAnomaly.severity})`,
      time: latestAnomaly.detectedAt,
      color: latestAnomaly.severity === "P0" ? "text-red-400" : latestAnomaly.severity === "P1" ? "text-amber-400" : "text-yellow-400",
    });
  }

  feed.sort((a, b) => {
    if (!a.time && !b.time) return 0;
    if (!a.time) return 1;
    if (!b.time) return -1;
    return new Date(b.time).getTime() - new Date(a.time).getTime();
  });

  const isLoading = anomaliesLoading || runsLoading || reportsLoading;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-5xl">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Home</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {domain ? `${domain} · last 30 days` : "Select a property to get started"}
        </p>
      </div>

      {/* ── Section 1: Health Banner ── */}
      <div>
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
          Overall Health
        </h2>
        <div className="flex flex-col sm:flex-row gap-3">
          <HealthTile label="Site Health Score" score={siteHealthScore} loading={healthLoading} />
          <HealthTile label="Data Health Score" score={dataHealthScore} loading={healthLoading} />
        </div>
        {!healthLoading && !m && ga4PropertyId && (
          <p className="text-xs text-muted-foreground mt-2">
            Health scores load once report data is available — visit Report Preview to trigger a sync.
          </p>
        )}
      </div>

      {/* ── Section 2: Active Alerts ── */}
      {(p0Count > 0 || p1Count > 0) && (
        <div>
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
            Active Alerts
          </h2>
          <button
            type="button"
            onClick={() => anomalySectionRef.current?.scrollIntoView({ behavior: "smooth" })}
            className="flex items-center gap-3 w-full text-left"
          >
            <Card className="w-full bg-card border-white/10 hover:border-white/20 transition-colors cursor-pointer">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-4">
                  <Zap className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex items-center gap-3 flex-1">
                    {p0Count > 0 && (
                      <div className="flex items-center gap-1.5">
                        <Badge className="bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30">
                          P0 × {p0Count}
                        </Badge>
                        <span className="text-xs text-muted-foreground">critical</span>
                      </div>
                    )}
                    {p1Count > 0 && (
                      <div className="flex items-center gap-1.5">
                        <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 hover:bg-amber-500/30">
                          P1 × {p1Count}
                        </Badge>
                        <span className="text-xs text-muted-foreground">high</span>
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">Click to view ↓</span>
                </div>
              </CardContent>
            </Card>
          </button>
        </div>
      )}

      {/* ── Section 3: Agent Status ── */}
      <div>
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
          Agent Status
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <AgentStatusCard label="A08 Anomaly" run={runA08} loading={runsLoading} detail={a08Detail} />
          <AgentStatusCard label="A09 Synthesis" run={runA09} loading={runsLoading} detail={a09Detail} />
          <AgentStatusCard label="A10 Composer" run={runA10} loading={runsLoading} detail={a10Detail} />
          <AgentStatusCard
            label="A02 / A04"
            run={runA02A04}
            loading={runsLoading}
            detail={runA02A04 ? AGENT_LABELS[runA02A04.agentId] : undefined}
          />
        </div>
      </div>

      {/* ── Section 4: Quick Actions ── */}
      <div>
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
          Quick Actions
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Link href="/dashboard/report-preview">
            <Card className="bg-card border-white/10 hover:border-white/25 cursor-pointer transition-colors group h-full">
              <CardContent className="pt-4 pb-4 flex flex-col items-center text-center gap-2">
                <div className="p-2 rounded-lg bg-blue-500/10 group-hover:bg-blue-500/20 transition-colors">
                  <FileText className="h-5 w-5 text-blue-400" />
                </div>
                <p className="text-sm font-medium text-foreground leading-tight">View Full Report</p>
              </CardContent>
            </Card>
          </Link>

          <Link href="/dashboard/review-queue">
            <Card className="bg-card border-white/10 hover:border-white/25 cursor-pointer transition-colors group h-full">
              <CardContent className="pt-4 pb-4 flex flex-col items-center text-center gap-2">
                <div className="p-2 rounded-lg bg-purple-500/10 group-hover:bg-purple-500/20 transition-colors">
                  <ClipboardList className="h-5 w-5 text-purple-400" />
                </div>
                <p className="text-sm font-medium text-foreground leading-tight">
                  Review Queue
                  {pendingCount > 0 && (
                    <Badge className="ml-1.5 bg-purple-500/20 text-purple-300 border-purple-500/30 text-xs">
                      {pendingCount}
                    </Badge>
                  )}
                </p>
              </CardContent>
            </Card>
          </Link>

          <Link href="/dashboard/agent-console">
            <Card className="bg-card border-white/10 hover:border-white/25 cursor-pointer transition-colors group h-full">
              <CardContent className="pt-4 pb-4 flex flex-col items-center text-center gap-2">
                <div className="p-2 rounded-lg bg-cyan-500/10 group-hover:bg-cyan-500/20 transition-colors">
                  <Terminal className="h-5 w-5 text-cyan-400" />
                </div>
                <p className="text-sm font-medium text-foreground leading-tight">Agent Console</p>
              </CardContent>
            </Card>
          </Link>

          <Card
            className={cn(
              "bg-card border-white/10 transition-colors h-full",
              ga4PropertyId && !generating ? "hover:border-white/25 cursor-pointer" : "opacity-60 cursor-not-allowed",
            )}
            onClick={handleGenerateReport}
          >
            <CardContent className="pt-4 pb-4 flex flex-col items-center text-center gap-2">
              <div className="p-2 rounded-lg bg-emerald-500/10 group-hover:bg-emerald-500/20 transition-colors">
                {generating ? (
                  <Loader2 className="h-5 w-5 text-emerald-400 animate-spin" />
                ) : (
                  <PlayCircle className="h-5 w-5 text-emerald-400" />
                )}
              </div>
              <p className="text-sm font-medium text-foreground leading-tight">
                {generating ? "Starting…" : "Generate Report"}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Section 5: Recent Activity ── */}
      <div>
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
          Recent Activity
        </h2>
        <Card className="bg-card border-white/10">
          <CardContent className="pt-2 pb-2">
            {isLoading ? (
              <div className="space-y-3 py-2">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
              </div>
            ) : feed.length === 0 ? (
              <div className="py-8 text-center">
                <Activity className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No agent activity yet</p>
              </div>
            ) : (
              feed.slice(0, 7).map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.key}
                    className="flex items-center gap-3 py-2.5 border-b border-white/5 last:border-0"
                  >
                    <Icon className={cn("h-3.5 w-3.5 shrink-0", item.color)} />
                    <span className="text-sm text-foreground flex-1 truncate">{item.label}</span>
                    <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                      {relativeTime(item.time)}
                    </span>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Anomaly section anchor (Section 2 scrolls here) ── */}
      <div ref={anomalySectionRef}>
        {openAnomalies.length > 0 && (
          <div>
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5" />
              Open Anomalies ({openAnomalies.length})
            </h2>
            <Card className="bg-card border-white/10">
              <CardContent className="pt-2 pb-2">
                {openAnomalies.slice(0, 10).map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between gap-3 py-2.5 border-b border-white/5 last:border-0"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs border-white/10 shrink-0",
                          a.severity === "P0" ? "text-red-400" : a.severity === "P1" ? "text-amber-400" : "text-yellow-400",
                        )}
                      >
                        {a.severity}
                      </Badge>
                      <span className="text-sm text-foreground truncate">{a.metric}</span>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                      {relativeTime(a.detectedAt)}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <div className="mt-2 flex justify-end">
              <Link href="/dashboard/review-queue">
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground gap-1">
                  View all in Review Queue <ChevronRight className="h-3 w-3" />
                </Button>
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* Empty state */}
      {!isLoading && !ga4PropertyId && (
        <Card className="bg-card border-white/10">
          <CardContent className="py-12 text-center">
            <TrendingUp className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
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
