import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Layers } from "lucide-react";

interface KeywordRow {
  keyword?: string;
  query?: string;
  clicks?: number;
}

interface BrandSplitProps {
  keywords: KeywordRow[] | null | undefined;
  totalClicks: number;
  domain?: string;
}

function deriveBrandTerms(domain?: string): string[] {
  const base = ["truefirms", "true firms", "truefirm", "true firm"];
  if (!domain) return base;
  const root = domain.split(".")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  if (root && !base.includes(root)) {
    return [...base, root, root.replace(/([a-z])(?=[A-Z])/g, "$1 ")];
  }
  return base;
}

function isBrand(keyword: string, brandTerms: string[]): boolean {
  const kw = keyword.toLowerCase();
  return brandTerms.some((t) => kw.includes(t));
}

function getTrendText(nonBrandPct: number): { text: string; color: string } {
  if (nonBrandPct < 30)
    return { text: "⚠️ Heavy brand dependency — non-brand acquisition is weak", color: "text-amber-400" };
  if (nonBrandPct <= 60)
    return { text: "Balanced traffic mix — healthy brand and non-brand presence", color: "text-cyan-400" };
  return { text: "✓ Strong non-brand acquisition — SEO is driving organic discovery", color: "text-emerald-400" };
}

export function BrandSplit({ keywords, totalClicks, domain }: BrandSplitProps) {
  const brandTerms = deriveBrandTerms(domain);

  const isUnavailable =
    !keywords ||
    keywords.length === 0 ||
    keywords.every((k) => !k.keyword && !k.query);

  if (isUnavailable || totalClicks === 0) {
    return (
      <Card className="border-white/10 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-2">
            <Layers className="h-4 w-4" />
            Traffic Breakdown — Brand vs Non-Brand
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground italic py-2">
            Data unavailable — keyword-level click data is required for brand split analysis.
          </p>
        </CardContent>
      </Card>
    );
  }

  let brandClicks = 0;
  for (const kw of keywords) {
    const text = kw.keyword ?? kw.query ?? "";
    if (!text) continue;
    const clicks = kw.clicks ?? 0;
    if (isBrand(text, brandTerms)) brandClicks += clicks;
  }

  const nonBrandClicks = Math.max(0, totalClicks - brandClicks);
  const brandPct = totalClicks > 0 ? Math.round((brandClicks / totalClicks) * 100) : 0;
  const nonBrandPct = 100 - brandPct;
  const { text: trendText, color: trendColor } = getTrendText(nonBrandPct);

  return (
    <Card className="border-white/10 bg-card/50 backdrop-blur-sm" data-testid="brand-split">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          <Layers className="h-4 w-4" />
          Traffic Breakdown — Brand vs Non-Brand
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Stat blocks */}
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-xl bg-muted/10 border border-border/30 p-4 text-center" data-testid="brand-stat">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Brand</p>
            <p className="text-3xl font-bold text-purple-400 font-mono">{brandPct}%</p>
            <p className="text-xs text-muted-foreground mt-1">{brandClicks.toLocaleString()} clicks</p>
          </div>
          <div className="rounded-xl bg-muted/10 border border-border/30 p-4 text-center" data-testid="nonbrand-stat">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Non-Brand</p>
            <p className="text-3xl font-bold text-cyan-400 font-mono">{nonBrandPct}%</p>
            <p className="text-xs text-muted-foreground mt-1">{nonBrandClicks.toLocaleString()} clicks</p>
          </div>
        </div>

        {/* Stacked bar */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <div className="flex gap-3">
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className="inline-block w-2.5 h-2.5 rounded-sm bg-purple-500" />
                Brand
              </span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className="inline-block w-2.5 h-2.5 rounded-sm bg-cyan-500" />
                Non-Brand
              </span>
            </div>
          </div>
          <div
            className="w-full h-4 rounded-full overflow-hidden flex"
            data-testid="brand-bar"
            role="meter"
            aria-valuenow={brandPct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            {brandPct > 0 && (
              <div
                className="h-full bg-purple-500 transition-all"
                style={{ width: `${brandPct}%` }}
                title={`Brand: ${brandPct}%`}
              />
            )}
            {nonBrandPct > 0 && (
              <div
                className="h-full bg-cyan-500 transition-all"
                style={{ width: `${nonBrandPct}%` }}
                title={`Non-Brand: ${nonBrandPct}%`}
              />
            )}
          </div>
        </div>

        {/* Trend text */}
        <p className={`text-sm font-medium ${trendColor}`} data-testid="brand-trend-text">
          {trendText}
        </p>

        {/* Badge breakdown */}
        <div className="flex gap-2 flex-wrap">
          <Badge variant="outline" className="text-[10px] border-purple-400/30 text-purple-400 bg-purple-500/10">
            Brand terms: {brandTerms.slice(0, 4).join(", ")}
          </Badge>
          <Badge variant="outline" className="text-[10px] border-border/40 text-muted-foreground">
            Based on {keywords.filter((k) => k.keyword ?? k.query).length} keywords
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
