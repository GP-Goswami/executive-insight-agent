// Monthly Strategic Report dashboard view. Mirrors the monthly PDF:
// Executive narrative, MoM+YoY KPI table, content portfolio health, technical
// health-score trend, 30-day roadmap, and the agent-run-ID appendix.
// Data comes from /api/reports/monthly.

import { useQuery, useMutation } from "@tanstack/react-query";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import {
  FileText, Gauge, ListChecks, Map as MapIcon, Layers, ClipboardList,
  Loader2, RefreshCw, Download, TrendingUp, TrendingDown, ArrowRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDomain } from "@/hooks/use-domain";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

// ── Types mirroring server/reports/monthly/monthly-builder.ts ────────────────────
interface MetricDelta { current: number; previous: number; deltaPct: number | null; deltaAbs: number }
interface KpiMoMYoY { key: string; label: string; current: number; unit: "num" | "pct" | "position"; mom: MetricDelta; yoy: MetricDelta; yoyAvailable: boolean }
interface ContentRow { page: string; users: number; sessions: number; conversions: number }
interface ContentPortfolio { topPages: ContentRow[]; totalPages: number; concentrationPct: number; signals: Array<{ label: string; value: string; status: "good" | "warn" | "bad" }> }
interface HealthTrendPoint { period: string; label: string; score: number; status: string }
interface RoadmapItem { timeframe: string; focus: string; actions: string[] }
interface MonthlyContent {
  meta: { domain: string; current: { start: string; end: string }; previous: { start: string; end: string }; yearAgo: { start: string; end: string }; generatedAt: string };
  executiveNarrative: string[];
  kpis: KpiMoMYoY[];
  contentPortfolio: ContentPortfolio;
  technicalHealthTrend: HealthTrendPoint[];
  roadmap: RoadmapItem[];
  appendix: { agentRuns: Array<{ agentId: string; runId: string; status: string; startedAt: string | null }>; sourceRunId: string | null; generatedAt: string };
}
interface MonthlyResponse { exists: boolean; content?: MonthlyContent }

const num = (n: number) => Math.round(n).toLocaleString();
const STATUS_DOT: Record<string, string> = { good: "bg-emerald-400", warn: "bg-amber-400", bad: "bg-red-400" };

function SectionTitle({ index, icon: Icon, children }: { index: number; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-500/15 text-xs font-bold text-violet-400">{index}</span>
      <Icon className="h-4 w-4 text-violet-400" />
      <h2 className="text-base font-semibold text-foreground">{children}</h2>
    </div>
  );
}

function Delta({ pct, invert }: { pct: number | null; invert?: boolean }) {
  if (pct === null) return <span className="text-muted-foreground">n/a</span>;
  const positive = invert ? pct < 0 : pct > 0;
  const neutral = pct === 0;
  const Icon = neutral ? ArrowRight : positive ? TrendingUp : TrendingDown;
  const color = neutral ? "text-muted-foreground" : positive ? "text-emerald-400" : "text-red-400";
  return <span className={cn("inline-flex items-center justify-end gap-1", color)}><Icon className="h-3.5 w-3.5" />{pct >= 0 ? "+" : ""}{pct}%</span>;
}

