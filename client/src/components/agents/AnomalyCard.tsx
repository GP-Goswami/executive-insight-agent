// A08 — AnomalyCard (standalone). Renders a single anomaly with a severity
// badge, the metric, % delta, root-cause explanation, and Acknowledge /
// Investigate actions. Investigate opens a self-contained detail modal.

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, TrendingDown, TrendingUp, Check, Search, Loader2, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

export interface Anomaly {
  id: string;
  tenantId: string;
  metric: string;
  severity: "P0" | "P1" | "P2";
  detectedAt?: string | null;
  value?: number | null;
  baseline?: number | null;
  delta?: number | null;
  rootCause?: string | null;
  status: "open" | "acknowledged" | "resolved";
}

interface AnomalyCardProps {
  anomaly: Anomaly;
  onStatusChange?: (anomaly: Anomaly) => void;
  onInvestigate?: (anomaly: Anomaly) => void;
}

const SEVERITY: Record<Anomaly["severity"], { label: string; badgeClass: string; accent: string }> = {
  P0: {
    label: "P0 · Critical",
    badgeClass: "border-transparent bg-red-500/15 text-red-400",
    accent: "border-l-red-500",
  },
  P1: {
    label: "P1 · Investigate",
    badgeClass: "border-transparent bg-amber-500/15 text-amber-400",
    accent: "border-l-amber-500",
  },
  P2: {
    label: "P2 · Monitor",
    badgeClass: "border-transparent bg-muted text-muted-foreground",
    accent: "border-l-muted-foreground/40",
  },
};

function formatMetric(metric: string): string {
  return metric.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-xs font-medium text-foreground">{value}</span>
    </div>
  );
}

export function AnomalyCard({ anomaly, onStatusChange, onInvestigate }: AnomalyCardProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const sev = SEVERITY[anomaly.severity];
  const delta = anomaly.delta ?? 0;
  const isDrop = delta < 0;

  const mutation = useMutation({
    mutationFn: async (status: Anomaly["status"]) => {
      const res = await apiRequest("PATCH", `/api/agents/anomalies/${anomaly.id}`, { status });
      return (await res.json()) as Anomaly;
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents/anomalies"] });
      onStatusChange?.(updated);
    },
  });

  const isResolved = anomaly.status === "resolved";
  const isAcknowledged = anomaly.status === "acknowledged";

  return (
    <>
      <Card
        className={cn("border-white/10 bg-card/50 backdrop-blur-sm border-l-4", sev.accent)}
        data-testid={`anomaly-card-${anomaly.id}`}
      >
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0" />
              <h3 className="font-semibold text-foreground truncate" data-testid="anomaly-metric">
                {formatMetric(anomaly.metric)}
              </h3>
            </div>
            <Badge className={cn("shrink-0", sev.badgeClass)} data-testid="anomaly-severity">
              {sev.label}
            </Badge>
          </div>

          <div className="mt-3 flex items-baseline gap-2">
            <span
              className={cn(
                "flex items-center gap-1 text-2xl font-bold font-mono",
                anomaly.severity === "P0" ? "text-red-400" : isDrop ? "text-amber-400" : "text-foreground",
              )}
              data-testid="anomaly-delta"
            >
              {isDrop ? <TrendingDown className="h-5 w-5" /> : <TrendingUp className="h-5 w-5" />}
              {delta > 0 ? "+" : ""}
              {delta.toFixed(1)}%
            </span>
            <span className="text-xs text-muted-foreground">
              now {fmt(anomaly.value)} vs baseline {fmt(anomaly.baseline)}
            </span>
          </div>

          {anomaly.rootCause && (
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed" data-testid="anomaly-root-cause">
              {anomaly.rootCause}
            </p>
          )}

          <div className="mt-4 flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={mutation.isPending || isAcknowledged || isResolved}
              onClick={() => mutation.mutate("acknowledged")}
              data-testid="anomaly-acknowledge"
            >
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {isAcknowledged ? "Acknowledged" : "Acknowledge"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setModalOpen(true); onInvestigate?.(anomaly); }}
              data-testid="anomaly-investigate"
            >
              <Search className="h-4 w-4" />
              Investigate
            </Button>
            {isResolved && <span className="ml-auto text-xs text-green-400">Resolved</span>}
          </div>
        </CardContent>
      </Card>

      {/* Investigate modal — self-contained, no parent wiring needed */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg border-white/10 bg-card">
          <DialogHeader>
            <div className="flex items-center justify-between gap-3">
              <DialogTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                {formatMetric(anomaly.metric)}
              </DialogTitle>
              <Badge className={cn("shrink-0", sev.badgeClass)}>{sev.label}</Badge>
            </div>
          </DialogHeader>

          <div className="mt-2 space-y-4">
            {/* Delta */}
            <div className="flex items-baseline gap-3">
              <span
                className={cn(
                  "flex items-center gap-1 text-2xl font-bold font-mono",
                  anomaly.severity === "P0" ? "text-red-400" : isDrop ? "text-amber-400" : "text-foreground",
                )}
              >
                {isDrop ? <TrendingDown className="h-5 w-5" /> : <TrendingUp className="h-5 w-5" />}
                {delta > 0 ? "+" : ""}{delta.toFixed(1)}%
              </span>
              <span className="text-xs text-muted-foreground">
                current {fmt(anomaly.value)} vs baseline {fmt(anomaly.baseline)}
              </span>
            </div>

            {/* Detail grid */}
            <div className="rounded-md border border-white/5 bg-muted/20 p-3 space-y-2">
              <DetailRow label="Metric" value={formatMetric(anomaly.metric)} />
              <DetailRow label="Severity" value={sev.label} />
              <DetailRow label="Status" value={anomaly.status} />
              {anomaly.detectedAt && (
                <DetailRow label="Detected" value={new Date(anomaly.detectedAt).toLocaleString()} />
              )}
            </div>

            {/* Root cause */}
            {anomaly.rootCause && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">Root Cause</p>
                <p className="text-sm leading-relaxed text-foreground">{anomaly.rootCause}</p>
              </div>
            )}
          </div>

          <div className="mt-4 flex justify-end">
            <DialogClose asChild>
              <Button size="sm" variant="outline">
                <X className="h-4 w-4" />
                Close
              </Button>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
