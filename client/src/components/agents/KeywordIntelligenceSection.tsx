// A02 — Keyword Intelligence section for the report. Collapsible (collapsed by
// default), additive: fetches GET /api/agents/keywords and renders four
// sub-sections. Matches the dark AnomalyCard/AnomalySection styling.

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ChevronDown, ChevronRight, Search, RefreshCw, Loader2, TrendingUp, TrendingDown, ArrowRight,
  MousePointerClick, AlertTriangle, Sparkles,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface MoverRow { query: string; clicks: number; impressions: number; position: number; prevPosition: number; positionDelta: number; direction: string }
interface CtrRow { query: string; impressions: number; clicks: number; ctr: number; expectedCtr: number; position: number; potentialExtraClicks: number }
interface CannibalRow { query: string; pageCount: number; totalImpressions: number; pages: Array<{ page: string; impressions: number; clicks: number; position: number }> }
interface NewKwRow { query: string; impressions: number; clicks: number; position: number; previousImpressions: number; type: string }
interface KeywordFindings {
  rankingDeltas?: MoverRow[];
  ctrOpportunities?: CtrRow[];
  cannibalizationSignals?: CannibalRow[];
  newKeywordOpportunities?: NewKwRow[];
  error?: string;
}
interface KeywordResponse { exists: boolean; findings?: KeywordFindings }

