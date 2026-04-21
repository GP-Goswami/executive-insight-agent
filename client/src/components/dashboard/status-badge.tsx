import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: "ok" | "stale" | "failed" | "pending";
  label?: string;
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const statusConfig = {
    ok: {
      dotClass: "bg-green-400",
      badgeClass: "border-green-400/30 text-green-400",
      defaultLabel: "Synced",
    },
    stale: {
      dotClass: "bg-amber-400",
      badgeClass: "border-amber-400/30 text-amber-400",
      defaultLabel: "Stale",
    },
    failed: {
      dotClass: "bg-red-400",
      badgeClass: "border-red-400/30 text-red-400",
      defaultLabel: "Failed",
    },
    pending: {
      dotClass: "bg-blue-400 animate-pulse",
      badgeClass: "border-blue-400/30 text-blue-400",
      defaultLabel: "Syncing",
    },
  };

  const config = statusConfig[status];

  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 bg-transparent", config.badgeClass)}
      data-testid={`status-badge-${status}`}
    >
      <span className={cn("h-2 w-2 rounded-full", config.dotClass)} />
      {label || config.defaultLabel}
    </Badge>
  );
}