export default function MonthlyReportPage() {
  const { ga4PropertyId, domain } = useDomain();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<MonthlyResponse>({
    queryKey: ["/api/reports/monthly", ga4PropertyId],
    queryFn: async () => {
      const res = await fetch(`/api/reports/monthly?tenantId=${encodeURIComponent(ga4PropertyId)}`, { credentials: "include" });
      if (!res.ok) return { exists: false };
      return res.json();
    },
    enabled: !!ga4PropertyId,
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/reports/monthly/run", { tenantId: ga4PropertyId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reports/monthly", ga4PropertyId] });
      toast({ title: "Monthly report generated", description: "Narrative, KPIs and roadmap refreshed." });
    },
    onError: (err: Error) => toast({ title: "Generation failed", description: err.message, variant: "destructive" }),
  });

  async function downloadPdf() {
    try {
      const res = await fetch(`/api/reports/monthly/pdf?tenantId=${encodeURIComponent(ga4PropertyId)}`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${domain || "report"}-monthly.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({ title: "PDF download failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  }

  if (!ga4PropertyId) {
    return <div className="flex min-h-[60vh] items-center justify-center"><p className="text-sm text-muted-foreground">Select a domain/GA4 property to view the monthly report.</p></div>;
  }
  if (isLoading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const content = data?.content;
  const yoyAvailable = content?.kpis.some((k) => k.yoyAvailable) ?? false;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Monthly Strategic Report</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {content ? `${content.meta.domain} · ${content.meta.current.start} → ${content.meta.current.end}` : "Strategic report — narrative, MoM/YoY, roadmap"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={runMutation.isPending} onClick={() => runMutation.mutate()}>
            {runMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {content ? "Regenerate" : "Generate"}
          </Button>
          {content && <Button size="sm" onClick={downloadPdf}><Download className="h-4 w-4" /> Download PDF</Button>}
        </div>
      </div>

      {!content ? (
        <Card className="border-white/10 bg-card/50">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <FileText className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No monthly report generated yet for this property.</p>
            <Button disabled={runMutation.isPending} onClick={() => runMutation.mutate()}>
              {runMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Generate Monthly Report
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* 1. Executive Narrative */}
          <section>
            <SectionTitle index={1} icon={FileText}>Executive Narrative</SectionTitle>
            <Card className="border-white/10 bg-card/50">
              <CardContent className="space-y-3 p-5">
                {content.executiveNarrative.map((p, i) => (
                  <p key={i} className="text-sm leading-relaxed text-foreground/90">{p}</p>
                ))}
              </CardContent>
            </Card>
          </section>

          {/* 2. KPI MoM + YoY */}
          <section>
            <SectionTitle index={2} icon={TrendingUp}>KPI Performance — MoM &amp; YoY</SectionTitle>
            <Card className="border-white/10 bg-card/50">
              <CardContent className="p-0">
                <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-2 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <span>Metric</span><span className="text-right">This month</span><span className="text-right">MoM</span><span className="text-right">YoY</span>
                </div>
                <div className="divide-y divide-white/5">
                  {content.kpis.map((k) => (
                    <div key={k.key} className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-2 px-4 py-2.5 text-sm">
                      <span className="text-foreground/90">{k.label}</span>
                      <span className="text-right font-medium text-foreground">{num(k.current)}{k.unit === "pct" ? "%" : ""}</span>
                      <span className="text-right"><Delta pct={k.mom.deltaPct} invert={k.unit === "position"} /></span>
                      <span className="text-right">{k.yoyAvailable ? <Delta pct={k.yoy.deltaPct} invert={k.unit === "position"} /> : <span className="text-muted-foreground">—</span>}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            {!yoyAvailable && <p className="mt-2 text-xs italic text-muted-foreground">Year-over-year not yet available — this is the first year of tracked data.</p>}
          </section>

          {/* 3. Content Portfolio Health */}
          <section>
            <SectionTitle index={3} icon={Layers}>Content Portfolio Health</SectionTitle>
            <Card className="border-white/10 bg-card/50">
              <CardContent className="p-5">
                <div className="mb-4 space-y-2">
                  {content.contentPortfolio.signals.map((s, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-foreground/90"><span className={cn("h-2 w-2 rounded-full", STATUS_DOT[s.status])} />{s.label}</span>
                      <span className="text-muted-foreground">{s.value}</span>
                    </div>
                  ))}
                </div>
                {content.contentPortfolio.topPages.length > 0 && (
                  <div className="divide-y divide-white/5 border-t border-white/5 pt-2">
                    {content.contentPortfolio.topPages.slice(0, 8).map((p, i) => (
                      <div key={i} className="grid grid-cols-[3fr_1fr_1fr] gap-2 py-1.5 text-sm">
                        <span className="truncate text-foreground/80">{p.page}</span>
                        <span className="text-right text-muted-foreground">{num(p.users)} users</span>
                        <span className="text-right text-muted-foreground">{num(p.conversions)} conv.</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          {/* 4. Technical Health Trend */}
          <section>
            <SectionTitle index={4} icon={Gauge}>Technical SEO Health Trend</SectionTitle>
            <Card className="border-white/10 bg-card/50">
              <CardContent className="p-5">
                <div className="mb-4 flex items-end gap-6">
                  {content.technicalHealthTrend.map((h, i) => (
                    <div key={i} className="text-center">
                      <p className="text-2xl font-bold text-foreground">{h.score}</p>
                      <p className="text-xs text-muted-foreground">{h.label}</p>
                    </div>
                  ))}
                </div>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={content.technicalHealthTrend} margin={{ top: 6, right: 12, left: -8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#94a3b8" }} />
                      <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
                      <Line type="monotone" dataKey="score" stroke="#a78bfa" strokeWidth={2} dot={{ r: 4 }} name="Health score" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </section>

          {/* 5. 30-Day Roadmap */}
          <section>
            <SectionTitle index={5} icon={MapIcon}>30-Day Strategic Roadmap</SectionTitle>
            <div className="space-y-3">
              {content.roadmap.map((item, i) => (
                <Card key={i} className="border-white/10 bg-card/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Badge className="border-transparent bg-violet-500/15 text-violet-400">{item.timeframe}</Badge>
                      <span className="text-foreground">{item.focus}</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ul className="space-y-1.5">
                      {item.actions.map((a, j) => (
                        <li key={j} className="flex gap-2 text-sm text-foreground/80">
                          <ListChecks className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-400" />{a}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          {/* 6. Appendix — Agent Run IDs */}
          <section>
            <SectionTitle index={6} icon={ClipboardList}>Appendix — Agent Run IDs</SectionTitle>
            <Card className="border-white/10 bg-card/50">
              <CardContent className="p-0">
                <div className="grid grid-cols-[1fr_3fr_1fr_2fr] gap-2 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <span>Agent</span><span>Run ID</span><span>Status</span><span className="text-right">Started</span>
                </div>
                <div className="max-h-72 divide-y divide-white/5 overflow-auto">
                  {content.appendix.agentRuns.map((r, i) => (
                    <div key={i} className="grid grid-cols-[1fr_3fr_1fr_2fr] gap-2 px-4 py-1.5 text-xs">
                      <span className="font-medium text-foreground">{r.agentId}</span>
                      <span className="truncate font-mono text-muted-foreground">{r.runId}</span>
                      <span className="text-muted-foreground">{r.status}</span>
                      <span className="text-right text-muted-foreground">{(r.startedAt ?? "").slice(0, 19).replace("T", " ")}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>

          <p className="pb-6 text-center text-xs text-muted-foreground">
            Generated {new Date(content.meta.generatedAt).toLocaleString()} · MoM vs {content.meta.previous.start}→{content.meta.previous.end} · YoY vs {content.meta.yearAgo.start}→{content.meta.yearAgo.end}
          </p>
        </>
      )}
    </div>
  );
}
