import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { DataTable, Column } from "@/components/dashboard/data-table";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  MessageSquare,
  TrendingUp,
  TrendingDown,
  Target,
  Percent,
  Play,
  Plus,
  AlertCircle,
  CheckCircle,
  XCircle,
  Clock,
  Sparkles,
  Building2,
  Loader2,
  Trash2,
  Edit2,
  Bot,
  Zap,
  Eye,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useDomain } from "@/hooks/use-domain";
import type { DateRange } from "react-day-picker";
import { subDays, format } from "date-fns";

interface PromptSet {
  id: string;
  clientId: string | null;
  name: string;
  description: string | null;
  createdAt: string;
}

interface Prompt {
  id: string;
  promptSetId: string;
  promptText: string;
  geo: string;
  language: string;
  category: string | null;
  priority: number;
  createdAt: string;
  lastRun?: {
    id: string;
    status: string;
    runAt: string;
    responseText: string | null;
  } | null;
  mention?: {
    mentionFound: number;
    mentionScore: number;
    contextSnippet: string | null;
    competitorFoundJson: string[] | null;
    sentiment: string | null;
  } | null;
}

interface BrandEntity {
  id: string;
  clientId: string | null;
  brandName: string;
  domainsJson: string[] | null;
  synonymsJson: string[] | null;
  competitorsJson: string[] | null;
  createdAt: string;
}

interface Stats {
  totalPrompts: number;
  totalRuns: number;
  completedRuns: number;
  coverage: number;
  avgScore: number;
  mentionCount: number;
  promptsMissing: Prompt[];
}

// ── AEO types ──────────────────────────────────────────────────────────────────

interface AeoEngineResult {
  citationShare: number;
  mentionsFound: number;
}

interface AeoAggregates {
  citationShare: number;
  avgPosition: number;
  totalRuns: number;
  mentionsFound: number;
}

interface AeoRunRow {
  id: string;
  query: string;
  engine: string;
  cited: number;
  position: number | null;
  context: string | null;
  excerpt: string | null;
  brandEntity: string;
  createdAt: string | null;
}

interface AeoResults {
  aggregates: AeoAggregates;
  byEngine: Record<string, AeoEngineResult>;
  recentResults: AeoRunRow[];
}

interface AeoQueryResult {
  query: string;
  chatgpt: { cited: boolean; position: number | null; excerpt: string | null } | null;
  claude:  { cited: boolean; position: number | null; excerpt: string | null } | null;
  gemini:  { cited: boolean; position: number | null; excerpt: string | null } | null;
}

// v2 key forces fresh defaults when user upgrades (old localStorage key is abandoned)
const DEFAULT_AEO_QUERIES = [
  // Type A — Direct brand queries (high citation probability)
  "What is TrueFirms?",
  "Tell me about truefirms.co",
  "Is TrueFirms a good platform?",
  // Type B — Category queries (competitive landscape)
  "best B2B service marketplace platforms",
  "alternatives to Clutch.co",
  "top IT staffing platforms 2024",
  // Type C — Use-case queries
  "where can I find verified software companies",
  "how to hire outsourced development teams",
];
const DEFAULT_AEO_BRANDS = ["TrueFirms"];

const LS_QUERIES_KEY = "aeo_queries_v2";
const LS_BRANDS_KEY  = "aeo_brands_v1";

function useLocalStorageList(key: string, defaults: string[]): [string[], (v: string[]) => void] {
  const [items, setItems] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw) as string[];
    } catch {}
    return defaults;
  });
  const save = (v: string[]) => {
    setItems(v);
    try { localStorage.setItem(key, JSON.stringify(v)); } catch {}
  };
  return [items, save];
}

// ── Engine status card ─────────────────────────────────────────────────────────

