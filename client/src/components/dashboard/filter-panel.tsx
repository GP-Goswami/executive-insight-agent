import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronDown, ChevronUp, RotateCcw, Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface FilterOption {
  label: string;
  value: string;
}

interface FilterConfig {
  key: string;
  label: string;
  type: "select" | "text";
  options?: FilterOption[];
  placeholder?: string;
}

interface FilterPanelProps {
  filters: FilterConfig[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onReset: () => void;
  onSearch?: () => void;
  collapsible?: boolean;
  className?: string;
}

export function FilterPanel({
  filters,
  values,
  onChange,
  onReset,
  onSearch,
  collapsible = true,
  className,
}: FilterPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const hasActiveFilters = Object.values(values).some((v) => v && v !== "all");

  return (
    <Card className={cn("border-white/10 bg-card/50 backdrop-blur-sm", className)} data-testid="filter-panel">
      <CardHeader className="flex flex-row items-center justify-between gap-4 py-3 px-4">
        <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Filters
        </CardTitle>
        <div className="flex items-center gap-2">
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onReset}
              className="text-xs text-muted-foreground h-7"
              data-testid="button-reset-filters"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              Reset
            </Button>
          )}
          {collapsible && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsExpanded(!isExpanded)}
              className="h-7 w-7"
              data-testid="button-toggle-filters"
            >
              {isExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
      </CardHeader>
      {isExpanded && (
        <CardContent className="pt-0 pb-4 px-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {filters.map((filter) => (
              <div key={filter.key} className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{filter.label}</Label>
                {filter.type === "select" && filter.options ? (
                  <Select
                    value={values[filter.key] || "all"}
                    onValueChange={(value) => onChange(filter.key, value)}
                  >
                    <SelectTrigger 
                      className="h-9 bg-muted/50 border-white/10"
                      data-testid={`filter-${filter.key}`}
                    >
                      <SelectValue placeholder={filter.placeholder || "All"} />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-white/10">
                      <SelectItem value="all">All</SelectItem>
                      {filter.options.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={values[filter.key] || ""}
                      onChange={(e) => onChange(filter.key, e.target.value)}
                      placeholder={filter.placeholder}
                      className="h-9 pl-8 bg-muted/50 border-white/10"
                      data-testid={`filter-${filter.key}`}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
          {onSearch && (
            <div className="mt-4 flex justify-end">
              <Button
                onClick={onSearch}
                size="sm"
                className="gradient-cyan-purple text-white glow-cyan-sm"
                data-testid="button-apply-filters"
              >
                Apply Filters
              </Button>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
