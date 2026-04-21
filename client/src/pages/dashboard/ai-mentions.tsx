import { useState } from "react";
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
  Edit2
} from "lucide-react";
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

export default function AiMentionsPage() {
  const { toast } = useToast();
  const [selectedPromptSetId, setSelectedPromptSetId] = useState<string | null>(null);
  const [selectedBrandEntityId, setSelectedBrandEntityId] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 30),
    to: new Date(),
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

      <Tabs defaultValue="dashboard" className="space-y-6">
        <TabsList>
          <TabsTrigger value="dashboard" data-testid="tab-dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="prompts" data-testid="tab-prompts">Prompt Sets</TabsTrigger>
          <TabsTrigger value="brands" data-testid="tab-brands">Brand Entities</TabsTrigger>
        </TabsList>

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
        </TabsContent>
      </Tabs>
    </div>
  );
}
