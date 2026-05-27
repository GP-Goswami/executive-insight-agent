// A04 — Content Performance section for the report. Collapsible (collapsed by
// default), additive: fetches GET /api/agents/content and renders four
// sub-sections. Matches the dark AnomalyCard/AnomalySection styling.

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ChevronDown, ChevronRight, FileText, RefreshCw, Loader2, TrendingDown, Link2, Layers, FileSearch,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface TopPerfRow { page: string; sessions: number; users: number; engagementRate: number; avgEngagementTime: string }
interface DecayRow { page: string; sessions: number; prevSessions: number; dropPct: number }
interface GapRow { page: string; impressions: number; clicks: number; ctr: number; position: number; potentialClicksToPage1: number }
interface LinkRow { page: string; reason: string; searchImpressions: number; sessions: number; conversions: number }
interface ContentFindings {
  topPerformingPages?: TopPerfRow[];
  decayingPages?: DecayRow[];
  contentGapOpportunities?: GapRow[];
  internalLinkingDeficiencies?: LinkRow[];
  note?: string;
}
interface ContentResponse { exists: boolean; findings?: ContentFindings }

const num = (n: number) => Math.round(n).toLocaleString();
const shortUrl = (u: string) => u.replace(/^https?:\/\//, "").replace(/^www\./, "");

function SubHeading({ icon: Icon, title, count }: { icon: React.ElementType; title: string; count?: number }) {
  return (
    <div className="mb-2 mt-4 flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 text-cyan-400" />
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      {count !== undefined && <span className="text-xs text-muted-foreground">({count})</span>}
    </div>
  );
}

function HeaderRow({ cols }: { cols: string[] }) {
  return (
    <div className="grid gap-2 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
      style={{ gridTemplateColumns: `2fr ${cols.slice(1).map(() => "1fr").join(" ")}` }}>
      {cols.map((c, i) => <span key={i} className={i === 0 ? "" : "text-right"}>{c}</span>)}
    </div>
  );
}

export function ContentPerformanceSection({ tenantId }: { tenantId?: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const { data } = useQuery<ContentResponse>({
    queryKey: ["/api/agents/content", tenantId],
    queryFn: async () => {
      const res = await fetch(`/api/agents/content?tenantId=${encodeURIComponent(tenantId ?? "")}`, { credentials: "include" });
      if (!res.ok) return { exists: false };
      return res.json();
    },
    enabled: !!tenantId,
  });

  const run = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/agents/content/run", { tenantId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents/content", tenantId] });
      setOpen(true);
      toast({ title: "Content analysis complete", description: "Top pages, decay, gaps and linking refreshed." });
    },
    onError: (err: Error) => toast({ title: "Content analysis failed", description: err.message, variant: "destructive" }),
  });

  const f = data?.findings;
  const top = (f?.topPerformingPages ?? []).slice(0, 5);
  const decay = (f?.decayingPages ?? []).slice(0, 10);
  const gaps = (f?.contentGapOpportunities ?? []).slice(0, 5);
  const links = (f?.internalLinkingDeficiencies ?? []).slice(0, 5);

  return (
    <section data-testid="content-performance-section">
      <Card className="border-white/10 bg-card/50 backdrop-blur-sm">
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-w-0 items-center gap-2 text-left" aria-expanded={open} data-testid="content-section-toggle">
              {open ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
              <FileText className="h-4 w-4 text-cyan-400 shrink-0" />
              <span className="font-semibold text-foreground">Content Performance</span>
              <span className="text-xs text-muted-foreground">A04</span>
              {decay.length > 0 && <Badge className="border-transparent bg-red-500/15 text-red-400">{decay.length} decaying</Badge>}
            </button>
            <Button size="sm" variant="outline" disabled={run.isPending || !tenantId} onClick={() => run.mutate()} data-testid="content-run">
              {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {run.isPending ? "Running..." : "Run Content Analysis"}
            </Button>
          </div>

          {open && (
            <div className="mt-4">
              {!f ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No content analysis yet — click "Run Content Analysis".</p>
              ) : (
                <>
                  {/* Top Performing Pages */}
                  <SubHeading icon={Layers} title="Top Performing Pages" count={top.length} />
                  <div className="rounded-md border border-white/5">
                    <HeaderRow cols={["Page", "Sessions", "Engagement"]} />
                    {top.length ? top.map((p, i) => (
                      <div key={i} className="grid grid-cols-[2fr_1fr_1fr] gap-2 border-t border-white/5 px-3 py-1.5 text-sm">
                        <span className="truncate text-foreground/90" title={p.page}>{shortUrl(p.page)}</span>
                        <span className="text-right text-muted-foreground">{num(p.sessions)}</span>
                        <span className="text-right text-muted-foreground">{p.engagementRate < 0 ? "—" : `${p.engagementRate}%`}</span>
                      </div>
                    )) : <p className="px-3 py-2 text-xs text-muted-foreground">No data.</p>}
                  </div>

                  {/* Decaying Pages */}
                  <SubHeading icon={TrendingDown} title="Decaying Pages (needs attention)" count={decay.length} />
                  <div className="rounded-md border border-white/5">
                    <HeaderRow cols={["Page", "Sessions", "Drop"]} />
                    {decay.length ? decay.map((p, i) => (
                      <div key={i} className="grid grid-cols-[2fr_1fr_1fr] items-center gap-2 border-t border-white/5 px-3 py-1.5 text-sm">
                        <span className="truncate text-foreground/90" title={p.page}>{shortUrl(p.page)}</span>
                        <span className="text-right text-muted-foreground">{num(p.prevSessions)}→{num(p.sessions)}</span>
                        <span className="flex justify-end"><Badge className="border-transparent bg-red-500/15 text-red-400">-{p.dropPct}%</Badge></span>
                      </div>
                    )) : <p className="px-3 py-2 text-xs text-muted-foreground">No decaying pages — healthy.</p>}
                  </div>

                  {/* Content Gap Opportunities */}
                  <SubHeading icon={FileSearch} title="Content Gap Opportunities" count={gaps.length} />
                  <div className="rounded-md border border-white/5">
                    <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-2 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      <span>Page</span><span className="text-right">Position</span><span className="text-right">Impressions</span><span className="text-right">Potential</span>
                    </div>
                    {gaps.length ? gaps.map((p, i) => (
                      <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-2 border-t border-white/5 px-3 py-1.5 text-sm">
                        <span className="truncate text-foreground/90" title={p.page}>{shortUrl(p.page)}</span>
                        <span className="text-right text-muted-foreground">{p.position}</span>
                        <span className="text-right text-muted-foreground">{num(p.impressions)}</span>
                        <span className="text-right text-emerald-400">+{num(p.potentialClicksToPage1)}</span>
                      </div>
                    )) : <p className="px-3 py-2 text-xs text-muted-foreground">No gap opportunities found.</p>}
                  </div>

                  {/* Internal Linking Deficiencies */}
                  <div className="mb-2 mt-4 flex items-center gap-2">
                    <Link2 className="h-3.5 w-3.5 text-cyan-400" />
                    <h4 className="text-sm font-semibold text-foreground">Internal Linking Deficiencies</h4>
                    <span className="text-xs text-muted-foreground">({links.length})</span>
                    <Badge className="border-transparent bg-amber-500/15 text-amber-400">heuristic</Badge>
                  </div>
                  <div className="rounded-md border border-white/5">
                    <HeaderRow cols={["Page", "Search demand", "On-site sessions"]} />
                    {links.length ? links.map((p, i) => (
                      <div key={i} className="grid grid-cols-[2fr_1fr_1fr] gap-2 border-t border-white/5 px-3 py-1.5 text-sm">
                        <span className="truncate text-foreground/90" title={`${p.page} — ${p.reason}`}>{shortUrl(p.page)}</span>
                        <span className="text-right text-muted-foreground">{num(p.searchImpressions)}</span>
                        <span className="text-right text-muted-foreground">{num(p.sessions)}</span>
                      </div>
                    )) : <p className="px-3 py-2 text-xs text-muted-foreground">No linking deficiencies flagged.</p>}
                  </div>
                  {f.note && <p className="mt-3 text-xs italic text-muted-foreground">{f.note}</p>}
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
