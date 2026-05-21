import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, Microscope } from "lucide-react";

interface MetricsSummary {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  users: number;
  sessions: number;
}

interface Cause {
  rank: number;
  name: string;
  confidence: number;
  evidence: string;
}

interface RootCauseAnalysisProps {
  metrics: MetricsSummary | null | undefined;
  previousUsers?: number;
}

function computeCauses(m: MetricsSummary, previousUsers?: number): Cause[] {
  const raw: Omit<Cause, "rank">[] = [];

  if (m.users > 0 && m.users * 3.5 < m.clicks) {
    raw.push({
      name: "Tracking Anomaly",
      confidence: 85,
      evidence: `GA4: ${m.users.toLocaleString()} users vs GSC: ${m.clicks.toLocaleString()} clicks (${(m.clicks / m.users).toFixed(1)}x gap)`,
    });
  }

  if (m.impressions > 50_000 && m.ctr < 1) {
    raw.push({
      name: "AI Zero-Click Impact",
      confidence: 70,
      evidence: `${m.impressions.toLocaleString()} impressions at ${m.ctr.toFixed(2)}% CTR — users finding answers without clicking`,
    });
  }

  if (m.impressions > 10_000 && m.ctr < 2) {
    raw.push({
      name: "CTR Issue",
      confidence: 65,
      evidence: `${m.ctr.toFixed(2)}% CTR across ${m.impressions.toLocaleString()} impressions — well below the 3% industry benchmark`,
    });
  }

  if (previousUsers !== undefined && previousUsers > 0 && m.users < previousUsers * 0.5) {
    const drop = ((1 - m.users / previousUsers) * 100).toFixed(0);
    raw.push({
      name: "Traffic Source Decline",
      confidence: 60,
      evidence: `Traffic dropped from ${previousUsers.toLocaleString()} to ${m.users.toLocaleString()} users (${drop}% decline)`,
    });
  }

  if (m.position > 30) {
    raw.push({
      name: "Technical SEO Issue",
      confidence: 55,
      evidence: `Average search position ${m.position.toFixed(1)} — site is ranking outside the top 30 results`,
    });
  }

  return raw
    .sort((a, b) => b.confidence - a.confidence)
    .map((c, i) => ({ ...c, rank: i + 1 }));
}

function confidenceColor(confidence: number): string {
  if (confidence > 75) return "bg-emerald-400";
  if (confidence >= 50) return "bg-amber-400";
  return "bg-red-400";
}

function confidenceBadge(confidence: number): string {
  if (confidence > 75) return "bg-emerald-500/15 text-emerald-400 border-emerald-400/30";
  if (confidence >= 50) return "bg-amber-500/15 text-amber-400 border-amber-400/30";
  return "bg-red-500/15 text-red-400 border-red-400/30";
}

function buildEvidenceBullets(causes: Cause[], m: MetricsSummary): string[] {
  if (causes.length === 0) return [];
  const top = causes[0];
  const bullets: string[] = [top.evidence];

  // Add supporting context from the top 2 causes
  if (causes.length > 1) bullets.push(causes[1].evidence);

  // Always add a volume context bullet
  bullets.push(
    `Site received ${m.impressions.toLocaleString()} impressions and ${m.clicks.toLocaleString()} clicks with ${m.ctr.toFixed(2)}% CTR at avg position ${m.position.toFixed(1)}`
  );

  return bullets.slice(0, 3);
}

export function RootCauseAnalysis({ metrics, previousUsers }: RootCauseAnalysisProps) {
  if (!metrics) {
    return (
      <Card className="border-white/10 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-2">
            <Microscope className="h-4 w-4" />
            Why This Happened
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground italic">Data unavailable — connect GA4 and GSC to enable root cause analysis.</p>
        </CardContent>
      </Card>
    );
  }

  const causes = computeCauses(metrics, previousUsers);
  const evidenceBullets = buildEvidenceBullets(causes, metrics);

  return (
    <Card className="border-white/10 bg-card/50 backdrop-blur-sm" data-testid="root-cause-analysis">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          <Microscope className="h-4 w-4" />
          Why This Happened
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {causes.length === 0 ? (
          <div className="flex items-center gap-3 py-4">
            <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
            <p className="text-sm text-emerald-400 font-medium">
              No anomalies detected — data looks healthy ✓
            </p>
          </div>
        ) : (
          <>
            <ul className="space-y-3">
              {causes.map((cause) => (
                <li key={cause.rank} className="flex items-start gap-3" data-testid={`cause-${cause.rank}`}>
                  <span className="text-xs font-bold text-muted-foreground bg-muted/30 rounded-full w-5 h-5 flex items-center justify-center shrink-0 mt-0.5">
                    {cause.rank}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-sm font-semibold text-foreground/90">{cause.name}</span>
                      <Badge className={`${confidenceBadge(cause.confidence)} border text-[10px] font-bold shrink-0`}>
                        {cause.confidence}% confident
                      </Badge>
                    </div>
                    {/* Confidence bar */}
                    <div className="w-full h-1 rounded-full bg-muted/30 overflow-hidden mb-2">
                      <div
                        className={`h-full rounded-full ${confidenceColor(cause.confidence)} transition-all`}
                        style={{ width: `${cause.confidence}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{cause.evidence}</p>
                  </div>
                </li>
              ))}
            </ul>

            {/* Evidence subsection */}
            {evidenceBullets.length > 0 && (
              <div className="border-t border-border/30 pt-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Evidence</p>
                </div>
                <ul className="space-y-1.5">
                  {evidenceBullets.map((bullet, i) => (
                    <li key={i} className="text-xs text-muted-foreground pl-3 border-l-2 border-amber-400/30 leading-relaxed">
                      {bullet}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