const num = (n: number) => Math.round(n).toLocaleString();
const shortUrl = (u: string) => u.replace(/^https?:\/\//, "").replace(/^www\./, "");

function SubHeading({ icon: Icon, title, count }: { icon: React.ElementType; title: string; count?: number }) {
  return (
    <div className="mb-2 mt-4 flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 text-purple-400" />
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      {count !== undefined && <span className="text-xs text-muted-foreground">({count})</span>}
    </div>
  );
}

export function KeywordIntelligenceSection({ tenantId }: { tenantId?: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const { data } = useQuery<KeywordResponse>({
    queryKey: ["/api/agents/keywords", tenantId],
    queryFn: async () => {
      const res = await fetch(`/api/agents/keywords?tenantId=${encodeURIComponent(tenantId ?? "")}`, { credentials: "include" });
      if (!res.ok) return { exists: false };
      return res.json();
    },
    enabled: !!tenantId,
  });

  const run = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/agents/keywords/run", { tenantId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents/keywords", tenantId] });
      setOpen(true);
      toast({ title: "Keyword analysis complete", description: "Movers, CTR gaps, cannibalization and new terms refreshed." });
    },
    onError: (err: Error) => toast({ title: "Keyword analysis failed", description: err.message, variant: "destructive" }),
  });

  const f = data?.findings;
  const movers = (f?.rankingDeltas ?? []).slice(0, 10);
  const ctr = (f?.ctrOpportunities ?? []).slice(0, 5);
  const cannibal = (f?.cannibalizationSignals ?? []).slice(0, 10);
  const newKw = (f?.newKeywordOpportunities ?? []).slice(0, 10);

  return (
    <section data-testid="keyword-intelligence-section">
      <Card className="border-white/10 bg-card/50 backdrop-blur-sm">
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-w-0 items-center gap-2 text-left" aria-expanded={open} data-testid="keyword-section-toggle">
              {open ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
              <Search className="h-4 w-4 text-purple-400 shrink-0" />
              <span className="font-semibold text-foreground">Keyword Intelligence</span>
              <span className="text-xs text-muted-foreground">A02</span>
              {cannibal.length > 0 && <Badge className="border-transparent bg-red-500/15 text-red-400">{cannibal.length} cannibalization</Badge>}
            </button>
            <Button size="sm" variant="outline" disabled={run.isPending || !tenantId} onClick={() => run.mutate()} data-testid="keyword-run">
              {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {run.isPending ? "Running..." : "Run Keyword Analysis"}
            </Button>
          </div>

          {open && (
            <div className="mt-4">
              {!f || f.error ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{f?.error ?? 'No keyword analysis yet — click "Run Keyword Analysis".'}</p>
              ) : (
                <>
                  {/* Ranking Movers */}
                  <SubHeading icon={TrendingUp} title="Ranking Movers" count={movers.length} />
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
                          <span className={`flex items-center justify-end gap-1 ${up ? "text-emerald-400" : down ? "text-red-400" : "text-muted-foreground"}`}>
                            {up ? <TrendingUp className="h-3.5 w-3.5" /> : down ? <TrendingDown className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
                            {Math.abs(m.positionDelta)}
                          </span>
                        </div>
                      );
                    }) : <p className="px-3 py-2 text-xs text-muted-foreground">No notable movement.</p>}
                  </div>

                  {/* CTR Opportunities */}
                  <SubHeading icon={MousePointerClick} title="CTR Opportunities" count={ctr.length} />
                  <div className="rounded-md border border-white/5">
                    <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      <span>Keyword</span><span className="text-right">Impr.</span><span className="text-right">CTR</span><span className="text-right">Expected</span><span className="text-right">+Clicks</span>
                    </div>
                    {ctr.length ? ctr.map((c, i) => (
                      <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2 border-t border-white/5 px-3 py-1.5 text-sm">
                        <span className="truncate text-foreground/90" title={c.query}>{c.query}</span>
                        <span className="text-right text-muted-foreground">{num(c.impressions)}</span>
                        <span className="text-right text-amber-400">{c.ctr}%</span>
                        <span className="text-right text-muted-foreground">{c.expectedCtr}%</span>
                        <span className="text-right text-emerald-400">+{num(c.potentialExtraClicks)}</span>
                      </div>
                    )) : <p className="px-3 py-2 text-xs text-muted-foreground">No CTR gaps found.</p>}
                  </div>

                  {/* Cannibalization Signals */}
                  <div className="mb-2 mt-4 flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                    <h4 className="text-sm font-semibold text-foreground">Cannibalization Signals</h4>
                    <span className="text-xs text-muted-foreground">({cannibal.length})</span>
                    {cannibal.length > 0 && <Badge className="border-transparent bg-red-500/15 text-red-400">warning</Badge>}
                  </div>
                  <div className="rounded-md border border-white/5">
                    <div className="grid grid-cols-[1.5fr_1.5fr_1.5fr_1fr] gap-2 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      <span>Keyword</span><span>Page 1</span><span>Page 2</span><span className="text-right">Impr. split</span>
                    </div>
                    {cannibal.length ? cannibal.map((c, i) => (
                      <div key={i} className="grid grid-cols-[1.5fr_1.5fr_1.5fr_1fr] gap-2 border-t border-white/5 px-3 py-1.5 text-sm">
                        <span className="truncate text-foreground/90" title={c.query}>{c.query}</span>
                        <span className="truncate text-muted-foreground" title={c.pages[0]?.page}>{c.pages[0] ? shortUrl(c.pages[0].page) : "—"}</span>
                        <span className="truncate text-muted-foreground" title={c.pages[1]?.page}>{c.pages[1] ? shortUrl(c.pages[1].page) : "—"}</span>
                        <span className="text-right text-muted-foreground">{num(c.pages[0]?.impressions ?? 0)}/{num(c.pages[1]?.impressions ?? 0)}</span>
                      </div>
                    )) : <p className="px-3 py-2 text-xs text-muted-foreground">No cannibalization detected.</p>}
                  </div>

                  {/* New Keyword Opportunities */}
                  <SubHeading icon={Sparkles} title="New Keyword Opportunities" count={newKw.length} />
                  <div className="rounded-md border border-white/5">
                    <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-2 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      <span>Keyword</span><span className="text-right">Position</span><span className="text-right">Impr.</span><span className="text-right">Type</span>
                    </div>
                    {newKw.length ? newKw.map((k, i) => (
                      <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr] items-center gap-2 border-t border-white/5 px-3 py-1.5 text-sm">
                        <span className="truncate text-foreground/90" title={k.query}>{k.query}</span>
                        <span className="text-right text-muted-foreground">{k.position}</span>
                        <span className="text-right text-muted-foreground">{num(k.impressions)}</span>
                        <span className="flex justify-end">
                          <Badge className={k.type === "new" ? "border-transparent bg-emerald-500/15 text-emerald-400" : "border-transparent bg-cyan-500/15 text-cyan-400"}>{k.type}</Badge>
                        </span>
                      </div>
                    )) : <p className="px-3 py-2 text-xs text-muted-foreground">No new keyword opportunities.</p>}
                  </div>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
