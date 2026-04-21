import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, BarChart3, BrainCircuit } from "lucide-react";

export type DataSource = "semrush" | "ga4" | "gsc";

interface SourceToggleProps {
  activeSource: DataSource;
  onSourceChange: (source: DataSource) => void;
}

export function SourceToggle({ activeSource, onSourceChange }: SourceToggleProps) {
  return (
    <Tabs value={activeSource} onValueChange={(val) => onSourceChange(val as DataSource)} className="mb-6">
      <TabsList className="grid w-full max-w-lg grid-cols-3 bg-muted/50 border border-white/10 p-1 h-12">
        <TabsTrigger value="semrush" className="flex items-center gap-2 data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-400 rounded-md">
          <BrainCircuit className="h-4 w-4" />
          <span className="font-semibold block">SEMrush</span>
        </TabsTrigger>
        <TabsTrigger value="ga4" className="flex items-center gap-2 data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400 rounded-md">
          <BarChart3 className="h-4 w-4" />
          <span className="font-semibold block">GA4</span>
        </TabsTrigger>
        <TabsTrigger value="gsc" className="flex items-center gap-2 data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-400 rounded-md">
          <Search className="h-4 w-4" />
          <span className="font-semibold block">GSC</span>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
