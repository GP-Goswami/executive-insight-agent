import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard,
  Bot,
  Sparkles,
  Search,
  TrendingUp,
  Link2,
  FileDown,
  FileText,
  Settings,
  LogOut,
  ChevronRight,
  Activity,
  ClipboardList,
  Terminal,
  Home,
  CalendarDays,
  CalendarRange,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useDomain } from "@/hooks/use-domain";
import { StatusBadge } from "./dashboard/status-badge";
import { cn } from "@/lib/utils";
import { AGENT_IDS, AGENT_SHORT_NAMES, AGENT_CONFIG } from "@/pages/dashboard/agents/index";

// ── Nav item lists ─────────────────────────────────────────────────────────────

const navItems = [
  { title: "Home",               url: "/dashboard",          icon: Home          },
  { title: "Executive Overview", url: "/dashboard/overview", icon: LayoutDashboard },
  { title: "Traffic",            url: "/dashboard/traffic",  icon: Activity      },
  { title: "AI Referrers",       url: "/dashboard/ai-referrers", icon: Bot      },
  { title: "AI Mentions",        url: "/dashboard/ai-mentions",  icon: Sparkles  },
  { title: "Search Console",     url: "/dashboard/gsc",      icon: Search        },
  { title: "Rankings",           url: "/dashboard/rankings", icon: TrendingUp    },
  { title: "Backlinks",          url: "/dashboard/backlinks",icon: Link2         },
];

const secondaryItems = [
  { title: "Report Preview",  url: "/dashboard/report-preview",  icon: FileText    },
  { title: "Weekly Report",   url: "/dashboard/weekly",          icon: CalendarDays },
  { title: "Monthly Report",  url: "/dashboard/monthly",         icon: CalendarRange },
  { title: "Review Queue",    url: "/dashboard/review-queue",    icon: ClipboardList },
  { title: "Agent Console",   url: "/dashboard/agent-console",   icon: Terminal    },
  { title: "Exports",         url: "/dashboard/exports",         icon: FileDown    },
  { title: "Settings",        url: "/dashboard/settings",        icon: Settings    },
];

// ── Agent status dot ───────────────────────────────────────────────────────────

interface AgentRun { agentId: string; status: string; completedAt: string | null; startedAt: string | null }

function agentDotColor(agentId: string, lastRun?: AgentRun): string {
  const cfg = AGENT_CONFIG[agentId as keyof typeof AGENT_CONFIG];
  if (!cfg || cfg.status === "coming_soon") return "bg-gray-500/60";
  if (!lastRun) return "bg-amber-500";
  if (lastRun.status === "failed") return "bg-red-500";
  const ts = lastRun.completedAt ?? lastRun.startedAt;
  if (!ts) return "bg-amber-500";
  const days = (Date.now() - new Date(ts).getTime()) / 86_400_000;
  return days <= 7 && lastRun.status === "completed" ? "bg-emerald-500" : "bg-amber-500";
}

function StatusDot({ color }: { color: string }) {
  return <div className={cn("h-2 w-2 rounded-full shrink-0 ml-auto", color)} />;
}

// ── Main sidebar component ─────────────────────────────────────────────────────

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { ga4PropertyId } = useDomain();

  // Fetch last run per agent (stale 5 min, background only)
  const { data: recentRuns = [] } = useQuery<AgentRun[]>({
    queryKey: ["/api/agents/runs-sidebar", ga4PropertyId],
    queryFn: async () => {
      if (!ga4PropertyId) return [];
      const res = await fetch(`/api/agents/runs?tenantId=${encodeURIComponent(ga4PropertyId)}&limit=50`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!ga4PropertyId,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  // Build last-run map: agentId → most recent run
  const lastRunByAgent = recentRuns.reduce<Record<string, AgentRun>>((acc, r) => {
    if (!acc[r.agentId]) acc[r.agentId] = r;
    return acc;
  }, {});

  const getInitials = (firstName?: string | null, lastName?: string | null) => {
    const first = firstName?.charAt(0) || "";
    const last  = lastName?.charAt(0)  || "";
    return (first + last).toUpperCase() || "U";
  };

  return (
    <Sidebar className="border-r border-white/10">
      <SidebarHeader className="p-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl gradient-cyan-purple glow-cyan-sm">
            <LayoutDashboard className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground tracking-tight">
              Reporting Agent
            </h1>
            <p className="text-xs text-muted-foreground">Executive Dashboard</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2">

        {/* ── Analytics ── */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs uppercase tracking-wide text-muted-foreground px-2">
            Analytics
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive =
                  location === item.url ||
                  (item.url !== "/dashboard" && location.startsWith(item.url));
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      className={cn(
                        "transition-colors",
                        isActive && "bg-sidebar-accent text-sidebar-accent-foreground",
                      )}
                    >
                      <Link
                        href={item.url}
                        data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                        {isActive && <ChevronRight className="ml-auto h-4 w-4 text-cyan-400" />}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* ── SEO Agents ── */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs uppercase tracking-wide text-muted-foreground px-2">
            SEO Agents
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {AGENT_IDS.map((id) => {
                const url = `/dashboard/agents/${id.toLowerCase()}`;
                const isActive = location === url;
                const dotColor = agentDotColor(id, lastRunByAgent[id]);
                return (
                  <SidebarMenuItem key={id}>
                    <SidebarMenuButton
                      asChild
                      className={cn(
                        "transition-colors",
                        isActive && "bg-sidebar-accent text-sidebar-accent-foreground",
                      )}
                    >
                      <Link href={url} data-testid={`nav-agent-${id.toLowerCase()}`}>
                        {/* Agent ID chip */}
                        <span className="text-[10px] font-mono text-muted-foreground w-7 shrink-0">
                          {id}
                        </span>
                        <span className="flex-1 truncate text-xs">
                          {AGENT_SHORT_NAMES[id]}
                        </span>
                        <StatusDot color={dotColor} />
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* ── System ── */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs uppercase tracking-wide text-muted-foreground px-2">
            System
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {secondaryItems.map((item) => {
                const isActive = location === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      className={cn(
                        "transition-colors",
                        isActive && "bg-sidebar-accent text-sidebar-accent-foreground",
                      )}
                    >
                      <Link href={item.url} data-testid={`nav-${item.title.toLowerCase()}`}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* ── Sync Status ── */}
        <SidebarGroup className="mt-auto">
          <SidebarGroupLabel className="text-xs uppercase tracking-wide text-muted-foreground px-2">
            Sync Status
          </SidebarGroupLabel>
          <SidebarGroupContent className="px-2 py-2">
            <div className="flex flex-wrap gap-2">
              <StatusBadge status="ok"    label="GA4"     />
              <StatusBadge status="ok"    label="GSC"     />
              <StatusBadge status="stale" label="SEMrush" />
            </div>
          </SidebarGroupContent>
        </SidebarGroup>

      </SidebarContent>

      <SidebarFooter className="p-3 border-t border-white/10">
        <div className="flex items-center gap-3">
          <Avatar className="h-9 w-9 border border-white/10">
            <AvatarImage src={user?.profileImageUrl || undefined} />
            <AvatarFallback className="bg-muted text-foreground text-sm">
              {getInitials(user?.firstName, user?.lastName)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => logout()}
            className="text-muted-foreground"
            data-testid="button-logout"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
