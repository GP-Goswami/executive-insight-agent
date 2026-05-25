// A12 — EmailDraftCard (standalone).
// Shows an AI-drafted cover email for analyst review. The analyst can edit
// the subject/body, then approve or discard. Approved ≠ sent — sending is a
// separate, explicit action that is NOT implemented here (per spec).

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Mail, Pencil, Save, CheckCircle2, Trash2, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export interface EmailDraft {
  id: string;
  tenantId: string;
  reportDraftId: string | null;
  subject: string;
  body: string;
  status: string;
  analystEdit: string | null;
  createdAt: string | null;
}

const STATUS_META: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "border-transparent bg-amber-500/15 text-amber-400" },
  analyst_approved: { label: "Approved", className: "border-transparent bg-green-500/15 text-green-400" },
  sent: { label: "Sent", className: "border-transparent bg-cyan-500/15 text-cyan-400" },
  discarded: { label: "Discarded", className: "border-transparent bg-muted text-muted-foreground" },
};

interface EmailDraftCardProps {
  emailDraft: EmailDraft;
  /** Called after any successful mutation so parent can refresh. */
  onUpdated?: () => void;
}

export function EmailDraftCard({ emailDraft, onUpdated }: EmailDraftCardProps) {
  const { toast } = useToast();

  // Display the analyst edit if present, otherwise original AI draft
  const displaySubject = emailDraft.analystEdit
    ? tryParseEdit(emailDraft.analystEdit)?.subject ?? emailDraft.subject
    : emailDraft.subject;
  const displayBody = emailDraft.analystEdit
    ? tryParseEdit(emailDraft.analystEdit)?.body ?? emailDraft.body
    : emailDraft.body;

  const [editing, setEditing] = useState(false);
  const [draftSubject, setDraftSubject] = useState(displaySubject);
  const [draftBody, setDraftBody] = useState(displayBody);

  const statusMeta = STATUS_META[emailDraft.status] ?? STATUS_META.draft;
  const isDiscarded = emailDraft.status === "discarded";
  const isApproved = emailDraft.status === "analyst_approved" || emailDraft.status === "sent";

  const mutation = useMutation({
    mutationFn: async (body: { status?: string; analystEdit?: string }) => {
      const res = await apiRequest("PATCH", `/api/agents/communication/${emailDraft.id}`, body);
      return res.json();
    },
    onSuccess: (_data, variables) => {
      setEditing(false);
      const titles: Record<string, string> = {
        analyst_approved: "Email approved — ready to send",
        discarded: "Email discarded",
        draft: "Changes saved",
      };
      toast({ title: titles[variables.status ?? "draft"] ?? "Updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/agents/communication"] });
      onUpdated?.();
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const pending = mutation.isPending;

  function handleSaveEdit() {
    // Store subject+body together as JSON in analystEdit
    mutation.mutate({
      status: "draft",
      analystEdit: JSON.stringify({ subject: draftSubject.trim(), body: draftBody.trim() }),
    });
  }

  return (
    <Card className={cn("border-white/10 bg-card/50 backdrop-blur-sm", isDiscarded && "opacity-50")}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Mail className="h-4 w-4 shrink-0 text-primary" />
            <CardTitle className="truncate text-sm font-medium text-foreground">
              Cover Email Draft
            </CardTitle>
          </div>
          <Badge className={cn("shrink-0 text-xs", statusMeta.className)}>
            {statusMeta.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {editing ? (
          <>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Subject</p>
              <Input
                value={draftSubject}
                onChange={(e) => setDraftSubject(e.target.value)}
                className="text-sm"
                placeholder="Email subject line"
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Body</p>
              <Textarea
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                rows={6}
                className="text-sm leading-relaxed"
                placeholder="Email body…"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="default" disabled={pending || !draftSubject.trim() || !draftBody.trim()} onClick={handleSaveEdit}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setDraftSubject(displaySubject); setDraftBody(displayBody); setEditing(false); }}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <>
            {/* Subject */}
            <div className="rounded-md border border-white/5 bg-muted/20 px-3 py-2">
              <p className="mb-0.5 text-xs text-muted-foreground">Subject</p>
              <p className="text-sm font-medium text-foreground">{displaySubject}</p>
            </div>

            {/* Body */}
            <div className="rounded-md border border-white/5 bg-muted/20 px-3 py-2">
              <p className="mb-1 text-xs text-muted-foreground">Body</p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{displayBody}</p>
            </div>

            {emailDraft.analystEdit && (
              <p className="text-xs text-cyan-400">Analyst-edited version shown above</p>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-2 border-t border-white/5 pt-3">
              <Button
                size="sm"
                variant="default"
                disabled={pending || isApproved || isDiscarded}
                onClick={() => mutation.mutate({ status: "analyst_approved" })}
              >
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Approve to Send
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending || isDiscarded || isApproved}
                onClick={() => setEditing(true)}
              >
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending || isDiscarded}
                onClick={() => mutation.mutate({ status: "discarded" })}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
                Discard
              </Button>
            </div>

            {isApproved && (
              <p className="text-xs text-green-400">
                Approved — email is ready. Sending must be triggered separately.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function tryParseEdit(raw: string): { subject: string; body: string } | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.subject === "string" && typeof parsed?.body === "string") return parsed;
  } catch {
    // not JSON — legacy plain-text edit
  }
  return null;
}
