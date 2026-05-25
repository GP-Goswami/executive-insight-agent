// Agent Console — observability dashboard for all AI agent runs.
// Route: /dashboard/agent-console
//
// Sections:
//   1. Live Runs        — auto-refresh 10s
//   2. Run History      — expandable rows
//   3. Weekly Cost      — grouped by agent
//   4. Error Log        — failed runs + retry
//   5. Scheduler Status — next runs + manual trigger

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  DollarSign,
  Loader2,
  PlayCircle,
  RefreshCw,
  Terminal,
  XCircle,
  CalendarClock,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useDomain } from "@/hooks/use-domain";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AgentRun {
  id: string;
  tenantId: string;
  agentId: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  output: unknown;
  durationMs: number | null;
  estimatedCostUsd: number;
  model: string;
}

interface CostSummary {
  days: number;
  totalRuns: number;
  totalCostUsd: number;
  byAgent: Array<{
    agentId: string;
    model: string;
    runs: number;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
  }>;
}

interface SchedulerStatus {
  daily: { cron: string; description: string; nextRun: string | null; lastRun: string | null; lastStatus: string; tenantsProcessed: number; errors: string[] };
  weekly: { cron: string; description: string; nextRun: string | null; lastRun: string | null; lastStatus: string; tenantsProcessed: number; errors: string[] };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, { label: string; className: string; icon: React.ElementType }> = {
  running:   { label: "Running",   className: "border-transparent bg-blue-500/15 text-blue-400",  icon: Loader2 },
  completed: { label: "Completed", className: "border-transparent bg-green-500/15 text-green-400", icon: CheckCircle2 },
  failed:    { label: "Failed",    className: "border-transparent bg-red-500/15 text-red-400",    icon: XCircle },
  pending:   { label: "Pending",   className: "border-transparent bg-amber-500/15 text-amber-400", icon: Clock },
};

const AGENT_LABELS: Record<string, string> = {
  A08: "Anomaly Detection",
  A09: "Recommendation Synthesis",
  A10: "Report Composition",
  A11: "Quality Review",
  A12: "Client Communication",
};

function fmtDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

function fmtTokens(n: number | null): string {
  if (!n) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function fmtCost(usd: number): string {
  if (usd < 0.001) return "<$0.001";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function fmtRelative(iso: string | null): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Section 1: Live Runs ──────────────────────────────────────────────────────

function LiveRunsPanel({ tenantId }: { tenantId: string }) {
  const { data: runs = [], isFetching } = useQuery<AgentRun[]>({
    queryKey: ["/api/agents/runs/live", tenantId],
    queryFn: async () => {
      const res = await fetch(`/api/agents/runs?tenantId=${encodeURIComponent(tenantId)}&status=running`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 10_000,
  });

  return (
    <Card className="border-white/10 bg-card/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-blue-400" />
            Live Runs
          </CardTitle>
          <div className="flex items-center gap-2">
            {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            <span className="text-xs text-muted-foreground">auto-refresh 10s</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {runs.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-6">No agents running right now</p>
        ) : (
          <div className="space-y-2">
            {runs.map((run) => (
              <div key={run.id} className="flex items-center justify-between rounded-md border border-blue-500/20 bg-blue-500/5 px-3 py-2">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-400 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {run.agentId} — {AGENT_LABELS[run.agentId] ?? "Unknown Agent"}
                    </p>
                    <p className="text-xs text-muted-foreground">{run.model} · started {fmtRelative(run.startedAt)}</p>
                  </div>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <p>{fmtTokens(run.tokensIn)} in / {fmtTokens(run.tokensOut)} out</p>
                  <p>{fmtDuration(run.durationMs)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Section 2: Run History ────────────────────────────────────────────────────

function RunHistoryTable({ tenantId }: { tenantId: string }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data: runs = [], isLoading } = useQuery<AgentRun[]>({
    queryKey: ["/api/agents/runs/history", tenantId],
    queryFn: async () => {
      const res = await fetch(`/api/agents/runs?tenantId=${encodeURIComponent(tenantId)}&limit=50`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  function toggleRow(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <Card className="border-white/10 bg-card/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Terminal className="h-4 w-4 text-muted-foreground" />
          Run History
          <span className="ml-1 text-xs font-normal text-muted-foreground">(last 50)</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : runs.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No runs yet</p>
        ) : (
          <div className="divide-y divide-white/5">
            {/* Header */}
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-2 px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              <span>Agent</span>
              <span>Ran at</span>
              <span>Status</span>
              <span>Tokens</span>
              <span>Duration</span>
              <span>Cost</span>
            </div>
            {runs.map((run) => {
              const isOpen = expanded.has(run.id);
              const sm = STATUS_BADGE[run.status] ?? STATUS_BADGE.pending;
              const Icon = sm.icon;
              return (
                <div key={run.id}>
                  <button
                    type="button"
                    className="grid w-full grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-2 px-4 py-2.5 text-left text-sm hover:bg-white/5 transition-colors"
                    onClick={() => toggleRow(run.id)}
                  >
                    <span className="flex items-center gap-1.5 font-medium text-foreground">
                      {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                      {run.agentId}
                      <span className="truncate text-xs font-normal text-muted-foreground">{AGENT_LABELS[run.agentId] ?? ""}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">{fmtRelative(run.startedAt)}</span>
                    <span>
                      <Badge className={cn("text-xs gap-1", sm.className)}>
                        <Icon className={cn("h-3 w-3", run.status === "running" && "animate-spin")} />
                        {sm.label}
                      </Badge>
                    </span>
                    <span className="text-xs text-muted-foreground">{fmtTokens(run.tokensIn)}/{fmtTokens(run.tokensOut)}</span>
                    <span className="text-xs text-muted-foreground">{fmtDuration(run.durationMs)}</span>
                    <span className="text-xs text-muted-foreground">{fmtCost(run.estimatedCostUsd)}</span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-white/5 bg-muted/10 px-4 py-3">
                      <p className="mb-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Run ID: <span className="font-mono normal-case text-foreground/60">{run.id}</span>
                        {" · "}Model: <span className="normal-case text-foreground/60">{run.model}</span>
                        {run.startedAt && <> · Started: <span className="normal-case text-foreground/60">{fmtTime(run.startedAt)}</span></>}
                      </p>
                      {run.error && (
                        <p className="mb-2 rounded bg-red-500/10 px-2 py-1 text-xs text-red-400">{run.error}</p>
                      )}
                      {run.output ? (
                        <pre className="max-h-48 overflow-auto rounded bg-black/30 p-2 text-xs text-foreground/70 whitespace-pre-wrap">
                          {JSON.stringify(run.output, null, 2)}
                        </pre>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">No output recorded</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Section 3: Weekly Cost ────────────────────────────────────────────────────

function WeeklyCostPanel({ tenantId }: { tenantId: string }) {
  const { data, isLoading } = useQuery<CostSummary>({
    queryKey: ["/api/agents/runs/cost-summary", tenantId],
    queryFn: async () => {
      const res = await fetch(`/api/agents/runs/cost-summary?tenantId=${encodeURIComponent(tenantId)}&days=7`);
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  return (
    <Card className="border-white/10 bg-card/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <DollarSign className="h-4 w-4 text-green-400" />
            Weekly Cost Estimate
          </CardTitle>
          {data && (
            <div className="text-right">
              <p className="text-lg font-bold text-foreground">{fmtCost(data.totalCostUsd)}</p>
              <p className="text-xs text-muted-foreground">{data.totalRuns} run{data.totalRuns !== 1 ? "s" : ""} · 7 days</p>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : !data || data.byAgent.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No runs in the last 7 days</p>
        ) : (
          <div className="space-y-2">
            {data.byAgent.map((agent) => {
              const pct = data.totalCostUsd > 0 ? (agent.costUsd / data.totalCostUsd) * 100 : 0;
              return (
                <div key={agent.agentId} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-foreground">
                      {agent.agentId}
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">{AGENT_LABELS[agent.agentId] ?? ""}</span>
                    </span>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{agent.runs} run{agent.runs !== 1 ? "s" : ""}</span>
                      <span>{fmtTokens(agent.tokensIn + agent.tokensOut)} tokens</span>
                      <span className="font-medium text-foreground">{fmtCost(agent.costUsd)}</span>
                    </div>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted/30">
                    <div
                      className="h-1.5 rounded-full bg-green-500/60"
                      style={{ width: `${Math.max(pct, 1)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Section 4: Error Log ──────────────────────────────────────────────────────

function ErrorLogPanel({ tenantId }: { tenantId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [retrying, setRetrying] = useState<string | null>(null);

  const { data: failed = [], isLoading } = useQuery<AgentRun[]>({
    queryKey: ["/api/agents/runs/errors", tenantId],
    queryFn: async () => {
      const res = await fetch(`/api/agents/runs?tenantId=${encodeURIComponent(tenantId)}&status=failed&limit=20`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  async function handleRetry(run: AgentRun) {
    setRetrying(run.id);
    try {
      const jobMap: Record<string, string> = {
        A08: "daily",
        A09: "weekly",
        A10: "weekly",
        A11: "weekly",
        A12: "weekly",
      };
      const job = jobMap[run.agentId] ?? "daily";
      const res = await fetch("/api/agents/scheduler/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job, tenantId: run.tenantId }),
      });
      if (!res.ok) throw new Error("trigger failed");
      toast({ title: `${run.agentId} re-triggered`, description: `Job "${job}" queued for tenant.` });
      qc.invalidateQueries({ queryKey: ["/api/agents/runs/live", tenantId] });
      qc.invalidateQueries({ queryKey: ["/api/agents/runs/history", tenantId] });
    } catch (err) {
      toast({ title: "Retry failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setRetrying(null);
    }
  }

  return (
    <Card className="border-white/10 bg-card/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4 text-red-400" />
          Error Log
          {failed.length > 0 && (
            <Badge className="border-transparent bg-red-500/15 text-red-400 ml-1">{failed.length}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : failed.length === 0 ? (
          <div className="flex items-center gap-2 rounded-md border border-green-500/20 bg-green-500/5 px-3 py-3">
            <CheckCircle2 className="h-4 w-4 text-green-400" />
            <p className="text-sm text-green-400">No failed runs — all clear</p>
          </div>
        ) : (
          <div className="space-y-2">
            {failed.map((run) => (
              <div key={run.id} className="rounded-md border border-red-500/20 bg-red-500/5 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {run.agentId} — {AGENT_LABELS[run.agentId] ?? "Unknown"}
                      </span>
                      <span className="text-xs text-muted-foreground">{fmtRelative(run.startedAt)}</span>
                    </div>
                    {run.error && (
                      <p className="mt-1 text-xs text-red-300 leading-relaxed break-words">{run.error}</p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    disabled={retrying === run.id}
                    onClick={() => handleRetry(run)}
                  >
                    {retrying === run.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    Retry
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Section 5: Scheduler Status ───────────────────────────────────────────────

function SchedulerPanel({ tenantId }: { tenantId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [triggering, setTriggering] = useState<"daily" | "weekly" | null>(null);

  const { data: status, isLoading } = useQuery<SchedulerStatus>({
    queryKey: ["/api/agents/scheduler/status"],
    queryFn: async () => {
      const res = await fetch("/api/agents/scheduler/status");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  async function trigger(job: "daily" | "weekly") {
    setTriggering(job);
    try {
      const res = await fetch("/api/agents/scheduler/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job, tenantId }),
      });
      if (!res.ok) throw new Error("trigger failed");
      toast({ title: `${job === "daily" ? "Daily" : "Weekly"} job triggered`, description: "Running in background — check Live Runs." });
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["/api/agents/runs/live", tenantId] });
        qc.invalidateQueries({ queryKey: ["/api/agents/runs/history", tenantId] });
      }, 2000);
    } catch (err) {
      toast({ title: "Trigger failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setTriggering(null);
    }
  }

  const STATUS_COLOR: Record<string, string> = {
    success: "text-green-400",
    partial: "text-amber-400",
    failed: "text-red-400",
    never: "text-muted-foreground",
  };

  return (
    <Card className="border-white/10 bg-card/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4 text-primary" />
          Scheduler Status
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : !status ? (
          <p className="text-center text-sm text-muted-foreground">Unable to load scheduler status</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {(["daily", "weekly"] as const).map((job) => {
              const s = status[job];
              return (
                <div key={job} className="rounded-md border border-white/5 bg-muted/20 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground capitalize">{job} Job</p>
                      <p className="text-xs text-muted-foreground">{s.cron}</p>
                    </div>
                    <Badge className={cn("border-transparent bg-muted/50 text-xs capitalize", STATUS_COLOR[s.lastStatus])}>
                      {s.lastStatus}
                    </Badge>
                  </div>
                  <div className="space-y-0.5 text-xs text-muted-foreground">
                    <p>Next: <span className="text-foreground">{s.nextRun ? fmtTime(s.nextRun) : "—"}</span></p>
                    <p>Last: <span className="text-foreground">{s.lastRun ? fmtRelative(s.lastRun) : "never"}</span></p>
                    {s.tenantsProcessed > 0 && <p>Processed: <span className="text-foreground">{s.tenantsProcessed} tenant(s)</span></p>}
                  </div>
                  {s.errors.length > 0 && (
                    <ul className="space-y-0.5 text-xs text-red-400">
                      {s.errors.slice(0, 3).map((e, i) => <li key={i} className="truncate">• {e}</li>)}
                      {s.errors.length > 3 && <li className="text-muted-foreground">+{s.errors.length - 3} more</li>}
                    </ul>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    disabled={!!triggering}
                    onClick={() => trigger(job)}
                  >
                    {triggering === job ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
                    Run Now
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AgentConsolePage() {
  const { ga4PropertyId } = useDomain();
  const qc = useQueryClient();

  function refreshAll() {
    qc.invalidateQueries({ queryKey: ["/api/agents/runs"] });
    qc.invalidateQueries({ queryKey: ["/api/agents/scheduler/status"] });
  }

  if (!ga4PropertyId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Select a GA4 property to view agent runs.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Agent Console</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Observability for all AI agents — runs, costs, errors, scheduler
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={refreshAll}>
            <RefreshCw className="h-4 w-4" />
            Refresh All
          </Button>
        </div>

        {/* 1. Live Runs */}
        <LiveRunsPanel tenantId={ga4PropertyId} />

        {/* 2. Run History */}
        <RunHistoryTable tenantId={ga4PropertyId} />

        {/* 3 + 5. Cost + Scheduler side-by-side on wider screens */}
        <div className="grid gap-4 lg:grid-cols-2">
          <WeeklyCostPanel tenantId={ga4PropertyId} />
          <SchedulerPanel tenantId={ga4PropertyId} />
        </div>

        {/* 4. Error Log */}
        <ErrorLogPanel tenantId={ga4PropertyId} />
      </div>
    </div>
  );
}
