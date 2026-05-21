import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Zap } from "lucide-react";

const TARGET_CTR = 0.05; // 5%

interface PageRow {
  page?: string;
  url?: string;
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

interface CtrOpportunityProps {
  pages: PageRow[] | null | undefined;
  totalClicks: number;
}

interface OpportunityPage {
  page: string;
  impressions: number;
  currentCtr: number;
  currentClicks: number;
  potentialClicks: number;
  clickGap: number;
  opportunityScore: number;
}

function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, "") || "/";
    return path.length > 50 ? path.slice(0, 47) + "…" : path;
  } catch {
    return url.length > 50 ? url.slice(0, 47) + "…" : url;
  }
}

function ctrColor(ctr: number): string {
  if (ctr < 0.5) return "text-red-400";
  if (ctr < 2) return "text-amber-400";
  return "text-emerald-400";
}

function ctrBg(ctr: number): string {
  if (ctr < 0.5) return "bg-red-500/10 border-red-400/20";
  if (ctr < 2) return "bg-amber-500/10 border-amber-400/20";
  return "bg-emerald-500/10 border-emerald-400/20";
}

function computeOpportunities(pages: PageRow[], totalClicks: number): OpportunityPage[] {
  return pages
    .filter((p) => {
      const imp = p.impressions ?? 0;
      const ctr = p.ctr ?? 0;
      return imp > 500 && ctr < 2;
    })
    .map((p) => {
      const page = p.page ?? p.url ?? "";
      const impressions = p.impressions!;
      const currentCtr = p.ctr!;
      const currentClicks = p.clicks ?? Math.round(impressions * currentCtr / 100);
      const potentialClicks = Math.round(impressions * TARGET_CTR);
      const clickGap = Math.max(0, potentialClicks - currentClicks);
      const opportunityScore = totalClicks > 0 ? (clickGap / totalClicks) * 100 : 0;
      return { page, impressions, currentCtr, currentClicks, potentialClicks, clickGap, opportunityScore };
    })
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 5);
}

export function CtrOpportunity({ pages, totalClicks }: CtrOpportunityProps) {
  const isUnavailable =
    !pages ||
    pages.length === 0 ||
    pages.every((p) => p.impressions === undefined);

  if (isUnavailable) {
    return (
      <Card className="border-white/10 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-2">
            <Zap className="h-4 w-4" />
            CTR Opportunities
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground italic py-2">
            Data unavailable — page-level impressions and CTR data required.
          </p>
        </CardContent>
      </Card>
    );
  }

  const opportunities = computeOpportunities(pages, totalClicks);
  const topOpportunityIdx = opportunities.reduce(
    (best, op, i) => (op.opportunityScore > (opportunities[best]?.opportunityScore ?? 0) ? i : best),
    0
  );
  const totalPotentialGain = opportunities.reduce((sum, op) => sum + op.clickGap, 0);

  return (
    <Card className="border-white/10 bg-card/50 backdrop-blur-sm" data-testid="ctr-opportunity">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          <Zap className="h-4 w-4" />
          CTR Opportunities
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {opportunities.length === 0 ? (
          <p className="text-sm text-muted-foreground italic py-2">
            No high-impression, low-CTR pages detected — site CTR is performing well.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="ctr-opportunity-table">
                <thead>
                  <tr className="border-b border-border/40">
                    <th className="text-left py-2.5 px-3 text-muted-foreground font-medium text-xs">Page</th>
                    <th className="text-right py-2.5 px-3 text-muted-foreground font-medium text-xs">Impressions</th>
                    <th className="text-right py-2.5 px-3 text-muted-foreground font-medium text-xs">Current CTR</th>
                    <th className="text-right py-2.5 px-3 text-muted-foreground font-medium text-xs">Potential Clicks</th>
                    <th className="text-right py-2.5 px-3 text-muted-foreground font-medium text-xs">Opp. Score</th>
                  </tr>
                </thead>
                <tbody>
                  {opportunities.map((op, i) => (
                    <tr
                      key={i}
                      className="border-b border-border/20 last:border-0 hover:bg-muted/10 transition-colors"
                      data-testid={`ctr-row-${i}`}
                    >
                      <td className="py-2.5 px-3 font-medium text-foreground/90 max-w-[200px]">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-xs" title={op.page}>
                            {shortenUrl(op.page)}
                          </span>
                          {i === topOpportunityIdx && (
                            <Badge className="bg-amber-500/15 text-amber-400 border border-amber-400/30 text-[9px] font-bold shrink-0">
                              Quick Win
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="text-right py-2.5 px-3 font-mono text-xs text-foreground/80">
                        {op.impressions.toLocaleString()}
                      </td>
                      <td className="text-right py-2.5 px-3">
                        <span
                          className={`inline-block text-xs font-semibold font-mono px-1.5 py-0.5 rounded border ${ctrBg(op.currentCtr)} ${ctrColor(op.currentCtr)}`}
                        >
                          {op.currentCtr.toFixed(2)}%
                        </span>
                      </td>
                      <td className="text-right py-2.5 px-3 font-mono text-xs text-emerald-400">
                        +{op.potentialClicks.toLocaleString()}
                      </td>
                      <td className="text-right py-2.5 px-3 font-mono text-xs text-foreground/80">
                        {op.opportunityScore.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Summary line */}
            <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-400/20 rounded-lg px-3 py-2.5">
              <Zap className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <p className="text-xs text-emerald-300/90 font-medium">
                Total opportunity: +{totalPotentialGain.toLocaleString()} clicks if top {opportunities.length} page{opportunities.length > 1 ? "s" : ""} reach {(TARGET_CTR * 100).toFixed(0)}% CTR
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
