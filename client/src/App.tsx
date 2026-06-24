import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/hooks/use-auth";
import { DomainProvider } from "@/hooks/use-domain";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { DomainSelector } from "@/components/dashboard/domain-selector";
import { Skeleton } from "@/components/ui/skeleton";

import LandingPage from "@/pages/landing";
import SignInPage from "@/pages/auth/sign-in";
import SignUpPage from "@/pages/auth/sign-up";
import ForgotPasswordPage from "@/pages/auth/forgot-password";
import ResetPasswordPage from "@/pages/auth/reset-password";
import ExecutiveOverview from "@/pages/dashboard/executive-overview";
import AiReferrersPage from "@/pages/dashboard/ai-referrers";
import Ga4TrafficPage from "@/pages/dashboard/ga4-traffic";
import AiMentionsPage from "@/pages/dashboard/ai-mentions";
import GscExplorerPage from "@/pages/dashboard/gsc-explorer";
import RankingsPage from "@/pages/dashboard/rankings";
import BacklinksPage from "@/pages/dashboard/backlinks";
import ExportsPage from "@/pages/dashboard/exports";
import ReportPreviewPage from "@/pages/dashboard/report-preview";
import ReviewQueuePage from "@/pages/dashboard/review-queue";
import AgentConsolePage from "@/pages/dashboard/agent-console";
import WeeklyReportPage from "@/pages/dashboard/weekly/weekly-report";
import MonthlyReportPage from "@/pages/dashboard/monthly/monthly-report";
import WorkspaceHomePage from "@/pages/dashboard/workspace-home";
import AgentPage from "@/pages/dashboard/agents/AgentPage";
import SettingsPage from "@/pages/dashboard/settings";
import NotFound from "@/pages/not-found";

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-background grid-pattern flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="flex h-16 w-16 mx-auto items-center justify-center rounded-2xl gradient-cyan-purple glow-cyan animate-pulse">
          <Skeleton className="h-8 w-8 rounded-lg" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-32 mx-auto" />
          <Skeleton className="h-3 w-24 mx-auto" />
        </div>
      </div>
    </div>
  );
}

function DashboardLayout({ children }: { children: React.ReactNode }) {
  const sidebarStyle = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3.5rem",
  };

  return (
    <SidebarProvider style={sidebarStyle as React.CSSProperties}>
      <div className="flex h-screen w-full bg-background grid-pattern">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="sticky top-0 z-50 flex items-center justify-between gap-4 px-4 py-3 border-b border-white/10 bg-background/80 backdrop-blur-sm">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <div className="flex items-center gap-2">
              <DomainSelector />
              <ThemeToggle />
            </div>
          </header>
          <main className="flex-1 overflow-auto p-6">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function DashboardRouter() {
  return (
    <DashboardLayout>
      <Switch>
        <Route path="/dashboard" component={WorkspaceHomePage} />
        <Route path="/dashboard/overview" component={ExecutiveOverview} />
        <Route path="/dashboard/ai-referrers" component={AiReferrersPage} />
        <Route path="/dashboard/traffic" component={Ga4TrafficPage} />
        <Route path="/dashboard/ai-mentions" component={AiMentionsPage} />
        <Route path="/dashboard/gsc" component={GscExplorerPage} />
        <Route path="/dashboard/rankings" component={RankingsPage} />
        <Route path="/dashboard/backlinks" component={BacklinksPage} />
        <Route path="/dashboard/report-preview" component={ReportPreviewPage} />
        <Route path="/dashboard/report" component={ReportPreviewPage} />
        <Route path="/dashboard/weekly" component={WeeklyReportPage} />
        <Route path="/dashboard/monthly" component={MonthlyReportPage} />
        <Route path="/dashboard/agents/:agentId" component={AgentPage} />
        <Route path="/dashboard/review-queue" component={ReviewQueuePage} />
        <Route path="/dashboard/agent-console" component={AgentConsolePage} />
        <Route path="/dashboard/exports" component={ExportsPage} />
        <Route path="/dashboard/settings" component={SettingsPage} />
        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}

function AppContent() {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();

  if (isLoading) {
    return <LoadingScreen />;
  }

  // If user is authenticated and on landing page, redirect to dashboard
  if (user && location === "/") {
    window.location.href = "/dashboard";
    return <LoadingScreen />;
  }

  // If user is not authenticated and trying to access dashboard
  if (!user && location.startsWith("/dashboard")) {
    window.location.href = "/";
    return <LoadingScreen />;
  }

  // Redirect authenticated users away from auth pages
  if (user && (location === "/sign-in" || location === "/sign-up" || location === "/forgot-password" || location.startsWith("/reset-password"))) {
    window.location.href = "/dashboard";
    return <LoadingScreen />;
  }

  return (
    <Switch>
      <Route path="/" component={LandingPage} />
      <Route path="/sign-in" component={SignInPage} />
      <Route path="/sign-up" component={SignUpPage} />
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      <Route path="/dashboard" component={DashboardRouter} />
      <Route path="/dashboard/*" component={DashboardRouter} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="dark">
        <DomainProvider>
          <TooltipProvider>
            <AppContent />
            <Toaster />
          </TooltipProvider>
        </DomainProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
