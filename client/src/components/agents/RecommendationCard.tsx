// A09 — RecommendationCard (standalone). One prioritised recommendation with
// evidence, effort/impact chips, owner-role badge, status, and analyst actions
// (Edit / Approve / Veto). Edits are stored as analystEdit; the original A09
// statement is preserved. Self-contained: PATCHes the API and refreshes the list.

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, X, Pencil, Loader2, Save } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export interface RecommendationEvidence {
  text?: string;
  effortHours?: number | null;
  impactDescription?: string;
  agentRunIds?: string[];
}

export interface Recommendation {
  id: string;
  tenantId: string;
  runId?: string | null;
  priority: number | null;
  statement: string;
  evidence?: RecommendationEvidence | string | null;
  effort?: string | null;
  impact?: string | null;
  ownerRole?: string | null;
  status: string; // pending_review | approved | vetoed | edited
  analystEdit?: string | null;
}

const LEVEL_CLASS: Record<string, string> = {
  high: "border-transparent bg-green-500/15 text-green-400",
  medium: "border-transparent bg-amber-500/15 text-amber-400",
  low: "border-transparent bg-muted text-muted-foreground",
};
// Effort is inverted: low effort is the "good" colour.
const EFFORT_CLASS: Record<string, string> = {
  low: "border-transparent bg-green-500/15 text-green-400",
  medium: "border-transparent bg-amber-500/15 text-amber-400",
  high: "border-transparent bg-red-500/15 text-red-400",
};

const STATUS_META: Record<string, { label: string; className: string }> = {
  pending_review: { label: "Pending", className: "border-transparent bg-amber-500/15 text-amber-400" },
  approved: { label: "Approved", className: "border-transparent bg-green-500/15 text-green-400" },
  vetoed: { label: "Vetoed", className: "border-transparent bg-red-500/15 text-red-400" },
  edited: { label: "Edited", className: "border-transparent bg-cyan-500/15 text-cyan-400" },
};

function readEvidence(ev: Recommendation["evidence"]): RecommendationEvidence {
  if (!ev) return {};
  if (typeof ev === "string") return { text: ev };
  return ev;
}

export function RecommendationCard({ recommendation }: { recommendation: Recommendation }) {
  const { toast } = useToast();
  const evidence = readEvidence(recommendation.evidence);
  const baseText = recommendation.analystEdit?.trim() ? recommendation.analystEdit : recommendation.statement;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(baseText);

  const status = STATUS_META[recommendation.status] ?? STATUS_META.pending_review;
  const isVetoed = recommendation.status === "vetoed";

  const mutation = useMutation({
    mutationFn: async (body: { status: string; analystEdit?: string }) => {
      const res = await apiRequest("PATCH", `/api/agents/recommendations/${recommendation.id}`, body);
      return res.json();
    },
    // Optimistic update — patch every cached recommendations list immediately so
    // approve/veto/edit feel instant; roll back on error, reconcile on settle.
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: ["/api/agents/recommendations"] });
      const previous = queryClient.getQueriesData<Recommendation[]>({ queryKey: ["/api/agents/recommendations"] });
      queryClient.setQueriesData<Recommendation[]>({ queryKey: ["/api/agents/recommendations"] }, (old) =>
        Array.isArray(old)
          ? old.map((r) =>
              r.id === recommendation.id
                ? { ...r, status: body.status, ...(body.analystEdit !== undefined ? { analystEdit: body.analystEdit } : {}) }
                : r,
            )
          : old,
      );
      return { previous };
    },
    onError: (err: Error, _body, context) => {
      context?.previous?.forEach(([key, data]) => queryClient.setQueryData<Recommendation[]>(key, data));
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
    onSuccess: (_data, variables) => {
      setEditing(false);
      toast({ title: `Recommendation ${variables.status}` });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents/recommendations"] });
    },
  });

  const pending = mutation.isPending;

  return (
    <Card
      className={cn("border-white/10 bg-card/50 backdrop-blur-sm", isVetoed && "opacity-60")}
      data-testid={`recommendation-card-${recommendation.id}`}
    >
      <CardContent className="p-5">
        <div className="flex items-start gap-3">
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary"
            data-testid="recommendation-priority"
          >
            {recommendation.priority ?? "-"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              {editing ? (
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={2}
                  className="flex-1"
                  data-testid="recommendation-edit-input"
                />
              ) : (
                <p className={cn("font-semibold text-foreground", isVetoed && "line-through")} data-testid="recommendation-statement">
                  {baseText}
                  {recommendation.analystEdit?.trim() && (
                    <span className="ml-2 text-xs font-normal text-cyan-400">(edited)</span>
                  )}
                </p>
              )}
              <Badge className={cn("shrink-0", status.className)} data-testid="recommendation-status">
                {status.label}
              </Badge>
            </div>

            {/* Evidence */}
            {evidence.text && (
              <p className="mt-2 text-sm italic text-muted-foreground" data-testid="recommendation-evidence">
                {evidence.text}
              </p>
            )}
            {evidence.impactDescription && (
              <p className="mt-1 text-xs text-muted-foreground">{evidence.impactDescription}</p>
            )}

            {/* Chips */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge className={EFFORT_CLASS[recommendation.effort ?? "medium"] ?? EFFORT_CLASS.medium}>
                Effort: {recommendation.effort ?? "—"}
                {evidence.effortHours != null ? ` (${evidence.effortHours}h)` : ""}
              </Badge>
              <Badge className={LEVEL_CLASS[recommendation.impact ?? "medium"] ?? LEVEL_CLASS.medium}>
                Impact: {recommendation.impact ?? "—"}
              </Badge>
              {recommendation.ownerRole && (
                <Badge variant="secondary" data-testid="recommendation-owner">
                  {recommendation.ownerRole}
                </Badge>
              )}
            </div>

            {/* Actions */}
            <div className="mt-4 flex items-center gap-2">
              {editing ? (
                <>
                  <Button
                    size="sm"
                    variant="default"
                    disabled={pending || !draft.trim()}
                    onClick={() => mutation.mutate({ status: "edited", analystEdit: draft.trim() })}
                    data-testid="recommendation-save"
                  >
                    {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setDraft(baseText); setEditing(false); }}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(true)} data-testid="recommendation-edit">
                    <Pencil className="h-4 w-4" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending || recommendation.status === "approved"}
                    onClick={() => mutation.mutate({ status: "approved" })}
                    data-testid="recommendation-approve"
                  >
                    <Check className="h-4 w-4" />
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending || isVetoed}
                    onClick={() => mutation.mutate({ status: "vetoed" })}
                    data-testid="recommendation-veto"
                  >
                    <X className="h-4 w-4" />
                    Veto
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
