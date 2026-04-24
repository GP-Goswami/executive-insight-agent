import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar as CalendarIcon, Check } from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { cn } from "@/lib/utils";
import type { DateRange } from "react-day-picker";

interface DateRangePickerProps {
  dateRange: DateRange | undefined;
  onDateRangeChange: (range: DateRange | undefined) => void;
  onApply: () => void;
}

const presets = [
  { label: "Last 7d", days: 7 },
  { label: "Last 14d", days: 14 },
  { label: "Last 28d", days: 28 },
  { label: "Last 30d", days: 30 },
  { label: "Last 90d", days: 90 },
];

export function DateRangePicker({
  dateRange,
  onDateRangeChange,
  onApply,
}: DateRangePickerProps) {
  const [activePreset, setActivePreset] = useState<string | null>("Last 30d");
  const [isOpen, setIsOpen] = useState(false);

  // Yesterday is the latest selectable date — today's data is still processing in GSC/GA4
  const yesterday = subDays(new Date(), 1);

  const handlePresetClick = (preset: { label: string; days: number }) => {
    const to = yesterday;
    const from = subDays(to, preset.days - 1);
    onDateRangeChange({ from, to });
    setActivePreset(preset.label);
  };

  const handleLastMonth = () => {
    const lastMonth = subMonths(new Date(), 1);
    const from = startOfMonth(lastMonth);
    const to = endOfMonth(lastMonth);
    onDateRangeChange({ from, to });
    setActivePreset("Last Month");
  };

  const handleCustomSelect = (range: DateRange | undefined) => {
    onDateRangeChange(range);
    setActivePreset("Custom");
  };

  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="date-range-picker">
      <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-1">
        {presets.map((preset) => (
          <Button
            key={preset.label}
            variant="ghost"
            size="sm"
            onClick={() => handlePresetClick(preset)}
            className={cn(
              "text-xs px-3 h-8",
              activePreset === preset.label &&
                "bg-primary text-primary-foreground glow-cyan-sm"
            )}
            data-testid={`preset-${preset.label.toLowerCase().replace(/\s+/g, '-')}`}
          >
            {preset.label}
          </Button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLastMonth}
          className={cn(
            "text-xs px-3 h-8",
            activePreset === "Last Month" &&
              "bg-primary text-primary-foreground glow-cyan-sm"
          )}
          data-testid="preset-last-month"
        >
          Last Month
        </Button>

        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "text-xs px-3 h-8 gap-1.5",
                activePreset === "Custom" &&
                  "bg-primary text-primary-foreground glow-cyan-sm"
              )}
              data-testid="preset-custom"
            >
              <CalendarIcon className="h-3.5 w-3.5" />
              Custom
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 bg-card border-white/10" align="end">
            <div className="px-3 pt-3 pb-1 text-xs text-muted-foreground border-b border-white/10">
              Date selection available up to <span className="font-medium text-foreground">{format(yesterday, "MMM d, yyyy")}</span> (yesterday)
            </div>
            <Calendar
              initialFocus
              mode="range"
              defaultMonth={dateRange?.from}
              selected={dateRange}
              onSelect={handleCustomSelect}
              numberOfMonths={2}
              className="bg-card"
              disabled={{ after: yesterday }}
              toDate={yesterday}
            />
          </PopoverContent>
        </Popover>
      </div>

      {dateRange?.from && dateRange?.to && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {format(dateRange.from, "MMM d, yyyy")} - {format(dateRange.to, "MMM d, yyyy")}
          </span>
          <Button
            onClick={onApply}
            size="sm"
            className="gradient-cyan-purple text-white glow-cyan gap-1.5"
            data-testid="button-apply-date"
          >
            <Check className="h-4 w-4" />
            Apply
          </Button>
        </div>
      )}
    </div>
  );
}
