import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, BarChart3, BrainCircuit } from "lucide-react";

export type DataSource = "semrush" | "ga4" | "gsc";

interface SourceToggleProps {
  activeSource: DataSource;
  onSourceChange: (source: DataSource) => void;
  /** Which source tabs to show. Defaults to all three. */
  sources?: DataSource[];
}

const SOURCE_TABS: Record<DataSource, { label: string; icon: typeof Search; activeClass: string }> = {
  semrush: { label: "SEMrush", icon: BrainCircuit, activeClass: "data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-400" },
  ga4: { label: "GA4", icon: BarChart3, activeClass: "data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400" },
  gsc: { label: "GSC", icon: Search, activeClass: "data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-400" },
};

export function SourceToggle({ activeSource, onSourceChange, sources = ["semrush", "ga4", "gsc"] }: SourceToggleProps) {
  return (
    <Tabs value={activeSource} onValueChange={(val) => onSourceChange(val as DataSource)} className="mb-6">
      <TabsList
        className="grid w-full max-w-lg bg-muted/50 border border-white/10 p-1 h-12"
        style={{ gridTemplateColumns: `repeat(${sources.length}, minmax(0, 1fr))` }}
      >
        {sources.map((source) => {
          const { label, icon: Icon, activeClass } = SOURCE_TABS[source];
          return (
            <TabsTrigger key={source} value={source} className={`flex items-center gap-2 ${activeClass} rounded-md`}>
              <Icon className="h-4 w-4" />
              <span className="font-semibold block">{label}</span>
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}
