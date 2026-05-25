// A08 — AnomalySection. A collapsible wrapper that groups AnomalyCards above
// the Executive Verdict on the report. Renders nothing when there are no
// anomalies. Collapsed by default when only P2 (low-priority) anomalies exist.
// Includes a "Run Anomaly Check" button that triggers a fresh detection run.

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, AlertTriangle, RefreshCw, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AnomalyCard, type Anomaly } from "./AnomalyCard";

export type { Anomaly } from "./AnomalyCard";

const SEVERITY_ORDER: Record<Anomaly["severity"], number> = { P0: 0, P1: 1, P2: 2 };

const COUNT_BADGE: Record<Anomaly["severity"], string> = {
  P0: "border-transparent bg-red-500/15 text-red-400",
  P1: "border-transparent bg-amber-500/15 text-amber-400",
  P2: "border-transparent bg-muted text-muted-foreground",
};

interface AnomalySectionProps {
  anomalies: Anomaly[];
  /** Identifier used for the detection run + (server-side) anomaly scoping. */
  tenantId?: string;
}

export function AnomalySection({ anomalies, tenantId }: AnomalySectionProps) {
  const { toast } = useToast();

  // Expanded by default when anything actionable (P0/P1) is present; collapsed
  // when only P2 anomalies exist.
  const hasCritical = anomalies.some((a) => a.severity === "P0" || a.severity === "P1");
  const [open, setOpen] = useState(hasCritical);

  const runCheck = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/agents/anomaly/run", { tenantId });
      return res.json();
    },
    onSuccess: (result: { findings?: { anomalies_found?: number } }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents/anomalies"] });
      toast({
        title: "Anomaly check complete",
        description: `${result?.findings?.anomalies_found ?? 0} anomalies found.`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Anomaly check failed", description: err.message, variant: "destructive" });
    },
  });

  // Only render if there are anomalies to show.
  if (anomalies.length === 0) return null;

  const sorted = [...anomalies].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const counts: Record<Anomaly["severity"], number> = { P0: 0, P1: 0, P2: 0 };
  for (const a of anomalies) counts[a.severity]++;

  return (
    <section data-testid="anomaly-section">
      <Card className="border-white/10 bg-card/50 backdrop-blur-sm">
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="flex items-center gap-2 min-w-0 text-left"
              data-testid="anomaly-section-toggle"
              aria-expanded={open}
            >
              {open ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
              <span className="font-semibold text-foreground">Anomalies</span>
              <span className="flex items-center gap-1.5">
                {(["P0", "P1", "P2"] as const).map((sev) =>
                  counts[sev] > 0 ? (
                    <Badge key={sev} className={COUNT_BADGE[sev]} data-testid={`anomaly-count-${sev}`}>
                      {counts[sev]} {sev}
                    </Badge>
                  ) : null,
                )}
              </span>
            </button>

            <Button
              size="sm"
              variant="outline"
              disabled={runCheck.isPending || !tenantId}
              onClick={() => runCheck.mutate()}
              data-testid="anomaly-run-check"
            >
              {runCheck.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {runCheck.isPending ? "Running..." : "Run Anomaly Check"}
            </Button>
          </div>

          {open && (
            <div className="mt-4 grid grid-cols-1 gap-3" data-testid="anomaly-section-list">
              {sorted.map((a) => (
                <AnomalyCard key={a.id} anomaly={a} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