function EngineCard({ name, icon, data }: {
  name: string;
  icon: React.ReactNode;
  data?: AeoEngineResult;
}) {
  const share = data?.citationShare ?? null;
  const color = share === null ? "text-muted-foreground" : share >= 60 ? "text-emerald-400" : share >= 30 ? "text-amber-400" : "text-red-400";
  return (
    <Card className="bg-card border-white/10 flex-1">
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center gap-2 mb-2">
          {icon}
          <span className="text-sm font-medium text-foreground">{name}</span>
        </div>
        {data ? (
          <>
            <p className={`text-2xl font-bold ${color}`}>{share}%</p>
            <p className="text-xs text-muted-foreground">cited · {data.mentionsFound} mention{data.mentionsFound !== 1 ? "s" : ""}</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No data yet</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function AiMentionsPage() {
  const { ga4PropertyId } = useDomain();
  const { toast } = useToast();
  const [selectedPromptSetId, setSelectedPromptSetId] = useState<string | null>(null);
  const [selectedBrandEntityId, setSelectedBrandEntityId] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 30),
    to: subDays(new Date(), 1),
  });
  const [appliedRange, setAppliedRange] = useState<DateRange | undefined>(dateRange);
  const [showNewPromptSetDialog, setShowNewPromptSetDialog] = useState(false);
  const [showNewPromptDialog, setShowNewPromptDialog] = useState(false);
  const [showNewBrandDialog, setShowNewBrandDialog] = useState(false);
  const [newPromptSetName, setNewPromptSetName] = useState("");
  const [newPromptSetDescription, setNewPromptSetDescription] = useState("");
  const [newPromptText, setNewPromptText] = useState("");
  const [newPromptCategory, setNewPromptCategory] = useState("");
  const [newBrandName, setNewBrandName] = useState("");
  const [newBrandSynonyms, setNewBrandSynonyms] = useState("");
  const [newBrandCompetitors, setNewBrandCompetitors] = useState("");

  // ── AEO state ────────────────────────────────────────────────────────────────
  const [aeoQueries, setAeoQueries] = useLocalStorageList(LS_QUERIES_KEY, DEFAULT_AEO_QUERIES);
  const [aeoBrands, setAeoBrands]   = useLocalStorageList(LS_BRANDS_KEY, DEFAULT_AEO_BRANDS);
  const [aeoRunning, setAeoRunning] = useState(false);
  const [aeoRunResults, setAeoRunResults] = useState<AeoQueryResult[] | null>(null);
  const [aeoEngineStatus, setAeoEngineStatus]   = useState<Record<string, boolean>>({});
  const [aeoEngineErrors, setAeoEngineErrors]   = useState<Record<string, string>>({});
  const [aeoResponseTexts, setAeoResponseTexts] = useState<Record<string, Record<string, string>>>({});
  const [debugMode, setDebugMode]               = useState(false);
  const [expandedRows, setExpandedRows]         = useState<Set<number>>(new Set());
  const [newAeoQuery, setNewAeoQuery] = useState("");
  const [newAeoBrand, setNewAeoBrand] = useState("");
  const [selectedAeoBrand, setSelectedAeoBrand] = useState<string>(() => DEFAULT_AEO_BRANDS[0]);

  const { data: aeoData, refetch: refetchAeo } = useQuery<AeoResults>({
    queryKey: ["/api/agents/aeo/results", ga4PropertyId, selectedAeoBrand],
    queryFn: async () => {
      if (!ga4PropertyId) return { aggregates: { citationShare: 0, avgPosition: 0, totalRuns: 0, mentionsFound: 0 }, byEngine: {}, recentResults: [] };
      const res = await fetch(`/api/agents/aeo/results?tenantId=${encodeURIComponent(ga4PropertyId)}&brandEntity=${encodeURIComponent(selectedAeoBrand)}`);
      if (!res.ok) return { aggregates: { citationShare: 0, avgPosition: 0, totalRuns: 0, mentionsFound: 0 }, byEngine: {}, recentResults: [] };
      return res.json();
    },
    enabled: !!ga4PropertyId,
    refetchInterval: 30_000,
  });

  const handleAeoRun = async () => {
    if (!ga4PropertyId || aeoRunning || aeoQueries.length === 0) return;
    setAeoRunning(true);
    setAeoRunResults(null);
    try {
      const res = await fetch("/api/agents/aeo/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: ga4PropertyId, queries: aeoQueries, brandEntity: selectedAeoBrand }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Run failed");
      setAeoRunResults((data.queryResults as AeoQueryResult[]) ?? null);
      if (data.engineStatus)   setAeoEngineStatus(data.engineStatus as Record<string, boolean>);
      if (data.engineErrors)   setAeoEngineErrors(data.engineErrors as Record<string, string>);
      if (data.responseTexts)  setAeoResponseTexts(data.responseTexts as Record<string, Record<string, string>>);
      setExpandedRows(new Set());
      const errors = data.engineErrors as Record<string, string> | undefined;
      const failedEngines = errors ? Object.keys(errors) : [];
      toast({
        title: "AEO scan complete",
        description: failedEngines.length
          ? `${data.mentionsFound ?? 0} citations · ${failedEngines.join(", ")} failed: ${Object.values(errors!)[0].slice(0, 80)}`
          : `${data.mentionsFound ?? 0} citations found across ${data.totalRuns ?? 0} engine responses`,
        variant: failedEngines.length ? "destructive" : "default",
      });
      refetchAeo();
    } catch (err: unknown) {
      toast({ title: "AEO run failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setAeoRunning(false);
    }
  };

  // ── Existing prompt-set state ─────────────────────────────────────────────────
  const { data: promptSets = [], isLoading: loadingSets } = useQuery<PromptSet[]>({
    queryKey: ["/api/ai-mentions/prompt-sets"],
  });

  const { data: brandEntities = [], isLoading: loadingBrands } = useQuery<BrandEntity[]>({
    queryKey: ["/api/ai-mentions/brand-entities"],
  });

  const { data: results, isLoading: loadingResults } = useQuery<{ prompts: Prompt[] }>({
    queryKey: ["/api/ai-mentions/results", selectedPromptSetId, appliedRange?.from?.toISOString(), appliedRange?.to?.toISOString()],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (appliedRange?.from) params.set("start", appliedRange.from.toISOString());
      if (appliedRange?.to) params.set("end", appliedRange.to.toISOString());
      const res = await fetch(`/api/ai-mentions/results/${selectedPromptSetId}?${params}`);
      return res.json();
    },
    enabled: !!selectedPromptSetId,
  });

  const { data: stats, isLoading: loadingStats } = useQuery<Stats>({
    queryKey: ["/api/ai-mentions/stats", selectedPromptSetId, appliedRange?.from?.toISOString(), appliedRange?.to?.toISOString()],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (appliedRange?.from) params.set("start", appliedRange.from.toISOString());
      if (appliedRange?.to) params.set("end", appliedRange.to.toISOString());
      const res = await fetch(`/api/ai-mentions/stats/${selectedPromptSetId}?${params}`);
      return res.json();
    },
    enabled: !!selectedPromptSetId,
  });

  const createPromptSetMutation = useMutation({
    mutationFn: async (data: { name: string; description: string }) => {
      return apiRequest("POST", "/api/ai-mentions/prompt-sets", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-mentions/prompt-sets"] });
      setShowNewPromptSetDialog(false);
      setNewPromptSetName("");
      setNewPromptSetDescription("");
      toast({ title: "Prompt set created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create prompt set", variant: "destructive" });
    },
  });

  const createPromptMutation = useMutation({
    mutationFn: async (data: { promptSetId: string; promptText: string; category?: string }) => {
      return apiRequest("POST", "/api/ai-mentions/prompts", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-mentions/results", selectedPromptSetId] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-mentions/stats", selectedPromptSetId] });
      setShowNewPromptDialog(false);
      setNewPromptText("");
      setNewPromptCategory("");
      toast({ title: "Prompt added successfully" });
    },
    onError: () => {
      toast({ title: "Failed to add prompt", variant: "destructive" });
    },
  });

  const createBrandMutation = useMutation({
    mutationFn: async (data: { brandName: string; synonymsJson?: string[]; competitorsJson?: string[] }) => {
      return apiRequest("POST", "/api/ai-mentions/brand-entities", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-mentions/brand-entities"] });
      setShowNewBrandDialog(false);
      setNewBrandName("");
      setNewBrandSynonyms("");
      setNewBrandCompetitors("");
      toast({ title: "Brand entity created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create brand entity", variant: "destructive" });
    },
  });

  const runPromptsMutation = useMutation({
    mutationFn: async (data: { promptSetId: string; brandEntityId?: string | null }) => {
      return apiRequest("POST", "/api/ai-mentions/run", data);
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-mentions/results", selectedPromptSetId] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-mentions/stats", selectedPromptSetId] });
      toast({ 
        title: "Prompts executed",
        description: `Completed: ${data.completed}, Failed: ${data.failed}, Total: ${data.total}` 
      });
    },
    onError: () => {
      toast({ title: "Failed to run prompts", variant: "destructive" });
    },
  });

  const handleApply = () => {
    setAppliedRange(dateRange);
  };

  const handleRunNow = () => {
    if (!selectedPromptSetId) return;
    runPromptsMutation.mutate({
      promptSetId: selectedPromptSetId,
      brandEntityId: selectedBrandEntityId,
    });
  };

  const handleCreatePromptSet = () => {
    if (!newPromptSetName.trim()) return;
    createPromptSetMutation.mutate({
      name: newPromptSetName,
      description: newPromptSetDescription,
    });
  };

  const handleCreatePrompt = () => {
    if (!selectedPromptSetId || !newPromptText.trim()) return;
    createPromptMutation.mutate({
      promptSetId: selectedPromptSetId,
      promptText: newPromptText,
      category: newPromptCategory || undefined,
    });
  };

  const handleCreateBrand = () => {
    if (!newBrandName.trim()) return;
    createBrandMutation.mutate({
      brandName: newBrandName,
      synonymsJson: newBrandSynonyms ? newBrandSynonyms.split(",").map(s => s.trim()).filter(Boolean) : [],
      competitorsJson: newBrandCompetitors ? newBrandCompetitors.split(",").map(s => s.trim()).filter(Boolean) : [],
    });
  };

  const prompts = results?.prompts || [];
  const hasData = prompts.length > 0 && stats && stats.completedRuns > 0;

  const columns: Column<Prompt>[] = [
    {
      key: "promptText",
      header: "Prompt",
      render: (row) => (
        <div className="max-w-[300px]">
          <p className="font-medium truncate">{row.promptText}</p>
          {row.category && (
            <Badge variant="secondary" className="mt-1 text-xs">{row.category}</Badge>
          )}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => {
        if (!row.lastRun) {
          return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Not Run</Badge>;
        }
        if (row.lastRun.status === "completed") {
          return <Badge variant="default" className="bg-green-500/20 text-green-400"><CheckCircle className="h-3 w-3 mr-1" />Completed</Badge>;
        }
        if (row.lastRun.status === "failed") {
          return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Failed</Badge>;
        }
        return <Badge variant="secondary"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Running</Badge>;
      },
    },
    {
      key: "mentionFound",
      header: "Mention",
      render: (row) => {
        if (!row.mention) {
          return <span className="text-muted-foreground">-</span>;
        }
        return row.mention.mentionFound ? (
          <Badge variant="default" className="bg-cyan-500/20 text-cyan-400">
            <CheckCircle className="h-3 w-3 mr-1" />Found
          </Badge>
        ) : (
          <Badge variant="secondary">
            <XCircle className="h-3 w-3 mr-1" />Not Found
          </Badge>
        );
      },
    },
    {
      key: "mentionScore",
      header: "Score",
      align: "right",
      render: (row) => {
        if (!row.mention) {
          return <span className="text-muted-foreground">-</span>;
        }
        const score = row.mention.mentionScore;
        return (
          <span className={
            score >= 70 ? "text-green-400 font-bold" :
            score >= 40 ? "text-amber-400" :
            "text-muted-foreground"
          }>
            {score}
          </span>
        );
      },
    },
    {
      key: "contextSnippet",
      header: "Snippet",
      render: (row) => {
        if (!row.mention?.contextSnippet) {
          return <span className="text-muted-foreground">-</span>;
        }
        return (
          <span className="text-sm text-muted-foreground max-w-[200px] truncate block">
            {row.mention.contextSnippet}
          </span>
        );
      },
    },
    {
      key: "competitors",
      header: "Competitors",
      render: (row) => {
        if (!row.mention?.competitorFoundJson?.length) {
          return <span className="text-muted-foreground">-</span>;
        }
        return (
          <div className="flex flex-wrap gap-1">
            {row.mention.competitorFoundJson.slice(0, 2).map((comp, idx) => (
              <Badge key={idx} variant="destructive" className="text-xs">
                {comp}
              </Badge>
            ))}
            {row.mention.competitorFoundJson.length > 2 && (
              <Badge variant="secondary" className="text-xs">
                +{row.mention.competitorFoundJson.length - 2}
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      key: "lastRun",
      header: "Last Run",
      render: (row) => {
        if (!row.lastRun?.runAt) {
          return <span className="text-muted-foreground">-</span>;
        }
        return (
          <span className="text-sm text-muted-foreground">
            {format(new Date(row.lastRun.runAt), "MMM d, HH:mm")}
          </span>
        );
      },
    },
  ];

  return (
    <div className="space-y-6" data-testid="ai-mentions-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-purple-400" />
            AI Mentions
          </h1>
          <p className="text-muted-foreground">
            Track your brand visibility in AI-generated responses
          </p>
        </div>
        <DateRangePicker
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          onApply={handleApply}
        />
      </div>

      <Alert className="border-purple-500/20 bg-purple-500/5">
        <Sparkles className="h-4 w-4 text-purple-400" />
        <AlertTitle>Prompt-Based Brand Visibility</AlertTitle>
        <AlertDescription>
          This feature measures whether your brand appears in AI-generated answers for predefined prompts. 
          This is different from AI Referral Traffic in GA4.
        </AlertDescription>
      </Alert>

      <Tabs defaultValue="aeo" className="space-y-6">
        <TabsList>
          <TabsTrigger value="aeo" data-testid="tab-aeo">AEO Visibility</TabsTrigger>
          <TabsTrigger value="dashboard" data-testid="tab-dashboard">Prompt Monitor</TabsTrigger>
          <TabsTrigger value="prompts" data-testid="tab-prompts">Prompt Sets</TabsTrigger>
          <TabsTrigger value="brands" data-testid="tab-brands">Brand Entities</TabsTrigger>
        </TabsList>

        {/* ── AEO Visibility Tab ──────────────────────────────────────────── */}
        <TabsContent value="aeo" className="space-y-6">

          {/* Controls row */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[180px]">
              <Label className="text-sm text-muted-foreground mb-2 block">Brand</Label>
              <Select value={selectedAeoBrand} onValueChange={setSelectedAeoBrand}>
                <SelectTrigger data-testid="select-aeo-brand">
                  <SelectValue placeholder="Select brand..." />
                </SelectTrigger>
                <SelectContent>
                  {/* DB brand entities first (unique names), then localStorage-only ones */}
                  {Array.from(new Set([
                    ...brandEntities.map((e) => e.brandName),
                    ...aeoBrands,
                  ])).map((b) => (
                    <SelectItem key={b} value={b}>{b}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[180px]">
              <Label className="text-sm text-muted-foreground mb-2 block">
                Queries ({aeoQueries.length})
              </Label>
              <p className="text-xs text-muted-foreground truncate">
                {aeoQueries.slice(0, 2).join(" · ")}{aeoQueries.length > 2 ? ` +${aeoQueries.length - 2} more` : ""}
              </p>
            </div>
            <Button
              onClick={handleAeoRun}
              disabled={aeoRunning || !ga4PropertyId || aeoQueries.length === 0}
              className="gap-2"
              data-testid="button-aeo-run"
            >
              {aeoRunning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Scanning…
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4" />
                  Run Now
                </>
              )}
            </Button>
          </div>

          {/* Per-engine running spinners */}
          {aeoRunning && (
            <div className="flex gap-3">
              {(["ChatGPT", "Claude", "Gemini"] as const).map((eng) => (
                <div key={eng} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {eng}
                </div>
              ))}
            </div>
          )}

          {/* Metrics tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard title="Coverage" value={aeoData ? `${aeoData.aggregates.citationShare}%` : "—"} icon={Percent} accent="purple" />
            <KpiCard title="Avg Position" value={aeoData?.aggregates.avgPosition ?? "—"} icon={Target} accent="cyan" />
            <KpiCard title="Total Runs" value={aeoData?.aggregates.totalRuns ?? "—"} icon={MessageSquare} accent="amber" />
            <KpiCard title="Mentions" value={aeoData?.aggregates.mentionsFound ?? "—"} icon={CheckCircle} accent="green" />
          </div>

          {/* Engine cards */}
          <div className="flex flex-col sm:flex-row gap-3">
            {[
              { key: "chatgpt", name: "ChatGPT", icon: <Bot      className="h-4 w-4 text-green-400"  /> },
              { key: "claude",  name: "Claude",  icon: <Sparkles className="h-4 w-4 text-orange-400" /> },
            ].map(({ key, name, icon }) => {
              const engineData = aeoData?.byEngine?.[key];
              const keyMissing = key in aeoEngineStatus && !aeoEngineStatus[key];
              const engineErr = aeoEngineErrors[key];
              return (
                <Card key={key} className={`bg-card border-white/10 flex-1 ${engineErr ? "border-red-500/30" : ""}`}>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-center gap-2 mb-2">
                      {icon}
                      <span className="text-sm font-medium text-foreground">{name}</span>
                      {keyMissing && (
                        <Badge variant="outline" className="ml-auto text-xs border-red-500/30 text-red-400">
                          key missing
                        </Badge>
                      )}
                      {engineErr && !keyMissing && (
                        <Badge variant="outline" className="ml-auto text-xs border-red-500/30 text-red-400">
                          error
                        </Badge>
                      )}
                    </div>
                    {engineData ? (
                      <>
                        <p className={`text-2xl font-bold ${
                          engineData.citationShare >= 60 ? "text-emerald-400"
                          : engineData.citationShare >= 30 ? "text-amber-400"
                          : "text-red-400"
                        }`}>{engineData.citationShare}%</p>
                        <p className="text-xs text-muted-foreground">
                          cited · {engineData.mentionsFound} mention{engineData.mentionsFound !== 1 ? "s" : ""}
                        </p>
                      </>
                    ) : keyMissing ? (
                      <p className="text-xs text-red-400/70">Add key to .env to enable</p>
                    ) : engineErr ? (
                      <p className="text-xs text-red-400/80 break-all">{engineErr.slice(0, 120)}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground">No data yet</p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Results table (from latest run or DB history) */}
          {(() => {
            type TableRow = { query: string; chatgpt: AeoRunRow | null; claude: AeoRunRow | null; gemini: AeoRunRow | null };
            const tableRows: TableRow[] = [];

            if (aeoRunResults && aeoRunResults.length > 0) {
              for (const qr of aeoRunResults) {
                tableRows.push({
                  query:   qr.query,
                  chatgpt: qr.chatgpt ? { id: "", query: qr.query, engine: "chatgpt", cited: qr.chatgpt.cited ? 1 : 0, position: qr.chatgpt.position, context: null, excerpt: qr.chatgpt.excerpt, brandEntity: selectedAeoBrand, createdAt: null } : null,
                  claude:  qr.claude  ? { id: "", query: qr.query, engine: "claude",  cited: qr.claude.cited  ? 1 : 0, position: qr.claude.position,  context: null, excerpt: qr.claude.excerpt,  brandEntity: selectedAeoBrand, createdAt: null } : null,
                  gemini:  qr.gemini  ? { id: "", query: qr.query, engine: "gemini",  cited: qr.gemini.cited  ? 1 : 0, position: qr.gemini.position,  context: null, excerpt: qr.gemini.excerpt,  brandEntity: selectedAeoBrand, createdAt: null } : null,
                });
              }
            } else if (aeoData?.recentResults?.length) {
              const byQuery = new Map<string, TableRow>();
              for (const row of aeoData.recentResults) {
                if (!byQuery.has(row.query)) byQuery.set(row.query, { query: row.query, chatgpt: null, claude: null, gemini: null });
                const tr = byQuery.get(row.query)!;
                if (row.engine === "chatgpt") tr.chatgpt = row;
                else if (row.engine === "claude") tr.claude = row;
                else if (row.engine === "gemini") tr.gemini = row;
              }
              tableRows.push(...Array.from(byQuery.values()));
            }

            if (tableRows.length === 0) return (
              <Card className="border-white/10 bg-card/50">
                <CardContent className="py-10 text-center">
                  <Zap className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-muted-foreground text-sm">Run a scan to see per-engine results here.</p>
                </CardContent>
              </Card>
            );

            const CitedCell = ({ row }: { row: AeoRunRow | null }) => {
              if (!row) return <span className="text-muted-foreground text-xs">—</span>;
              return row.cited === 1 ? (
                <div className="flex items-center justify-center gap-1">
                  <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
                  {row.position != null && <span className="text-xs text-muted-foreground">p{row.position}</span>}
                </div>
              ) : (
                <XCircle className="h-3.5 w-3.5 text-muted-foreground mx-auto" />
              );
            };

            const bestExcerpt = (tr: TableRow) =>
              tr.chatgpt?.excerpt ?? tr.claude?.excerpt ?? tr.gemini?.excerpt ?? null;

            const toggleRow = (i: number) => {
              setExpandedRows((prev) => {
                const next = new Set(prev);
                next.has(i) ? next.delete(i) : next.add(i);
                return next;
              });
            };

            return (
              <Card className="border-white/10 bg-card/50">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Prompt Results</CardTitle>
                    {/* Issue 5 — Debug Mode toggle */}
                    <div className="flex items-center gap-2">
                      <Eye className="h-4 w-4 text-muted-foreground" />
                      <Label htmlFor="debug-toggle" className="text-xs text-muted-foreground cursor-pointer">
                        Debug Mode
                      </Label>
                      <Switch
                        id="debug-toggle"
                        checked={debugMode}
                        onCheckedChange={setDebugMode}
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-xs text-muted-foreground">
                        <th className="text-left py-2 pr-3 font-medium w-4"></th>
                        <th className="text-left py-2 pr-3 font-medium">Query</th>
                        <th className="text-center py-2 px-2 font-medium w-20">ChatGPT</th>
                        <th className="text-center py-2 px-2 font-medium w-20">Claude</th>
                        <th className="text-left py-2 pl-3 font-medium">Excerpt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.map((tr, i) => {
                        const isExpanded = expandedRows.has(i);
                        const responsePreviews = aeoResponseTexts[tr.query];
                        return (
                          <>
                            {/* Main row — click to expand */}
                            <tr
                              key={`row-${i}`}
                              className="border-b border-white/5 last:border-0 cursor-pointer hover:bg-white/[0.02] transition-colors"
                              onClick={() => toggleRow(i)}
                            >
                              <td className="py-2 pl-1">
                                {isExpanded
                                  ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                  : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                }
                              </td>
                              <td className="py-2 pr-3 text-foreground max-w-[200px] truncate text-xs">{tr.query}</td>
                              <td className="py-2 px-2 text-center"><CitedCell row={tr.chatgpt} /></td>
                              <td className="py-2 px-2 text-center"><CitedCell row={tr.claude} /></td>
                              <td className="py-2 pl-3 text-xs text-muted-foreground max-w-[200px] truncate">
                                {bestExcerpt(tr) ?? "—"}
                              </td>
                            </tr>

                            {/* Issue 4 — Expanded row: response preview */}
                            {isExpanded && (
                              <tr key={`expand-${i}`} className="border-b border-white/5">
                                <td colSpan={6} className="pb-3 pt-1 px-2">
                                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-white/[0.02] rounded-lg p-3">
                                    {(["chatgpt", "claude"] as const).map((eng) => {
                                      const preview = debugMode
                                        ? (responsePreviews?.[eng] ?? null)
                                        : (responsePreviews?.[eng]?.slice(0, 200) ?? null);
                                      const cited = tr[eng]?.cited === 1;
                                      return (
                                        <div key={eng} className="space-y-1">
                                          <div className="flex items-center gap-1.5">
                                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{eng}</span>
                                            {tr[eng] ? (
                                              cited
                                                ? <CheckCircle className="h-3 w-3 text-emerald-400" />
                                                : <XCircle className="h-3 w-3 text-muted-foreground" />
                                            ) : null}
                                          </div>
                                          {preview ? (
                                            <p className="text-xs text-muted-foreground leading-relaxed break-words">
                                              {debugMode ? preview : `${preview}…`}
                                            </p>
                                          ) : tr[eng] === null ? (
                                            <p className="text-xs text-muted-foreground/50 italic">Engine not run</p>
                                          ) : (
                                            <p className="text-xs text-muted-foreground/50 italic">Run again to see preview</p>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </>
                        );
                      })}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            );
          })()}
        </TabsContent>

        <TabsContent value="dashboard" className="space-y-6">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[200px]">
              <Label className="text-sm text-muted-foreground mb-2 block">Prompt Set</Label>
              <Select value={selectedPromptSetId || ""} onValueChange={setSelectedPromptSetId}>
                <SelectTrigger data-testid="select-prompt-set">
                  <SelectValue placeholder="Select a prompt set..." />
                </SelectTrigger>
                <SelectContent>
                  {promptSets.map((set) => (
                    <SelectItem key={set.id} value={set.id}>{set.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <Label className="text-sm text-muted-foreground mb-2 block">Brand Entity</Label>
              <Select value={selectedBrandEntityId || ""} onValueChange={setSelectedBrandEntityId}>
                <SelectTrigger data-testid="select-brand-entity">
                  <SelectValue placeholder="Select a brand..." />
                </SelectTrigger>
                <SelectContent>
                  {brandEntities.map((entity) => (
                    <SelectItem key={entity.id} value={entity.id}>{entity.brandName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button 
                onClick={handleRunNow} 
                disabled={!selectedPromptSetId || runPromptsMutation.isPending}
                className="gap-2"
                data-testid="button-run-now"
              >
                {runPromptsMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                Run Now
              </Button>
            </div>
          </div>

          {!selectedPromptSetId && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Select a Prompt Set</AlertTitle>
              <AlertDescription>
                Choose a prompt set from the dropdown above to view AI mention analysis results.
              </AlertDescription>
            </Alert>
          )}

          {selectedPromptSetId && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard
                  title="Coverage"
                  value={hasData ? `${stats?.coverage || 0}%` : "-"}
                  icon={Percent}
                  accent="purple"
                />
                <KpiCard
                  title="Avg Score"
                  value={hasData ? stats?.avgScore || 0 : "-"}
                  icon={Target}
                  accent="cyan"
                />
                <KpiCard
                  title="Total Runs"
                  value={hasData ? stats?.completedRuns || 0 : "-"}
                  icon={MessageSquare}
                  accent="amber"
                />
                <KpiCard
                  title="Mentions Found"
                  value={hasData ? stats?.mentionCount || 0 : "-"}
                  icon={CheckCircle}
                  accent="green"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4">
                <h2 className="text-lg font-semibold">Prompt Results</h2>
                <Dialog open={showNewPromptDialog} onOpenChange={setShowNewPromptDialog}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1" data-testid="button-add-prompt">
                      <Plus className="h-4 w-4" /> Add Prompt
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add New Prompt</DialogTitle>
                      <DialogDescription>
                        Add a prompt to test if your brand appears in AI responses.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label>Prompt Text</Label>
                        <Textarea 
                          value={newPromptText}
                          onChange={(e) => setNewPromptText(e.target.value)}
                          placeholder="e.g., What are the best SEO tools for agencies?"
                          data-testid="input-prompt-text"
                        />
                      </div>
                      <div>
                        <Label>Category (optional)</Label>
                        <Input 
                          value={newPromptCategory}
                          onChange={(e) => setNewPromptCategory(e.target.value)}
                          placeholder="e.g., SEO Tools, Pricing, Comparison"
                          data-testid="input-prompt-category"
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button onClick={handleCreatePrompt} disabled={createPromptMutation.isPending} data-testid="button-save-prompt">
                        {createPromptMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        Add Prompt
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>

              <Card className="border-white/10 bg-card/50 backdrop-blur-sm">
                <CardContent className="pt-6">
                  {prompts.length === 0 && !loadingResults ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>No prompts in this set yet.</p>
                      <p className="text-sm mt-2">Add prompts to start tracking AI mentions.</p>
                    </div>
                  ) : (
                    <DataTable
                      columns={columns}
                      data={prompts}
                      isLoading={loadingResults}
                      testIdPrefix="ai-mentions"
                      pageSize={10}
                      totalItems={prompts.length}
                    />
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="prompts" className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Prompt Sets</h2>
            <Dialog open={showNewPromptSetDialog} onOpenChange={setShowNewPromptSetDialog}>
              <DialogTrigger asChild>
                <Button className="gap-1" data-testid="button-new-prompt-set">
                  <Plus className="h-4 w-4" /> New Prompt Set
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Prompt Set</DialogTitle>
                  <DialogDescription>
                    Create a collection of prompts to track brand mentions.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>Name</Label>
                    <Input 
                      value={newPromptSetName}
                      onChange={(e) => setNewPromptSetName(e.target.value)}
                      placeholder="e.g., SEO Tool Queries"
                      data-testid="input-prompt-set-name"
                    />
                  </div>
                  <div>
                    <Label>Description (optional)</Label>
                    <Textarea 
                      value={newPromptSetDescription}
                      onChange={(e) => setNewPromptSetDescription(e.target.value)}
                      placeholder="Describe the purpose of this prompt set..."
                      data-testid="input-prompt-set-description"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={handleCreatePromptSet} disabled={createPromptSetMutation.isPending} data-testid="button-save-prompt-set">
                    {createPromptSetMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Create
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {promptSets.length === 0 && !loadingSets ? (
              <Card className="col-span-full border-dashed">
                <CardContent className="py-12 text-center">
                  <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50 text-muted-foreground" />
                  <p className="text-muted-foreground">No prompt sets yet.</p>
                  <p className="text-sm text-muted-foreground mt-1">Create your first prompt set to get started.</p>
                </CardContent>
              </Card>
            ) : (
              promptSets.map((set) => (
                <Card key={set.id} className="border-white/10 bg-card/50 backdrop-blur-sm hover-elevate cursor-pointer" onClick={() => setSelectedPromptSetId(set.id)}>
                  <CardHeader>
                    <CardTitle className="text-base">{set.name}</CardTitle>
                    {set.description && (
                      <CardDescription className="line-clamp-2">{set.description}</CardDescription>
                    )}
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      Created {format(new Date(set.createdAt), "MMM d, yyyy")}
                    </p>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
          {/* AEO Queries section (localStorage) */}
          <div className="pt-4 border-t border-white/10">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Zap className="h-4 w-4 text-purple-400" />
                AEO Queries (used by Run Now)
              </h3>
              <Badge variant="outline" className="text-xs border-white/10">localStorage</Badge>
            </div>
            <div className="space-y-2">
              {aeoQueries.map((q, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="flex-1 text-sm text-foreground bg-white/5 rounded px-3 py-1.5">{q}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-400"
                    onClick={() => setAeoQueries(aeoQueries.filter((_, j) => j !== i))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              <div className="flex gap-2 pt-1">
                <Input
                  value={newAeoQuery}
                  onChange={(e) => setNewAeoQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && newAeoQuery.trim()) { setAeoQueries([...aeoQueries, newAeoQuery.trim()]); setNewAeoQuery(""); } }}
                  placeholder="Add a new AEO query..."
                  className="flex-1 h-8 text-sm"
                />
                <Button size="sm" variant="outline" className="gap-1"
                  onClick={() => { if (newAeoQuery.trim()) { setAeoQueries([...aeoQueries, newAeoQuery.trim()]); setNewAeoQuery(""); } }}>
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="brands" className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Brand Entities</h2>
            <Dialog open={showNewBrandDialog} onOpenChange={setShowNewBrandDialog}>
              <DialogTrigger asChild>
                <Button className="gap-1" data-testid="button-new-brand">
                  <Plus className="h-4 w-4" /> New Brand
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Brand Entity</DialogTitle>
                  <DialogDescription>
                    Define your brand and competitors to track in AI responses.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>Brand Name</Label>
                    <Input 
                      value={newBrandName}
                      onChange={(e) => setNewBrandName(e.target.value)}
                      placeholder="e.g., TrueFirms"
                      data-testid="input-brand-name"
                    />
                  </div>
                  <div>
                    <Label>Synonyms (comma separated)</Label>
                    <Input 
                      value={newBrandSynonyms}
                      onChange={(e) => setNewBrandSynonyms(e.target.value)}
                      placeholder="e.g., True Firms, truefirms.co"
                      data-testid="input-brand-synonyms"
                    />
                  </div>
                  <div>
                    <Label>Competitors (comma separated)</Label>
                    <Input 
                      value={newBrandCompetitors}
                      onChange={(e) => setNewBrandCompetitors(e.target.value)}
                      placeholder="e.g., Clutch, GoodFirms, G2"
                      data-testid="input-brand-competitors"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={handleCreateBrand} disabled={createBrandMutation.isPending} data-testid="button-save-brand">
                    {createBrandMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Create
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {brandEntities.length === 0 && !loadingBrands ? (
              <Card className="col-span-full border-dashed">
                <CardContent className="py-12 text-center">
                  <Building2 className="h-12 w-12 mx-auto mb-4 opacity-50 text-muted-foreground" />
                  <p className="text-muted-foreground">No brand entities yet.</p>
                  <p className="text-sm text-muted-foreground mt-1">Create a brand entity to start detecting mentions.</p>
                </CardContent>
              </Card>
            ) : (
              brandEntities.map((entity) => (
                <Card key={entity.id} className="border-white/10 bg-card/50 backdrop-blur-sm">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-purple-400" />
                      {entity.brandName}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {entity.synonymsJson && entity.synonymsJson.length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Synonyms:</p>
                        <div className="flex flex-wrap gap-1">
                          {entity.synonymsJson.map((s, idx) => (
                            <Badge key={idx} variant="secondary" className="text-xs">{s}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {entity.competitorsJson && entity.competitorsJson.length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Competitors:</p>
                        <div className="flex flex-wrap gap-1">
                          {entity.competitorsJson.map((c, idx) => (
                            <Badge key={idx} variant="destructive" className="text-xs">{c}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          {/* AEO Brands section (localStorage) */}
          <div className="pt-4 border-t border-white/10">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Zap className="h-4 w-4 text-purple-400" />
                AEO Brand Names (used by Run Now)
              </h3>
              <Badge variant="outline" className="text-xs border-white/10">localStorage</Badge>
            </div>
            <div className="space-y-2">
              {aeoBrands.map((b, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="flex-1 text-sm text-foreground bg-white/5 rounded px-3 py-1.5">{b}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-400"
                    onClick={() => setAeoBrands(aeoBrands.filter((_, j) => j !== i))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              <div className="flex gap-2 pt-1">
                <Input
                  value={newAeoBrand}
                  onChange={(e) => setNewAeoBrand(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && newAeoBrand.trim()) { setAeoBrands([...aeoBrands, newAeoBrand.trim()]); setNewAeoBrand(""); } }}
                  placeholder="Add brand name..."
                  className="flex-1 h-8 text-sm"
                />
                <Button size="sm" variant="outline" className="gap-1"
                  onClick={() => { if (newAeoBrand.trim()) { setAeoBrands([...aeoBrands, newAeoBrand.trim()]); setNewAeoBrand(""); } }}>
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
