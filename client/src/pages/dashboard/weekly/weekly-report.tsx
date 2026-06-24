// Weekly Report dashboard view (PDF spec §10). Mirrors the 8 sections of the
// weekly PDF: Executive Summary, Traffic Snapshot (WoW), Ranking Movement,
// Technical Health, Content Highlights, Backlink Summary, AEO Snapshot, and
// This Week's Actions. Data comes from /api/reports/weekly.

import { useQuery, useMutation } from "@tanstack/react-query";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import {
  Activity, Users, MousePointerClick, Search, Eye, Percent, Target, Gauge,
  Link2, Bot, ListChecks, FileText, Loader2, RefreshCw, Download, TrendingUp, TrendingDown, ArrowRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { useDomain } from "@/hooks/use-domain";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

// ── Types mirroring server/reports/shared/report-data.ts ─────────────────────────
interface MetricDelta { current: number; previous: number; deltaPct: number | null; deltaAbs: number }
interface TrafficSnapshot {
  users: MetricDelta; sessions: MetricDelta; conversions: MetricDelta; engagedSessions: MetricDelta;
  clicks: MetricDelta; impressions: MetricDelta; ctr: MetricDelta; avgPosition: MetricDelta;
}
interface DailyPoint { date: string; users: number; sessions: number; clicks: number; impressions: number }
interface RankingMovementRow { query: string; clicks: number; impressions: number; ctr: number; position: number; prevPosition: number | null; positionDelta: number | null }
interface ContentRow { page: string; users: number; sessions: number; conversions: number }
interface BacklinkSummary { configured: boolean; backlinks: number; referringDomains: number; domainRank: number; note?: string }
interface AeoSnapshot { configured: boolean; totalAiUsers: number; sources: Array<{ source: string; users: number; sessions: number }>; note?: string }
interface TechnicalHealth { score: number; status: string; signals: Array<{ label: string; value: string; status: "good" | "warn" | "bad" }> }
interface RecommendationRow { priority: number; statement: string; effort: string; impact: string; ownerRole: string }
interface WeeklyContent {
  meta: { domain: string; weekNumber: number; current: { start: string; end: string }; previous: { start: string; end: string }; generatedAt: string };
  executiveSummary: string[];
  trafficSnapshot: TrafficSnapshot;
  dailySeries: DailyPoint[];
  rankingMovement: RankingMovementRow[];
  technicalHealth: TechnicalHealth;
  contentHighlights: ContentRow[];
  backlinks: BacklinkSummary;
  aeo: AeoSnapshot;
  actions: RecommendationRow[];
}
interface WeeklyResponse { exists: boolean; content?: WeeklyContent }

// ── Helpers ───────────────────────────────────────────────────────────────────
const num = (n: number) => Math.round(n).toLocaleString();
const STATUS_DOT: Record<string, string> = { good: "bg-emerald-400", warn: "bg-amber-400", bad: "bg-red-400" };

function SectionTitle({ index, icon: Icon, children }: { index: number; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-cyan-500/15 text-xs font-bold text-cyan-400">{index}</span>
      <Icon className="h-4 w-4 text-cyan-400" />
      <h2 className="text-base font-semibold text-foreground">{children}</h2>
    </div>
  );
}

function MovePill({ delta }: { delta: number | null }) {
  if (delta === null) return <Badge className="border-transparent bg-muted text-muted-foreground">new</Badge>;
  if (delta > 0) return <span className="inline-flex items-center gap-1 text-emerald-400"><TrendingUp className="h-3.5 w-3.5" />{delta}</span>;
  if (delta < 0) return <span className="inline-flex items-center gap-1 text-red-400"><TrendingDown className="h-3.5 w-3.5" />{Math.abs(delta)}</span>;
  return <span className="inline-flex items-center gap-1 text-muted-foreground"><ArrowRight className="h-3.5 w-3.5" />flat</span>;
}

// ── Page ────────────────────────────────────────────────────────────────────────
export default function WeeklyReportPage() {
  const { ga4PropertyId, domain, gscSiteUrl } = useDomain();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<WeeklyResponse>({
    queryKey: ["/api/reports/weekly", ga4PropertyId],
    queryFn: async () => {
      const res = await fetch(`/api/reports/weekly?tenantId=${encodeURIComponent(ga4PropertyId)}`, { credentials: "include" });
      if (!res.ok) return { exists: false };
      return res.json();
    },
    enabled: !!ga4PropertyId,
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const body: { tenantId: string; gscSiteUrl?: string } = { tenantId: ga4PropertyId };
      if (gscSiteUrl) body.gscSiteUrl = gscSiteUrl; // lets the server fetch live GSC
      const res = await apiRequest("POST", "/api/reports/weekly/run", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reports/weekly", ga4PropertyId] });
      toast({ title: "Weekly report generated", description: "All sections refreshed from the latest data." });
    },
    onError: (err: Error) => toast({ title: "Generation failed", description: err.message, variant: "destructive" }),
  });

  async function downloadPdf() {
    try {
      const res = await fetch(`/api/reports/weekly/pdf?tenantId=${encodeURIComponent(ga4PropertyId)}`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${domain || "report"}-weekly.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({ title: "PDF download failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  }

  if (!ga4PropertyId) {
    return <div className="flex min-h-[60vh] items-center justify-center"><p className="text-sm text-muted-foreground">Select a domain/GA4 property to view the weekly report.</p></div>;
  }

  if (isLoading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const content = data?.content;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Weekly Report</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {content
              ? `${content.meta.domain} · Week ${content.meta.weekNumber} · ${content.meta.current.start} → ${content.meta.current.end}`
              : "8-section weekly performance report"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={runMutation.isPending} onClick={() => runMutation.mutate()}>
            {runMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {content ? "Regenerate" : "Generate"}
          </Button>
          {content && (
            <Button size="sm" onClick={downloadPdf}>
              <Download className="h-4 w-4" /> Download PDF
            </Button>
          )}
        </div>
      </div>

      {!content ? (
        <Card className="border-white/10 bg-card/50">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <FileText className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No weekly report generated yet for this property.</p>
            <Button disabled={runMutation.isPending} onClick={() => runMutation.mutate()}>
              {runMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Generate Weekly Report
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* 1. Executive Summary */}
          <section>
            <SectionTitle index={1} icon={FileText}>Executive Summary</SectionTitle>
            <Card className="border-white/10 bg-card/50">
              <CardContent className="p-5">
                <ul className="space-y-2">
                  {content.executiveSummary.map((b, i) => (
                    <li key={i} className="flex gap-2 text-sm text-foreground/90">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
                      {b}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </section>

          {/* 2. Traffic Snapshot (WoW) */}
          <section>
            <SectionTitle index={2} icon={Activity}>Traffic Snapshot (Week-over-Week)</SectionTitle>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <KpiCard title="Users" value={num(content.trafficSnapshot.users.current)} change={content.trafficSnapshot.users.deltaPct ?? undefined} icon={Users} accent="cyan" />
              <KpiCard title="Sessions" value={num(content.trafficSnapshot.sessions.current)} change={content.trafficSnapshot.sessions.deltaPct ?? undefined} icon={MousePointerClick} accent="cyan" />
              <KpiCard title="Conversions" value={num(content.trafficSnapshot.conversions.current)} change={content.trafficSnapshot.conversions.deltaPct ?? undefined} icon={Target} accent="green" />
              <KpiCard title="Engaged Sessions" value={num(content.trafficSnapshot.engagedSessions.current)} change={content.trafficSnapshot.engagedSessions.deltaPct ?? undefined} icon={Activity} accent="green" />
              <KpiCard title="Clicks" value={num(content.trafficSnapshot.clicks.current)} change={content.trafficSnapshot.clicks.deltaPct ?? undefined} icon={Search} accent="purple" />
              <KpiCard title="Impressions" value={num(content.trafficSnapshot.impressions.current)} change={content.trafficSnapshot.impressions.deltaPct ?? undefined} icon={Eye} accent="purple" />
              <KpiCard title="CTR" value={`${content.trafficSnapshot.ctr.current}%`} change={content.trafficSnapshot.ctr.deltaPct ?? undefined} icon={Percent} accent="amber" />
              <KpiCard title="Avg Position" value={content.trafficSnapshot.avgPosition.current} change={content.trafficSnapshot.avgPosition.deltaPct ?? undefined} icon={Target} accent="amber" invertColors />
            </div>
            {content.dailySeries.length > 0 && (
              <Card className="mt-4 border-white/10 bg-card/50">
                <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Daily traffic — users vs clicks</CardTitle></CardHeader>
                <CardContent className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={content.dailySeries} margin={{ top: 6, right: 12, left: -8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(d: string) => d.slice(5)} />
                      <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} />
                      <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="users" stroke="#22d3ee" strokeWidth={2} dot={false} name="Users" />
                      <Line type="monotone" dataKey="clicks" stroke="#a78bfa" strokeWidth={2} dot={false} name="GSC Clicks" />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
          </section>

          {/* 3. Ranking Movement */}
          <section>
            <SectionTitle index={3} icon={TrendingUp}>Ranking Movement (Search Console)</SectionTitle>
            <Card className="border-white/10 bg-card/50">
              <CardContent className="p-0">
                {content.rankingMovement.length ? (
                  <div className="divide-y divide-white/5">
                    <div className="grid grid-cols-[3fr_1fr_1fr_1fr_1fr] gap-2 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <span>Query</span><span className="text-right">Clicks</span><span className="text-right">Impr.</span><span className="text-right">Pos.</span><span className="text-right">Move</span>
                    </div>
                    {content.rankingMovement.map((r, i) => (
                      <div key={i} className="grid grid-cols-[3fr_1fr_1fr_1fr_1fr] gap-2 px-4 py-2 text-sm">
                        <span className="truncate text-foreground/90">{r.query}</span>
                        <span className="text-right text-muted-foreground">{num(r.clicks)}</span>
                        <span className="text-right text-muted-foreground">{num(r.impressions)}</span>
                        <span className="text-right text-foreground">{r.position}</span>
                        <span className="text-right"><MovePill delta={r.positionDelta} /></span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">No ranking data for this period.</p>
                )}
              </CardContent>
            </Card>
          </section>

          {/* 4. Technical Health */}
          <section>
            <SectionTitle index={4} icon={Gauge}>Technical Health</SectionTitle>
            <Card className="border-white/10 bg-card/50">
              <CardContent className="p-5">
                <div className="mb-4 flex items-center gap-3">
                  <span className="text-3xl font-bold text-foreground">{content.technicalHealth.score}<span className="text-base text-muted-foreground">/100</span></span>
                  <Badge className={cn("border-transparent", content.technicalHealth.score >= 75 ? "bg-emerald-500/15 text-emerald-400" : content.technicalHealth.score >= 50 ? "bg-amber-500/15 text-amber-400" : "bg-red-500/15 text-red-400")}>
                    {content.technicalHealth.status}
                  </Badge>
                </div>
                <div className="space-y-2">
                  {content.technicalHealth.signals.map((sig, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-foreground/90"><span className={cn("h-2 w-2 rounded-full", STATUS_DOT[sig.status])} />{sig.label}</span>
                      <span className="text-muted-foreground">{sig.value}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>

          {/* 5. Content Highlights */}
          <section>
            <SectionTitle index={5} icon={FileText}>Content Highlights (Top Pages)</SectionTitle>
            <Card className="border-white/10 bg-card/50">
              <CardContent className="p-0">
                {content.contentHighlights.length ? (
                  <div className="divide-y divide-white/5">
                    <div className="grid grid-cols-[3fr_1fr_1fr_1fr] gap-2 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <span>Page</span><span className="text-right">Users</span><span className="text-right">Sessions</span><span className="text-right">Conv.</span>
                    </div>
                    {content.contentHighlights.map((p, i) => (
                      <div key={i} className="grid grid-cols-[3fr_1fr_1fr_1fr] gap-2 px-4 py-2 text-sm">
                        <span className="truncate text-foreground/90">{p.page}</span>
                        <span className="text-right text-muted-foreground">{num(p.users)}</span>
                        <span className="text-right text-muted-foreground">{num(p.sessions)}</span>
                        <span className="text-right text-muted-foreground">{num(p.conversions)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">No GA4 page data for this period.</p>
                )}
              </CardContent>
            </Card>
          </section>

          {/* 6. Backlink Summary */}
          <section>
            <SectionTitle index={6} icon={Link2}>Backlink Summary</SectionTitle>
            <div className="grid grid-cols-3 gap-4">
              <KpiCard title="Total Backlinks" value={num(content.backlinks.backlinks)} showTrend={false} icon={Link2} accent="cyan" />
              <KpiCard title="Referring Domains" value={num(content.backlinks.referringDomains)} showTrend={false} icon={Link2} accent="purple" />
              <KpiCard title="Domain Rank" value={num(content.backlinks.domainRank)} showTrend={false} icon={Gauge} accent="green" />
            </div>
            {content.backlinks.note && <p className="mt-2 text-xs italic text-muted-foreground">{content.backlinks.note}</p>}
          </section>

          {/* 7. AEO Snapshot */}
          <section>
            <SectionTitle index={7} icon={Bot}>AEO Snapshot (AI Assistant Referrals)</SectionTitle>
            <Card className="border-white/10 bg-card/50">
              <CardContent className="p-5">
                {content.aeo.sources.length ? (
                  <>
                    <p className="mb-3 text-sm text-foreground/90">Total AI-referred users: <span className="font-semibold">{num(content.aeo.totalAiUsers)}</span></p>
                    <div className="space-y-2">
                      {content.aeo.sources.map((a, i) => (
                        <div key={i} className="flex items-center justify-between text-sm">
                          <span className="text-foreground/90">{a.source}</span>
                          <span className="text-muted-foreground">{num(a.users)} users · {num(a.sessions)} sessions</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{content.aeo.note ?? "No AI-assistant referral traffic detected this period."}</p>
                )}
              </CardContent>
            </Card>
          </section>

          {/* 8. This Week's Actions */}
          <section>
            <SectionTitle index={8} icon={ListChecks}>This Week's Actions</SectionTitle>
            {content.actions.length ? (
              <div className="space-y-3">
                {content.actions.map((a, i) => (
                  <Card key={i} className="border-white/10 bg-card/50">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <Badge className="border-transparent bg-cyan-500/15 text-cyan-400">P{a.priority}</Badge>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground">{a.statement}</p>
                          <p className="mt-1 text-xs text-muted-foreground">Effort: {a.effort} · Impact: {a.impact} · Owner: {a.ownerRole}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="border-white/10 bg-card/50"><CardContent className="py-8 text-center text-sm text-muted-foreground">No recommendations yet — run the recommendation agent (A09).</CardContent></Card>
            )}
          </section>

          <p className="pb-6 text-center text-xs text-muted-foreground">
            Generated {new Date(content.meta.generatedAt).toLocaleString()} · compared vs {content.meta.previous.start} → {content.meta.previous.end}
          </p>
        </>
      )}
    </div>
  );
}
