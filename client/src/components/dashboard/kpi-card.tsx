import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, ArrowRight, LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  title: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  icon?: LucideIcon;
  accent?: "cyan" | "purple" | "green" | "amber";
  showTrend?: boolean;
  invertColors?: boolean;
}

export function KpiCard({
  title,
  value,
  change,
  changeLabel = "vs last period",
  icon: Icon,
  accent = "cyan",
  showTrend = true,
  invertColors = false,
}: KpiCardProps) {
  const rawPositive = change !== undefined && change > 0;
  const rawNegative = change !== undefined && change < 0;

  // For metrics where lower = better (e.g. Avg Position), flip the color meaning
  const isPositive = invertColors ? rawNegative : rawPositive;
  const isNegative = invertColors ? rawPositive : rawNegative;
  const isNeutral = !rawPositive && !rawNegative;

  const accentColors = {
    cyan: "group-hover:glow-cyan-sm",
    purple: "group-hover:glow-purple",
    green: "group-hover:shadow-green-500/20",
    amber: "group-hover:shadow-amber-500/20",
  };

  const iconColors = {
    cyan: "text-cyan-400",
    purple: "text-purple-400",
    green: "text-green-400",
    amber: "text-amber-400",
  };

  return (
    <Card
      className={cn(
        "group transition-all duration-300 border-white/10 bg-card/50 backdrop-blur-sm",
        accentColors[accent]
      )}
      data-testid={`kpi-card-${title.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide truncate">
              {title}
            </p>
            <p className="mt-2 text-3xl font-bold tracking-tight text-foreground font-mono">
              {typeof value === "number" ? value.toLocaleString() : value}
            </p>
            {showTrend && (
              <div className="mt-2 flex items-center gap-1.5">
                {isPositive && <TrendingUp className="h-4 w-4 text-green-400" />}
                {isNegative && <TrendingDown className="h-4 w-4 text-red-400" />}
                {isNeutral && <ArrowRight className="h-4 w-4 text-muted-foreground" />}
                <span
                  className={cn(
                    "text-sm font-medium",
                    isPositive && "text-green-400",
                    isNegative && "text-red-400",
                    isNeutral && "text-muted-foreground"
                  )}
                >
                  {change !== undefined
                    ? `${isPositive ? "+" : ""}${change.toFixed(1)}%`
                    : "—"}
                </span>
                <span className="text-xs text-muted-foreground">{changeLabel}</span>
              </div>
            )}
          </div>
          {Icon && (
            <div className={cn("p-3 rounded-xl bg-muted/50", iconColors[accent])}>
              <Icon className="h-6 w-6" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
