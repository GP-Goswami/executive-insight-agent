// Reusable agent detail page — one component drives all 12 agents (A01–A12).
// Route: /dashboard/agents/:agentId (a01 … a12)
//
// Shared header (badge, model, trigger, status, last run, actions) is identical
// for every agent. The body switches on agentId and reuses EXISTING section
// components + EXISTING API endpoints — no data is duplicated or recomputed.

import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  FileText,
  Info,
  Layers,
  FileSearch,
  Link2,
  Loader2,
  Mail,
  MousePointerClick,
  PlayCircle,
  Search,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  Terminal,
  TrendingDown,
  TrendingUp,
  XCircle,
  Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDomain } from "@/hooks/use-domain";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { AGENT_CONFIG, type AgentId } from "./index";

// Existing section components (reused, never modified)
import { AnomalySection } from "@/components/agents/AnomalySection";
import { RecommendationList } from "@/components/agents/RecommendationList";
import { EmailDraftCard, type EmailDraft } from "@/components/agents/EmailDraftCard";

// ── Shared types ────────────────────────────────────────────────────────────

interface AgentRun {
  id: string;
  agentId: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  durationMs: number | null;
  estimatedCostUsd: number | null;
  error: string | null;
  output: Record<string, unknown> | null;
}

// ── Format helpers ──────────────────────────────────────────────────────────

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
  });
}
function fmtMs(ms: number | null): string {
  if (ms == null || ms < 0) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
function fmtTokens(n: number | null): string {
  if (n == null) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

// ── Small shared UI ─────────────────────────────────────────────────────────

function Tile({ label, value, accent, tooltip }: { label: string; value: string | number; accent?: string; tooltip?: string }) {
  return (
    <Card className="bg-card border-white/10">
      <CardContent className="pt-3 pb-3">
        <div className="flex items-center gap-1 mb-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
          {tooltip && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-help"><Info className="h-3 w-3 text-muted-foreground" /></span>
              </TooltipTrigger>
              <TooltipContent className="max-w-[240px] text-xs">{tooltip}</TooltipContent>
            </Tooltip>
          )}
        </div>
        <p className={cn("text-2xl font-bold text-foreground", accent)}>{value}</p>
      </CardContent>
    </Card>
  );
}

function SectionTitle({ icon: Icon, children, note }: { icon: typeof Bot; children: React.ReactNode; note?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <h2 className="text-sm font-semibold text-foreground">{children}</h2>
      {note && <Badge variant="outline" className="text-[10px] border-white/10 text-muted-foreground">{note}</Badge>}
    </div>
  );
}

function EmptyState({ message, action }: { message: string; action?: React.ReactNode }) {
  return (
    <Card className="bg-card border-white/10">
      <CardContent className="py-10 text-center space-y-3">
        <Zap className="h-9 w-9 text-muted-foreground mx-auto" />
        <p className="text-sm text-muted-foreground">{message}</p>
        {action}
      </CardContent>
    </Card>
  );
}

function StatusPill({ run, isComingSoon }: { run?: AgentRun; isComingSoon: boolean }) {
  if (isComingSoon) return (
    <Badge variant="outline" className="text-xs border-gray-500/40 text-gray-400 gap-1">
      <div className="h-1.5 w-1.5 rounded-full bg-gray-500" /> Not Active
    </Badge>
  );
  if (!run) return (
    <Badge variant="outline" className="text-xs border-amber-500/40 text-amber-400 gap-1">
      <div className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Never Run
    </Badge>
  );
  if (run.status === "running") return (
    <Badge variant="outline" className="text-xs border-blue-500/40 text-blue-400 gap-1">
      <Loader2 className="h-3 w-3 animate-spin" /> Running
    </Badge>
  );
  if (run.status === "completed") return (
    <Badge variant="outline" className="text-xs border-emerald-500/40 text-emerald-400 gap-1">
      <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Last run OK
    </Badge>
  );
  return (
    <Badge variant="outline" className="text-xs border-red-500/40 text-red-400 gap-1">
      <div className="h-1.5 w-1.5 rounded-full bg-red-500" /> {run.status === "cancelled" ? "Cancelled" : "Failed"}
    </Badge>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Agent-specific bodies — each fetches from its OWN existing endpoint.
// Each is independent: one failing query never breaks the others.
// ════════════════════════════════════════════════════════════════════════════

// ── A07 — AEO / GEO Visibility ──────────────────────────────────────────────

interface AeoResults {
  aggregates: { citationShare: number; avgPosition: number; totalRuns: number; mentionsFound: number };
  byEngine: Record<string, { citationShare: number; mentionsFound: number }>;
  recentResults: Array<{ id: string; query: string; engine: string; cited: number; position: number | null; excerpt: string | null; brandEntity?: string }>;
}

// Paragraph position is 0-indexed (0 = first paragraph = best). Display 1-indexed.
function fmtAeoPosition(avgPos: number, mentions: number): string {
  if (mentions === 0) return "—";
  if (avgPos <= 0) return "Top of response";
  return `~${Math.round(avgPos + 1)}`;
}

const AEO_POS_TOOLTIP =
  "Average paragraph position when cited. Lower = better. Position 1 = cited in the first paragraph of the response.";

function AeoBody({ tenantId }: { tenantId: string }) {
  const { data, isLoading } = useQuery<AeoResults>({
    queryKey: ["/api/agents/aeo/results", tenantId],
    queryFn: async () => {
      const res = await fetch(`/api/agents/aeo/results?tenantId=${encodeURIComponent(tenantId)}`);
      if (!res.ok) throw new Error("Failed to load AEO results");
      const json = await res.json();
      console.log("[A07] /api/agents/aeo/results →", json);
      return json;
    },
    enabled: !!tenantId,
    refetchInterval: 30_000,
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (!data || data.aggregates.totalRuns === 0) {
    return (
      <EmptyState
        message="No AEO data yet. Configure queries and run a scan from the AI Mentions page."
        action={<Link href="/dashboard/ai-mentions"><Button size="sm" variant="outline" className="gap-1"><ExternalLink className="h-3.5 w-3.5" /> Open AI Mentions</Button></Link>}
      />
    );
  }

  // Group recent rows by query for the per-engine table
  const byQuery = new Map<string, { query: string; chatgpt?: typeof data.recentResults[0]; claude?: typeof data.recentResults[0] }>();
  for (const r of data.recentResults) {
    if (!byQuery.has(r.query)) byQuery.set(r.query, { query: r.query });
    const row = byQuery.get(r.query)!;
    if (r.engine === "chatgpt") row.chatgpt = r;
    else if (r.engine === "claude") row.claude = r;
  }
  const rows = Array.from(byQuery.values());

  const Cell = ({ r }: { r?: typeof data.recentResults[0] }) => {
    if (!r) return <span className="text-muted-foreground text-xs">—</span>;
    return r.cited === 1
      ? <div className="flex items-center justify-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />{r.position != null && <span className="text-xs text-muted-foreground">p{r.position}</span>}</div>
      : <XCircle className="h-3.5 w-3.5 text-muted-foreground mx-auto" />;
  };

  return (
    <div className="space-y-5">
      {/* Section 1 — Coverage tiles */}
      <div>
        <SectionTitle icon={Zap}>Coverage Metrics</SectionTitle>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Tile label="Coverage"     value={`${data.aggregates.citationShare}%`} accent="text-purple-400" />
          <Tile label="Avg Position" value={fmtAeoPosition(data.aggregates.avgPosition, data.aggregates.mentionsFound)} tooltip={AEO_POS_TOOLTIP} />
          <Tile label="Total Runs"   value={data.aggregates.totalRuns} />
          <Tile label="Mentions"     value={data.aggregates.mentionsFound} accent="text-emerald-400" />
        </div>
      </div>

      {/* Insight banner — auto-generated from coverage */}
      {(() => {
        const coverage = data.aggregates.citationShare;
        const brand = data.recentResults?.[0]?.brandEntity || "the brand";
        let cls: string, msg: string;
        if (coverage > 50) {
          cls = "bg-emerald-950/30 border-emerald-800/40 text-emerald-300";
          msg = `Strong AI visibility — ${brand} is cited in the majority of tracked queries.`;
        } else if (coverage >= 20) {
          cls = "bg-amber-950/30 border-amber-800/40 text-amber-300";
          msg = `Moderate AI visibility — ${coverage}% of queries cite ${brand}. Category queries need content improvement.`;
        } else {
          cls = "bg-red-950/30 border-red-800/40 text-red-300";
          msg = `Low AI visibility — ${brand} is rarely cited. Focus on brand content and authority building.`;
        }
        return (
          <div className={cn("rounded-lg border px-4 py-3 text-sm flex items-start gap-2", cls)}>
            <Sparkles className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{msg}</span>
          </div>
        );
      })()}

      {/* Section 2 — Engine breakdown */}
      <div>
        <SectionTitle icon={Bot}>Engine Breakdown</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[{ key: "chatgpt", name: "ChatGPT" }, { key: "claude", name: "Claude" }].map(({ key, name }) => {
            const e = data.byEngine[key];
            return (
              <Card key={key} className="bg-card border-white/10">
                <CardContent className="pt-4 pb-4">
                  <p className="text-sm font-medium text-foreground mb-1">{name}</p>
                  {e ? (
                    <p className={cn("text-2xl font-bold", e.citationShare >= 60 ? "text-emerald-400" : e.citationShare >= 30 ? "text-amber-400" : "text-red-400")}>
                      {e.citationShare}% <span className="text-xs font-normal text-muted-foreground">cited · {e.mentionsFound} mentions</span>
                    </p>
                  ) : <p className="text-sm text-muted-foreground">No data</p>}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Section 3 — Query results */}
      <div>
        <SectionTitle icon={FileText}>Query Results</SectionTitle>
        <Card className="bg-card border-white/10">
          <CardContent className="pt-3 pb-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-xs text-muted-foreground">
                  <th className="text-left py-2 pr-3 font-medium">Query</th>
                  <th className="text-center py-2 px-2 font-medium w-20">ChatGPT</th>
                  <th className="text-center py-2 px-2 font-medium w-20">Claude</th>
                  <th className="text-left py-2 pl-3 font-medium">Excerpt</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-white/5 last:border-0">
                    <td className="py-2 pr-3 text-foreground text-xs max-w-[200px] truncate">{r.query}</td>
                    <td className="py-2 px-2 text-center"><Cell r={r.chatgpt} /></td>
                    <td className="py-2 px-2 text-center"><Cell r={r.claude} /></td>
                    <td className="py-2 pl-3 text-xs text-muted-foreground max-w-[220px] truncate">
                      {r.chatgpt?.excerpt ?? r.claude?.excerpt ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── A08 — Anomaly Detection ─────────────────────────────────────────────────

interface AnomalyRow {
  id: string; metric: string; severity: string; status: string;
  detectedAt: string | null; value: number | null; baseline: number | null;
  delta: number | null; rootCause: string | null;
}

function AnomalyBody({ tenantId }: { tenantId: string }) {
  const { data: anomalies = [], isLoading } = useQuery<AnomalyRow[]>({
    queryKey: ["/api/agents/anomalies", tenantId],
    queryFn: async () => {
      const res = await fetch(`/api/agents/anomalies?tenantId=${encodeURIComponent(tenantId)}`);
      if (!res.ok) throw new Error("Failed to load anomalies");
      return res.json();
    },
    enabled: !!tenantId,
    refetchInterval: 30_000,
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;

  const open = anomalies.filter((a) => a.status === "open");
  const p0 = open.filter((a) => a.severity === "P0").length;
  const p1 = open.filter((a) => a.severity === "P1").length;
  const p2 = open.filter((a) => a.severity === "P2").length;

  return (
    <div className="space-y-5">
      <div>
        <SectionTitle icon={Zap}>Summary</SectionTitle>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Tile label="Total Open" value={open.length} />
          <Tile label="P0 Critical" value={p0} accent={p0 > 0 ? "text-red-400" : undefined} />
          <Tile label="P1 High" value={p1} accent={p1 > 0 ? "text-amber-400" : undefined} />
          <Tile label="P2 Medium" value={p2} accent={p2 > 0 ? "text-yellow-400" : undefined} />
        </div>
      </div>

      {open.length === 0 ? (
        <Card className="bg-emerald-950/30 border-emerald-800/40">
          <CardContent className="py-6 flex items-center gap-3">
            <CheckCircle2 className="h-6 w-6 text-emerald-400 shrink-0" />
            <div>
              <p className="text-sm font-medium text-emerald-400">No anomalies detected</p>
              <p className="text-xs text-muted-foreground">All tracked metrics are within healthy ranges.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div>
          <SectionTitle icon={AlertTriangle}>Active Anomalies</SectionTitle>
          <AnomalySection anomalies={anomalies as never} tenantId={tenantId} />
        </div>
      )}
    </div>
  );
}

// ── A09 — Recommendation Synthesis ──────────────────────────────────────────

function RecommendationBody({ tenantId, onRun, running }: { tenantId: string; onRun: () => void; running: boolean }) {
  const { data: recs = [], isLoading } = useQuery<Array<Record<string, unknown>>>({
    queryKey: ["/api/agents/recommendations", tenantId],
    queryFn: async () => {
      const res = await fetch(`/api/agents/recommendations?tenantId=${encodeURIComponent(tenantId)}`);
      if (!res.ok) throw new Error("Failed to load recommendations");
      return res.json();
    },
    enabled: !!tenantId,
    refetchInterval: 30_000,
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (recs.length === 0) {
    return (
      <EmptyState
        message="No recommendations yet. Run synthesis to generate this week's prioritised actions."
        action={<Button size="sm" onClick={onRun} disabled={running} className="gap-1">{running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />} Run Now</Button>}
      />
    );
  }
  return <RecommendationList recommendations={recs as never} />;
}

// ── A10 — Report Composition ────────────────────────────────────────────────

interface ReportDraftRow {
  id: string; reportType: string | null; weekNumber: number | null; status: string;
  analystNotes: string | null; createdAt: string | null;
  content?: {
    executiveSummary?: string[];
    trafficSnapshot?: { sessions: number; users: number; conversions: number; engagedSessions: number };
    anomaliesSection?: { count: number; p0Count: number; p1Count: number };
  } | null;
}

function ReportBody({ tenantId, onRun, running }: { tenantId: string; onRun: () => void; running: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const { data: reports = [], isLoading } = useQuery<ReportDraftRow[]>({
    queryKey: ["/api/agents/reports", tenantId],
    queryFn: async () => {
      const res = await fetch(`/api/agents/reports?tenantId=${encodeURIComponent(tenantId)}`);
      if (!res.ok) throw new Error("Failed to load reports");
      return res.json();
    },
    enabled: !!tenantId,
    refetchInterval: 30_000,
  });

  const latest = reports[0];

  const patchStatus = async (status: string) => {
    if (!latest) return;
    setBusy(true);
    try {
      await apiRequest("PATCH", `/api/agents/reports/${latest.id}`, { status });
      toast({ title: `Report ${status.replace(/_/g, " ")}` });
      qc.invalidateQueries({ queryKey: ["/api/agents/reports", tenantId] });
    } catch {
      toast({ title: "Update failed", variant: "destructive" });
    } finally { setBusy(false); }
  };

  const runQa = async () => {
    if (!latest) return;
    setBusy(true);
    try {
      const res = await apiRequest("POST", "/api/agents/qa/run", { tenantId, reportDraftId: latest.id });
      const data = await res.json();
      toast({ title: data.passed ? "QA passed" : "QA failed", description: data.passed ? "Ready for approval" : `${data.issues?.length ?? 0} issues found` });
      qc.invalidateQueries({ queryKey: ["/api/agents/reports", tenantId] });
    } catch {
      toast({ title: "QA run failed", variant: "destructive" });
    } finally { setBusy(false); }
  };

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (!latest) {
    return (
      <EmptyState
        message="No report drafts yet. Generate a weekly report to get started."
        action={<Button size="sm" onClick={onRun} disabled={running} className="gap-1">{running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />} Generate Report</Button>}
      />
    );
  }

  const c = latest.content;
  const t = c?.trafficSnapshot;
  return (
    <div className="space-y-5">
      <div>
        <SectionTitle icon={FileText}>Latest Draft</SectionTitle>
        <Card className="bg-card border-white/10">
          <CardContent className="pt-4 pb-4 space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs border-white/10">{latest.reportType ?? "weekly"}</Badge>
              <Badge variant="outline" className="text-xs border-white/10">Week {latest.weekNumber ?? "—"}</Badge>
              <Badge variant="outline" className={cn("text-xs border-white/10",
                latest.status === "approved" ? "text-emerald-400" :
                latest.status === "qa_failed" || latest.status === "rejected" ? "text-red-400" :
                "text-amber-400")}>{latest.status.replace(/_/g, " ")}</Badge>
              <span className="text-xs text-muted-foreground ml-auto">{fmtTime(latest.createdAt)}</span>
            </div>

            {t && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Tile label="Sessions" value={t.sessions?.toLocaleString() ?? "—"} />
                <Tile label="Users" value={t.users?.toLocaleString() ?? "—"} />
                <Tile label="Conversions" value={t.conversions?.toLocaleString() ?? "—"} />
                <Tile label="Anomalies" value={c?.anomaliesSection?.count ?? 0} accent={(c?.anomaliesSection?.count ?? 0) > 0 ? "text-amber-400" : undefined} />
              </div>
            )}

            {c?.executiveSummary && c.executiveSummary.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Executive Summary</p>
                <ul className="space-y-1">
                  {c.executiveSummary.slice(0, 6).map((b, i) => (
                    <li key={i} className="text-sm text-foreground flex gap-2"><span className="text-cyan-400">•</span><span>{b}</span></li>
                  ))}
                </ul>
              </div>
            )}

            {latest.analystNotes && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Analyst Notes</p>
                <p className="text-sm text-foreground">{latest.analystNotes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => patchStatus("approved")} className="gap-1 bg-emerald-600 hover:bg-emerald-500">
          <CheckCircle2 className="h-3.5 w-3.5" /> Approve
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => patchStatus("rejected")} className="gap-1 border-red-500/40 text-red-400 hover:bg-red-500/10">
          <XCircle className="h-3.5 w-3.5" /> Reject
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={runQa} className="gap-1">
          <ShieldCheck className="h-3.5 w-3.5" /> Request QA Review
        </Button>
      </div>

      {/* History */}
      <div>
        <SectionTitle icon={Clock}>Report History</SectionTitle>
        <Card className="bg-card border-white/10">
          <CardContent className="pt-2 pb-2">
            {reports.slice(0, 5).map((r) => (
              <div key={r.id} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                <span className="text-sm text-foreground">Week {r.weekNumber ?? "—"} · {r.reportType ?? "weekly"}</span>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs border-white/10 text-muted-foreground">{r.status.replace(/_/g, " ")}</Badge>
                  <span className="text-xs text-muted-foreground">{fmtTime(r.createdAt)}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── A11 — Quality Review ────────────────────────────────────────────────────

interface QaResult {
  passed: boolean;
  issues: string[];
  checkResults?: {
    factualConsistency: { passed: boolean; issues: string[] };
    completeness: { passed: boolean; issues: string[] };
    tone: { passed: boolean; issues: string[] };
  };
}

function QaBody({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [running, setRunning] = useState(false);

  // Need latest report draft id first
  const { data: reports = [], isLoading: reportsLoading } = useQuery<ReportDraftRow[]>({
    queryKey: ["/api/agents/reports", tenantId],
    queryFn: async () => {
      const res = await fetch(`/api/agents/reports?tenantId=${encodeURIComponent(tenantId)}`);
      if (!res.ok) throw new Error("Failed to load reports");
      return res.json();
    },
    enabled: !!tenantId,
  });

  const latestId = reports[0]?.id;

  const { data: qa, isLoading: qaLoading } = useQuery<{ status: string; qaResults: QaResult | null }>({
    queryKey: ["/api/agents/qa/result", latestId],
    queryFn: async () => {
      const res = await fetch(`/api/agents/qa/result?reportDraftId=${encodeURIComponent(latestId!)}`);
      if (!res.ok) throw new Error("Failed to load QA result");
      return res.json();
    },
    enabled: !!latestId,
  });

  const runQa = async () => {
    if (!latestId) return;
    setRunning(true);
    try {
      const res = await apiRequest("POST", "/api/agents/qa/run", { tenantId, reportDraftId: latestId });
      const data = await res.json();
      toast({ title: data.passed ? "QA passed" : "QA failed", description: data.passed ? "Ready for approval" : `${data.issues?.length ?? 0} issues` });
      qc.invalidateQueries({ queryKey: ["/api/agents/qa/result", latestId] });
    } catch {
      toast({ title: "QA run failed", variant: "destructive" });
    } finally { setRunning(false); }
  };

  if (reportsLoading) return <Skeleton className="h-40 w-full" />;
  if (!latestId) {
    return <EmptyState message="Generate a report first, then run a QA review on the draft." action={<Link href="/dashboard/agents/a10"><Button size="sm" variant="outline" className="gap-1"><FileText className="h-3.5 w-3.5" /> Go to Report Composer</Button></Link>} />;
  }

  const result = qa?.qaResults;
  const checks = result?.checkResults;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <SectionTitle icon={ShieldCheck}>Latest QA Result</SectionTitle>
        <Button size="sm" disabled={running} onClick={runQa} className="gap-1">
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />} Run QA
        </Button>
      </div>

      {qaLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : !result ? (
        <EmptyState message="No QA review has been run on the latest draft yet. Click Run QA above." />
      ) : (
        <>
          {/* Pass / fail banner */}
          <Card className={cn("border", result.passed ? "bg-emerald-950/30 border-emerald-800/40" : "bg-red-950/30 border-red-800/40")}>
            <CardContent className="py-5 flex items-center gap-3">
              {result.passed ? <ShieldCheck className="h-7 w-7 text-emerald-400" /> : <ShieldAlert className="h-7 w-7 text-red-400" />}
              <div>
                <p className={cn("text-base font-semibold", result.passed ? "text-emerald-400" : "text-red-400")}>
                  {result.passed ? "Passed — ready for analyst approval" : "Failed pre-flight checks"}
                </p>
                {!result.passed && result.issues.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {result.issues.map((iss, i) => (
                      <li key={i} className="text-xs text-red-300 flex gap-2"><span>•</span><span>{iss}</span></li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Check breakdown */}
          {checks && (
            <div>
              <SectionTitle icon={Zap}>QA Checks</SectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  { label: "Factual Consistency", c: checks.factualConsistency },
                  { label: "Completeness", c: checks.completeness },
                  { label: "Tone", c: checks.tone },
                ].map(({ label, c }) => (
                  <Card key={label} className="bg-card border-white/10">
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-center gap-2">
                        {c.passed ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-red-400" />}
                        <span className="text-sm font-medium text-foreground">{label}</span>
                      </div>
                      {!c.passed && c.issues.length > 0 && (
                        <p className="text-xs text-red-300 mt-2">{c.issues[0]}</p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── A12 — Client Communication ──────────────────────────────────────────────

function CommunicationBody({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const { data: drafts = [], isLoading } = useQuery<EmailDraft[]>({
    queryKey: ["/api/agents/communication", tenantId],
    queryFn: async () => {
      const res = await fetch(`/api/agents/communication?tenantId=${encodeURIComponent(tenantId)}`);
      if (!res.ok) throw new Error("Failed to load email drafts");
      return res.json();
    },
    enabled: !!tenantId,
    refetchInterval: 30_000,
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (drafts.length === 0) {
    return <EmptyState message="Approve a report first, then generate the client communication email from the Review Queue." action={<Link href="/dashboard/review-queue"><Button size="sm" variant="outline" className="gap-1"><Mail className="h-3.5 w-3.5" /> Open Review Queue</Button></Link>} />;
  }

  return (
    <div className="space-y-4">
      <SectionTitle icon={Mail}>Email Drafts</SectionTitle>
      {drafts.map((d) => (
        <EmailDraftCard key={d.id} emailDraft={d} onUpdated={() => qc.invalidateQueries({ queryKey: ["/api/agents/communication", tenantId] })} />
      ))}
    </div>
  );
}

// ── A02 — Keyword Intelligence ──────────────────────────────────────────────
// Inline (not the shared collapsed component) so all four sub-sections are
// EXPANDED by default on the dedicated agent page.

interface MoverRow { query: string; position: number; prevPosition: number; positionDelta: number }
interface CtrRow { query: string; impressions: number; ctr: number; expectedCtr: number; potentialExtraClicks: number }
interface CannibalRow { query: string; totalImpressions: number; pages: Array<{ page: string; impressions: number; clicks: number; position: number }> }
interface NewKwRow { query: string; impressions: number; position: number; type: string }
interface KeywordFindings {
  rankingDeltas?: MoverRow[];
  ctrOpportunities?: CtrRow[];
  cannibalizationSignals?: CannibalRow[];
  newKeywordOpportunities?: NewKwRow[];
  error?: string;
}
interface KeywordResponse { exists: boolean; findings?: KeywordFindings }

const kwNum = (n: number) => Math.round(n).toLocaleString();
const kwShortUrl = (u: string) => u.replace(/^https?:\/\//, "").replace(/^www\./, "");

// Collapsible sub-section, OPEN by default.
function SubSection({ icon: Icon, title, count, accent, children }: {
  icon: typeof Search; title: string; count: number; accent?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} className="mb-2 mt-4 flex w-full items-center gap-2 text-left">
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        <Icon className={cn("h-3.5 w-3.5", accent ?? "text-purple-400")} />
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
        <span className="text-xs text-muted-foreground">({count})</span>
      </button>
      {open && children}
    </div>
  );
}

function KeywordBody({ tenantId }: { tenantId: string }) {
  const { data, isLoading } = useQuery<KeywordResponse>({
    queryKey: ["/api/agents/keywords", tenantId],
    queryFn: async () => {
      const res = await fetch(`/api/agents/keywords?tenantId=${encodeURIComponent(tenantId)}`, { credentials: "include" });
      if (!res.ok) return { exists: false };
      const json = await res.json();
      console.log("[A02] /api/agents/keywords →", json);
      return json;
    },
    enabled: !!tenantId,
    refetchInterval: 15_000,
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  // Normalise: findings may be the top-level body, or nested under findings/output.
  const raw = (data ?? {}) as Record<string, unknown>;
  const f = (raw.findings ?? raw.output ?? raw) as KeywordFindings & Record<string, unknown>;
  const hasData = !!data?.exists || !!(f?.rankingDeltas || f?.ctrOpportunities || f?.cannibalizationSignals);

  if (!hasData || f?.error) {
    return (
      <EmptyState
        message={(f?.error as string) ?? "No keyword analysis yet. Click Run Now above to analyse GSC query data."}
      />
    );
  }

  // Defensive field mapping — real agent field names, with alt names as fallback.
  const movers   = (f.rankingDeltas ?? (f as Record<string, MoverRow[]>).rankingMovers ?? []).slice(0, 20);
  const ctr      = (f.ctrOpportunities ?? []).slice(0, 10);
  const cannibal = (f.cannibalizationSignals ?? []);
  const newKw    = (f.newKeywordOpportunities ?? (f as Record<string, NewKwRow[]>).newOpportunities ?? []).slice(0, 15);

  return (
    <div className="space-y-1">
      <SectionTitle icon={Search}>Keyword Intelligence</SectionTitle>
      <Card className="bg-card border-white/10">
        <CardContent className="pt-3 pb-4">

          {/* Ranking Movers — Keyword | Last wk | This wk | Delta */}
          <SubSection icon={TrendingUp} title="Ranking Movers" count={movers.length}>
            <div className="rounded-md border border-white/5">
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-2 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <span>Keyword</span><span className="text-right">Last wk</span><span className="text-right">This wk</span><span className="text-right">Delta</span>
              </div>
              {movers.length ? movers.map((m, i) => {
                const up = m.positionDelta > 0, down = m.positionDelta < 0;
                return (
                  <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr] items-center gap-2 border-t border-white/5 px-3 py-1.5 text-sm">
                    <span className="truncate text-foreground/90" title={m.query}>{m.query}</span>
                    <span className="text-right text-muted-foreground">{m.prevPosition}</span>
                    <span className="text-right text-foreground">{m.position}</span>
                    <span className={cn("flex items-center justify-end gap-1", up ? "text-emerald-400" : down ? "text-red-400" : "text-muted-foreground")}>
                      {up ? <TrendingUp className="h-3.5 w-3.5" /> : down ? <TrendingDown className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
                      {Math.abs(m.positionDelta)}
                    </span>
                  </div>
                );
              }) : <p className="px-3 py-2 text-xs text-muted-foreground">No ranking movers found in latest run.</p>}
            </div>
          </SubSection>

          {/* CTR Opportunities — Keyword | Impr | CTR | Expected | +Clicks */}
          <SubSection icon={MousePointerClick} title="CTR Opportunities" count={ctr.length}>
            <div className="rounded-md border border-white/5">
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <span>Keyword</span><span className="text-right">Impr.</span><span className="text-right">CTR</span><span className="text-right">Expected</span><span className="text-right">+Clicks</span>
              </div>
              {ctr.length ? ctr.map((c, i) => (
                <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2 border-t border-white/5 px-3 py-1.5 text-sm">
                  <span className="truncate text-foreground/90" title={c.query}>{c.query}</span>
                  <span className="text-right text-muted-foreground">{kwNum(c.impressions)}</span>
                  <span className="text-right text-amber-400">{c.ctr}%</span>
                  <span className="text-right text-muted-foreground">{c.expectedCtr}%</span>
                  <span className="text-right text-emerald-400">+{kwNum(c.potentialExtraClicks)}</span>
                </div>
              )) : <p className="px-3 py-2 text-xs text-muted-foreground">No CTR opportunities found in latest run.</p>}
            </div>
          </SubSection>

          {/* Cannibalization — Keyword | Page 1 | Page 2 | Impr split */}
          <SubSection icon={AlertTriangle} title="Cannibalization Signals" count={cannibal.length} accent="text-red-400">
            <div className="rounded-md border border-white/5">
              <div className="grid grid-cols-[1.5fr_1.5fr_1.5fr_1fr] gap-2 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <span>Keyword</span><span>Page 1</span><span>Page 2</span><span className="text-right">Impr. split</span>
              </div>
              {cannibal.length ? cannibal.map((c, i) => (
                <div key={i} className="grid grid-cols-[1.5fr_1.5fr_1.5fr_1fr] gap-2 border-t border-white/5 px-3 py-1.5 text-sm">
                  <span className="truncate text-foreground/90" title={c.query}>{c.query}</span>
                  <span className="truncate text-muted-foreground" title={c.pages[0]?.page}>{c.pages[0] ? kwShortUrl(c.pages[0].page) : "—"}</span>
                  <span className="truncate text-muted-foreground" title={c.pages[1]?.page}>{c.pages[1] ? kwShortUrl(c.pages[1].page) : "—"}</span>
                  <span className="text-right text-muted-foreground">{kwNum(c.pages[0]?.impressions ?? 0)}/{kwNum(c.pages[1]?.impressions ?? 0)}</span>
                </div>
              )) : <p className="px-3 py-2 text-xs text-muted-foreground">No cannibalization signals found in latest run.</p>}
            </div>
          </SubSection>

          {/* New Opportunities — Keyword | Position | Impr | Type */}
          <SubSection icon={Sparkles} title="New Keyword Opportunities" count={newKw.length}>
            <div className="rounded-md border border-white/5">
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-2 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <span>Keyword</span><span className="text-right">Position</span><span className="text-right">Impr.</span><span className="text-right">Type</span>
              </div>
              {newKw.length ? newKw.map((k, i) => (
                <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr] items-center gap-2 border-t border-white/5 px-3 py-1.5 text-sm">
                  <span className="truncate text-foreground/90" title={k.query}>{k.query}</span>
                  <span className="text-right text-muted-foreground">{k.position}</span>
                  <span className="text-right text-muted-foreground">{kwNum(k.impressions)}</span>
                  <span className="flex justify-end">
                    <Badge className={k.type === "new" ? "border-transparent bg-emerald-500/15 text-emerald-400" : "border-transparent bg-cyan-500/15 text-cyan-400"}>{k.type}</Badge>
                  </span>
                </div>
              )) : <p className="px-3 py-2 text-xs text-muted-foreground">No new opportunities found in latest run.</p>}
            </div>
          </SubSection>

        </CardContent>
      </Card>
    </div>
  );
}

// ── A04 — Content Performance ───────────────────────────────────────────────
// Inline (not the shared collapsed component) — all sub-sections expanded.

interface TopPerfRow { page: string; sessions: number; users: number; engagementRate: number; avgEngagementTime: string }
interface DecayRow { page: string; sessions: number; prevSessions: number; dropPct: number }
interface GapRow { page: string; impressions: number; position: number; potentialClicksToPage1: number }
interface LinkRow { page: string; searchImpressions: number; sessions: number; reason: string }
interface ContentFindings {
  topPerformingPages?: TopPerfRow[];
  decayingPages?: DecayRow[];
  contentGapOpportunities?: GapRow[];
  internalLinkingDeficiencies?: LinkRow[];
  error?: string;
}
interface ContentResponse { exists: boolean; findings?: ContentFindings }

function ContentBody({ tenantId }: { tenantId: string }) {
  const { data, isLoading } = useQuery<ContentResponse>({
    queryKey: ["/api/agents/content", tenantId],
    queryFn: async () => {
      const res = await fetch(`/api/agents/content?tenantId=${encodeURIComponent(tenantId)}`, { credentials: "include" });
      if (!res.ok) return { exists: false };
      const json = await res.json();
      console.log("[A04] /api/agents/content →", json);
      return json;
    },
    enabled: !!tenantId,
    refetchInterval: 15_000,
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  const raw = (data ?? {}) as Record<string, unknown>;
  const f = (raw.findings ?? raw.output ?? raw) as ContentFindings & Record<string, unknown>;
  const hasData = !!data?.exists || !!(f?.topPerformingPages || f?.decayingPages || f?.contentGapOpportunities);

  if (!hasData || f?.error) {
    return (
      <EmptyState
        message={(f?.error as string) ?? "No content analysis yet. Click Run Now above to analyse GA4 + GSC page data."}
      />
    );
  }

  // Defensive mapping — real field names with alt names as fallback.
  const top     = (f.topPerformingPages ?? (f as Record<string, TopPerfRow[]>).topPerformers ?? []).slice(0, 10);
  const decay   = (f.decayingPages ?? []).slice(0, 10);
  const gaps    = (f.contentGapOpportunities ?? (f as Record<string, GapRow[]>).contentGaps ?? []).slice(0, 10);
  const linking = (f.internalLinkingDeficiencies ?? (f as Record<string, LinkRow[]>).internalLinkingIssues ?? []).slice(0, 10);

  return (
    <div className="space-y-1">
      <SectionTitle icon={FileText}>Content Performance</SectionTitle>
      <Card className="bg-card border-white/10">
        <CardContent className="pt-3 pb-4">

          {/* Top Performers — Page | Sessions | Engagement (green badge top 3) */}
          <SubSection icon={Layers} title="Top Performing Pages" count={top.length} accent="text-emerald-400">
            <div className="rounded-md border border-white/5">
              <div className="grid grid-cols-[3fr_1fr_1.2fr] gap-2 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <span>Page</span><span className="text-right">Sessions</span><span className="text-right">Engagement</span>
              </div>
              {top.length ? top.map((p, i) => (
                <div key={i} className="grid grid-cols-[3fr_1fr_1.2fr] items-center gap-2 border-t border-white/5 px-3 py-1.5 text-sm">
                  <span className="flex items-center gap-1.5 truncate text-foreground/90" title={p.page}>
                    {i < 3 && <Badge className="border-transparent bg-emerald-500/15 text-emerald-400 text-[10px] px-1">#{i + 1}</Badge>}
                    <span className="truncate">{kwShortUrl(p.page)}</span>
                  </span>
                  <span className="text-right text-muted-foreground">{kwNum(p.sessions)}</span>
                  <span className="text-right text-foreground">{p.engagementRate >= 0 ? `${p.engagementRate}%` : "—"}</span>
                </div>
              )) : <p className="px-3 py-2 text-xs text-muted-foreground">No top performers found in latest run.</p>}
            </div>
          </SubSection>

          {/* Decaying — Page | Drop% | Baseline | Current (red badge) */}
          <SubSection icon={TrendingDown} title="Decaying Pages" count={decay.length} accent="text-red-400">
            <div className="rounded-md border border-white/5">
              <div className="grid grid-cols-[2.6fr_1fr_1fr_1fr] gap-2 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <span>Page</span><span className="text-right">Drop</span><span className="text-right">Baseline</span><span className="text-right">Current</span>
              </div>
              {decay.length ? decay.map((p, i) => (
                <div key={i} className="grid grid-cols-[2.6fr_1fr_1fr_1fr] items-center gap-2 border-t border-white/5 px-3 py-1.5 text-sm">
                  <span className="truncate text-foreground/90" title={p.page}>{kwShortUrl(p.page)}</span>
                  <span className="flex items-center justify-end gap-1 text-red-400"><TrendingDown className="h-3.5 w-3.5" />{p.dropPct}%</span>
                  <span className="text-right text-muted-foreground">{kwNum(p.prevSessions)}</span>
                  <span className="text-right text-foreground">{kwNum(p.sessions)}</span>
                </div>
              )) : <p className="px-3 py-2 text-xs text-muted-foreground">No decaying pages found in latest run.</p>}
            </div>
          </SubSection>

          {/* Content Gaps — Page | Position | Impr | Potential clicks */}
          <SubSection icon={FileSearch} title="Content Gap Opportunities" count={gaps.length}>
            <div className="rounded-md border border-white/5">
              <div className="grid grid-cols-[2.6fr_1fr_1fr_1.2fr] gap-2 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <span>Page</span><span className="text-right">Position</span><span className="text-right">Impr.</span><span className="text-right">Pot. clicks</span>
              </div>
              {gaps.length ? gaps.map((p, i) => (
                <div key={i} className="grid grid-cols-[2.6fr_1fr_1fr_1.2fr] gap-2 border-t border-white/5 px-3 py-1.5 text-sm">
                  <span className="truncate text-foreground/90" title={p.page}>{kwShortUrl(p.page)}</span>
                  <span className="text-right text-muted-foreground">{p.position}</span>
                  <span className="text-right text-muted-foreground">{kwNum(p.impressions)}</span>
                  <span className="text-right text-emerald-400">+{kwNum(p.potentialClicksToPage1)}</span>
                </div>
              )) : <p className="px-3 py-2 text-xs text-muted-foreground">No content gaps found in latest run.</p>}
            </div>
          </SubSection>

          {/* Internal Linking — Page | Search demand | On-site sessions (heuristic) */}
          <SubSection icon={Link2} title="Internal Linking" count={linking.length}>
            <div className="mb-1.5 -mt-1">
              <Badge variant="outline" className="text-[10px] border-white/10 text-muted-foreground">heuristic estimate</Badge>
            </div>
            <div className="rounded-md border border-white/5">
              <div className="grid grid-cols-[3fr_1.2fr_1.2fr] gap-2 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <span>Page</span><span className="text-right">Search demand</span><span className="text-right">On-site sessions</span>
              </div>
              {linking.length ? linking.map((p, i) => (
                <div key={i} className="grid grid-cols-[3fr_1.2fr_1.2fr] items-center gap-2 border-t border-white/5 px-3 py-1.5 text-sm">
                  <span className="truncate text-foreground/90" title={p.reason || p.page}>{kwShortUrl(p.page)}</span>
                  <span className="text-right text-muted-foreground">{kwNum(p.searchImpressions)}</span>
                  <span className="text-right text-foreground">{kwNum(p.sessions)}</span>
                </div>
              )) : <p className="px-3 py-2 text-xs text-muted-foreground">No internal linking issues found in latest run.</p>}
            </div>
          </SubSection>

        </CardContent>
      </Card>
    </div>
  );
}

// ── A01 — Data Ingestion Orchestrator ──────────────────────────────────────
// Shows KPI tiles for already-connected sources (GA4, GSC).
// Missing sources (SEMrush, DataForSEO) shown as "not connected".

interface OverviewMetrics {
  summary?: {
    sessions?: number; users?: number;
    clicks?: number; impressions?: number; ctr?: number; position?: number;
  };
  noData?: boolean;
}

interface GscSummary { clicks?: number; impressions?: number; ctr?: number; position?: number }

function DataIngestionBody({ tenantId, domain, gscSiteUrl }: { tenantId: string; domain?: string; gscSiteUrl?: string }) {
  const endStr   = ymd(new Date());
  const startStr = ymd(daysAgo(30));

  // GA4 — via /api/metrics/overview (needs domain + start + end).
  const { data: overview, isLoading: ga4Loading, isError: ga4Error } = useQuery<OverviewMetrics>({
    queryKey: ["/api/metrics/overview", tenantId, domain, startStr, endStr],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (tenantId) p.set("propertyId", tenantId);
      if (domain)   p.set("domain", domain);
      p.set("start", startStr);
      p.set("end", endStr);
      const res = await fetch(`/api/metrics/overview?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error(`overview ${res.status}`);
      return res.json();
    },
    enabled: !!domain,
    staleTime: 5 * 60_000,
  });

  // GSC — dedicated call by siteUrl (overview only resolves gscSiteUrl via a
  // domain match that often misses, so query GSC directly here).
  const { data: gsc, isLoading: gscLoading, isError: gscError } = useQuery<GscSummary>({
    queryKey: ["/api/metrics/gsc/summary", gscSiteUrl, startStr, endStr],
    queryFn: async () => {
      const p = new URLSearchParams();
      p.set("siteUrl", gscSiteUrl!);
      p.set("start", startStr);
      p.set("end", endStr);
      const res = await fetch(`/api/metrics/gsc/summary?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error(`gsc ${res.status}`);
      return res.json();
    },
    enabled: !!gscSiteUrl,
    staleTime: 5 * 60_000,
  });

  const isLoading = ga4Loading || gscLoading;
  const isError = ga4Error;
  const s = overview?.summary;
  const hasGa4 = (s?.sessions ?? 0) > 0 || (s?.users ?? 0) > 0;
  const hasGsc = (gsc?.clicks ?? 0) > 0 || (gsc?.impressions ?? 0) > 0;

  const fmt = (n?: number) => n != null ? n.toLocaleString("en-US") : "—";
  const fmtPct = (n?: number) => n != null ? `${n.toFixed(2)}%` : "—";
  const fmtPos = (n?: number) => n != null ? n.toFixed(1) : "—";

  return (
    <div className="space-y-5">
      <SectionTitle icon={Zap}>Connected Data Sources</SectionTitle>

      {!domain && (
        <p className="text-xs text-muted-foreground">Select a property from the header to load source KPIs.</p>
      )}
      {isError && (
        <p className="text-xs text-amber-400">Could not load live metrics — check that GA4/GSC credentials are configured.</p>
      )}

      {/* Source status cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        {/* GA4 */}
        <Card className={`border ${hasGa4 || isLoading ? "border-emerald-800/40 bg-emerald-950/20" : "border-white/10 bg-card"}`}>
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm flex items-center gap-2">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> :
               hasGa4    ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                         : <XCircle className="h-4 w-4 text-muted-foreground" />}
              <span className={hasGa4 ? "text-emerald-400" : "text-muted-foreground"}>
                Google Analytics 4 {hasGa4 ? "✓" : "— no data"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 pb-4">
            {isLoading ? <Skeleton className="h-12 w-full" /> : hasGa4 ? (
              <div className="grid grid-cols-2 gap-3 mt-1">
                <div><p className="text-xs text-muted-foreground uppercase tracking-wide">Sessions</p><p className="text-xl font-bold text-foreground">{fmt(s?.sessions)}</p></div>
                <div><p className="text-xs text-muted-foreground uppercase tracking-wide">Users</p><p className="text-xl font-bold text-foreground">{fmt(s?.users)}</p></div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Connect a GA4 property to see traffic data.</p>
            )}
          </CardContent>
        </Card>

        {/* GSC */}
        <Card className={`border ${hasGsc || gscLoading ? "border-blue-800/40 bg-blue-950/20" : "border-white/10 bg-card"}`}>
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm flex items-center gap-2">
              {gscLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> :
               hasGsc     ? <CheckCircle2 className="h-4 w-4 text-blue-400" />
                          : <XCircle className="h-4 w-4 text-muted-foreground" />}
              <span className={hasGsc ? "text-blue-400" : "text-muted-foreground"}>
                Search Console {hasGsc ? "✓" : gscError ? "— error" : "— no data"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 pb-4">
            {gscLoading ? <Skeleton className="h-12 w-full" /> : hasGsc ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-1">
                <div><p className="text-xs text-muted-foreground uppercase tracking-wide">Clicks</p><p className="text-xl font-bold text-foreground">{fmt(gsc?.clicks)}</p></div>
                <div><p className="text-xs text-muted-foreground uppercase tracking-wide">Impressions</p><p className="text-xl font-bold text-foreground">{fmt(gsc?.impressions)}</p></div>
                <div><p className="text-xs text-muted-foreground uppercase tracking-wide">CTR</p><p className="text-xl font-bold text-foreground">{fmtPct(gsc?.ctr)}</p></div>
                <div><p className="text-xs text-muted-foreground uppercase tracking-wide">Avg Position</p><p className="text-xl font-bold text-foreground">{fmtPos(gsc?.position)}</p></div>
              </div>
            ) : !gscSiteUrl ? (
              <p className="text-xs text-muted-foreground">No GSC site URL configured for this property.</p>
            ) : (
              <p className="text-xs text-muted-foreground">No Search Console data for the last 30 days.</p>
            )}
          </CardContent>
        </Card>

        {/* SEMrush — not yet connected */}
        <Card className="border border-white/10 bg-card opacity-60">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <XCircle className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">SEMrush — not connected</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 pb-4">
            <p className="text-xs text-muted-foreground">Add SEMRUSH_API_KEY to .env to unlock organic traffic data.</p>
          </CardContent>
        </Card>

        {/* DataForSEO — not yet connected */}
        <Card className="border border-white/10 bg-card opacity-60">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <XCircle className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">DataForSEO — not connected</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 pb-4">
            <p className="text-xs text-muted-foreground">Add DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD to .env to unlock technical SEO data.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── Body switch ─────────────────────────────────────────────────────────────

function AgentBody({
  agentId, tenantId, domain, gscSiteUrl, onRun, running,
}: { agentId: AgentId; tenantId: string; domain?: string; gscSiteUrl?: string; onRun: () => void; running: boolean }) {
  switch (agentId) {
    case "A01": return <DataIngestionBody tenantId={tenantId} domain={domain} gscSiteUrl={gscSiteUrl} />;
    case "A02": return <KeywordBody tenantId={tenantId} />;
    case "A04": return <ContentBody tenantId={tenantId} />;
    case "A07": return <AeoBody tenantId={tenantId} />;
    case "A08": return <AnomalyBody tenantId={tenantId} />;
    case "A09": return <RecommendationBody tenantId={tenantId} onRun={onRun} running={running} />;
    case "A10": return <ReportBody tenantId={tenantId} onRun={onRun} running={running} />;
    case "A11": return <QaBody tenantId={tenantId} />;
    case "A12": return <CommunicationBody tenantId={tenantId} />;
    default: return null; // A03/A05/A06 — coming soon (banner only)
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Main page
// ════════════════════════════════════════════════════════════════════════════

export default function AgentPage() {
  const params = useParams<{ agentId: string }>();
  const agentId = (params.agentId ?? "").toUpperCase() as AgentId;
  const config = AGENT_CONFIG[agentId];
  const { ga4PropertyId, domain, gscSiteUrl } = useDomain();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);

  const { data: runs = [], isLoading: runsLoading } = useQuery<AgentRun[]>({
    queryKey: ["/api/agents/runs", agentId, ga4PropertyId],
    queryFn: async () => {
      if (!ga4PropertyId) return [];
      const res = await fetch(`/api/agents/runs?tenantId=${encodeURIComponent(ga4PropertyId)}&agentId=${agentId}&limit=5`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!ga4PropertyId && !!config,
    refetchInterval: 20_000,
  });

  if (!config) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard"><Button variant="ghost" size="sm" className="gap-1 text-muted-foreground"><ChevronLeft className="h-4 w-4" /> Back</Button></Link>
        <p className="text-muted-foreground">Agent "{agentId}" not found.</p>
      </div>
    );
  }

  const isComingSoon = config.status === "coming_soon";
  const lastRun = runs[0];

  const handleRun = async () => {
    if (!ga4PropertyId || !config.apiEndpoint || running) return;
    setRunning(true);
    try {
      const res = await fetch(config.apiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: ga4PropertyId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      toast({ title: `${config.id} triggered`, description: "Agent run started." });
      qc.invalidateQueries(); // refresh runs + body data
    } catch (err: unknown) {
      toast({ title: "Run failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  // Header action button differs per agent
  const HeaderAction = () => {
    if (isComingSoon) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <div><Button disabled variant="outline" className="gap-2 opacity-50"><PlayCircle className="h-4 w-4" /> Run Now</Button></div>
          </TooltipTrigger>
          <TooltipContent>Connect {config.requiredIntegrations.join(", ")} to activate this agent</TooltipContent>
        </Tooltip>
      );
    }
    if (agentId === "A07") {
      return <Link href="/dashboard/ai-mentions"><Button variant="outline" className="gap-2"><ExternalLink className="h-4 w-4" /> Configure & Run</Button></Link>;
    }
    if (agentId === "A11" || agentId === "A12") {
      // Run handled inside the body (needs a report/draft id)
      return null;
    }
    return (
      <Button onClick={handleRun} disabled={running || !ga4PropertyId} className="gap-2">
        {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
        {running ? "Running…" : "Run Now"}
      </Button>
    );
  };

  return (
    <div className="space-y-5">

      <Link href="/dashboard"><Button variant="ghost" size="sm" className="gap-1 text-muted-foreground -ml-2 mb-1"><ChevronLeft className="h-4 w-4" /> Dashboard</Button></Link>

      {/* Shared header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Badge className="font-mono text-sm bg-white/10 text-foreground border-white/20 px-2.5 py-1">{config.id}</Badge>
          <div>
            <h1 className="text-xl font-bold text-foreground">{config.name}</h1>
            <div className="mt-1 flex items-center gap-3 flex-wrap">
              <StatusPill run={lastRun} isComingSoon={isComingSoon} />
              {!isComingSoon && lastRun && (
                <span className="text-xs text-muted-foreground">Last run: {fmtTime(lastRun.completedAt ?? lastRun.startedAt)}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <HeaderAction />
          <Link href="/dashboard/agent-console">
            <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground"><Terminal className="h-4 w-4" /> Console</Button>
          </Link>
        </div>
      </div>

      {/* Coming soon banner */}
      {isComingSoon && (
        <Card className="bg-gray-900/50 border-gray-700/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start gap-3">
              <div className="p-1.5 rounded-lg bg-gray-700/50 shrink-0 mt-0.5"><AlertTriangle className="h-4 w-4 text-gray-400" /></div>
              <div>
                <p className="text-sm font-medium text-gray-300">Coming Soon</p>
                <p className="text-xs text-gray-500 mt-0.5">This agent is not yet active. Required integrations:</p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {config.requiredIntegrations.map((i) => (
                    <Badge key={i} variant="outline" className="text-xs border-gray-600/50 text-gray-400">{i}</Badge>
                  ))}
                </div>
                <Link href="/dashboard/settings">
                  <Button variant="outline" size="sm" className="gap-1 mt-3 border-gray-600/50 text-gray-300"><ExternalLink className="h-3.5 w-3.5" /> Activate Integrations</Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Description */}
      <Card className="bg-card border-white/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-2"><Bot className="h-3.5 w-3.5" /> What This Agent Does</CardTitle>
        </CardHeader>
        <CardContent className="pt-0"><p className="text-sm text-foreground leading-relaxed">{config.description}</p></CardContent>
      </Card>

      {/* Info chips */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Model", value: config.model },
          { label: "Trigger", value: config.trigger },
          { label: "Status", value: isComingSoon ? "Inactive" : "Active" },
        ].map(({ label, value }) => (
          <Card key={label} className="bg-card border-white/10">
            <CardContent className="pt-3 pb-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
              <p className="text-sm font-medium text-foreground">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Agent-specific body — A01 shows even when coming_soon (partial data available) */}
      {(!isComingSoon || agentId === "A01") && ga4PropertyId && (
        <AgentBody agentId={agentId} tenantId={ga4PropertyId} domain={domain ?? undefined} gscSiteUrl={gscSiteUrl ?? undefined} onRun={handleRun} running={running} />
      )}
      {(!isComingSoon || agentId === "A01") && !ga4PropertyId && (
        <EmptyState message="Select a property from the header to load this agent's data." />
      )}

      {/* Run History — generic, all agents */}
      <div>
        <SectionTitle icon={Clock}>Run History (last 5)</SectionTitle>
        <Card className="bg-card border-white/10">
          <CardContent className="pt-3 pb-3">
            {runsLoading ? (
              <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
            ) : runs.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No runs recorded yet.</p>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10 text-xs text-muted-foreground">
                    <th className="text-left py-1.5 pr-4 font-medium">Time</th>
                    <th className="text-left py-1.5 pr-4 font-medium">Status</th>
                    <th className="text-left py-1.5 pr-4 font-medium">Duration</th>
                    <th className="text-left py-1.5 pr-4 font-medium">Tokens</th>
                    <th className="text-left py-1.5 font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => {
                    const icon = r.status === "completed" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      : r.status === "failed" ? <XCircle className="h-3.5 w-3.5 text-red-400" />
                      : r.status === "running" ? <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin" />
                      : <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
                    return (
                      <tr key={r.id} className="border-b border-white/5 last:border-0">
                        <td className="py-2 pr-4 text-xs text-muted-foreground tabular-nums">{fmtTime(r.startedAt)}</td>
                        <td className="py-2 pr-4"><div className="flex items-center gap-1.5">{icon}<span className="text-xs text-muted-foreground">{r.status}</span></div></td>
                        <td className="py-2 pr-4 text-xs text-muted-foreground tabular-nums">{fmtMs(r.durationMs)}</td>
                        <td className="py-2 pr-4 text-xs text-muted-foreground tabular-nums">{fmtTokens((r.tokensIn ?? 0) + (r.tokensOut ?? 0))}</td>
                        <td className="py-2 text-xs text-muted-foreground tabular-nums">{r.estimatedCostUsd != null ? `$${r.estimatedCostUsd.toFixed(4)}` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
        {agentId === "A02" && (
          <p className="mt-2 text-xs text-muted-foreground">
            This agent uses deterministic analysis (no LLM calls) — token cost is $0.00.
          </p>
        )}
      </div>

    </div>
  );
}
