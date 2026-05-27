import { useLocation, Link } from "wouter";
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
import { StatusBadge } from "./dashboard/status-badge";
import { cn } from "@/lib/utils";

const navItems = [
  {
    title: "Workspace",
    url: "/dashboard",
    icon: Home,
  },
  {
    title: "Executive Overview",
    url: "/dashboard/overview",
    icon: LayoutDashboard,
  },
  {
    title: "Traffic",
    url: "/dashboard/traffic",
    icon: Activity,
  },
  {
    title: "AI Referrers",
    url: "/dashboard/ai-referrers",
    icon: Bot,
  },
  {
    title: "AI Mentions",
    url: "/dashboard/ai-mentions",
    icon: Sparkles,
  },
  {
    title: "Search Console",
    url: "/dashboard/gsc",
    icon: Search,
  },
  {
    title: "Rankings",
    url: "/dashboard/rankings",
    icon: TrendingUp,
  },
  {
    title: "Backlinks",
    url: "/dashboard/backlinks",
    icon: Link2,
  },
];

const secondaryItems = [
  {
    title: "Report Preview",
    url: "/dashboard/report-preview",
    icon: FileText,
  },
  {
    title: "Weekly Report",
    url: "/dashboard/weekly",
    icon: CalendarDays,
  },
  {
    title: "Monthly Report",
    url: "/dashboard/monthly",
    icon: CalendarRange,
  },
  {
    title: "Review Queue",
    url: "/dashboard/review-queue",
    icon: ClipboardList,
  },
  {
    title: "Agent Console",
    url: "/dashboard/agent-console",
    icon: Terminal,
  },
  {
    title: "Exports",
    url: "/dashboard/exports",
    icon: FileDown,
  },
  {
    title: "Settings",
    url: "/dashboard/settings",
    icon: Settings,
  },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const getInitials = (firstName?: string | null, lastName?: string | null) => {
    const first = firstName?.charAt(0) || "";
    const last = lastName?.charAt(0) || "";
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
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs uppercase tracking-wide text-muted-foreground px-2">
            Analytics
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = location === item.url || 
                  (item.url !== "/dashboard" && location.startsWith(item.url));
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      className={cn(
                        "transition-colors",
                        isActive && "bg-sidebar-accent text-sidebar-accent-foreground"
                      )}
                    >
                      <Link href={item.url} data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, '-')}`}>
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
                        isActive && "bg-sidebar-accent text-sidebar-accent-foreground"
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

        <SidebarGroup className="mt-auto">
          <SidebarGroupLabel className="text-xs uppercase tracking-wide text-muted-foreground px-2">
            Sync Status
          </SidebarGroupLabel>
          <SidebarGroupContent className="px-2 py-2">
            <div className="flex flex-wrap gap-2">
              <StatusBadge status="ok" label="GA4" />
              <StatusBadge status="ok" label="GSC" />
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
