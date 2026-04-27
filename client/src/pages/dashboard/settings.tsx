import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { useAuth } from "@/hooks/use-auth";
import { useDomain } from "@/hooks/use-domain";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  User,
  Bell,
  Shield,
  Database,
  RefreshCw,
  Globe,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { useSearch } from "wouter";

interface SyncStatus {
  provider: string;
  status: "ok" | "stale" | "failed" | "pending";
  lastSync: string | null;
  configured: boolean;
}

interface GoogleStatus {
  configured: boolean;
  sites: string[];
  message: string;
}

interface SemrushStatus {
  configured: boolean;
  message: string;
}

interface DataForSEOStatus {
  configured: boolean;
  message: string;
}

interface GA4Property {
  id: string;
  displayName: string;
  accountDisplayName: string;
}

interface GSCSite {
  siteUrl: string;
  permissionLevel: string;
}

interface GoogleAccountStatus {
  connected: boolean;
  googleEmail?: string;
  connectedAt?: string;
  ga4Properties?: GA4Property[];
  gscSites?: GSCSite[];
  error?: string;
}

export default function SettingsPage() {
  const { user } = useAuth();
  const { domain, setDomain, ga4PropertyId, setGa4PropertyId, gscSiteUrl, setGscSiteUrl } = useDomain();
  const { toast } = useToast();
  const searchString = useSearch();
  const [notifications, setNotifications] = useState({
    email: true,
    syncAlerts: true,
    weeklyReport: false,
  });
  const [domainInput, setDomainInput] = useState(domain);
  const [ga4PropertyInput, setGa4PropertyInput] = useState(ga4PropertyId);
  const [gscSiteUrlInput, setGscSiteUrlInput] = useState(gscSiteUrl);

  useEffect(() => {
    setDomainInput(domain);
  }, [domain]);

  useEffect(() => {
    setGa4PropertyInput(ga4PropertyId);
  }, [ga4PropertyId]);

  useEffect(() => {
    setGscSiteUrlInput(gscSiteUrl);
  }, [gscSiteUrl]);

  const { data: syncStatus, isLoading: syncLoading } = useQuery<SyncStatus[]>({
    queryKey: ["/api/sync/status"],
  });

  const { data: googleStatus } = useQuery<GoogleStatus>({
    queryKey: ["/api/google/status"],
  });

  const { data: semrushStatus } = useQuery<SemrushStatus>({
    queryKey: ["/api/semrush/status"],
  });

  const { data: dataforseoStatus } = useQuery<DataForSEOStatus>({
    queryKey: ["/api/dataforseo/status"],
  });

  const { data: googleAccount, refetch: refetchGoogleAccount, isLoading: googleAccountLoading } = useQuery<GoogleAccountStatus>({
    queryKey: ["/api/google/account"],
    queryFn: async () => {
      const res = await fetch("/api/google/account", { credentials: "include" });
      return res.json();
    },
  });

  // Show toast when returning from Google OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const googleParam = params.get("google");
    if (googleParam === "connected") {
      toast({ title: "Google account connected", description: "Your GA4 properties and GSC sites are ready to select below." });
      refetchGoogleAccount();
      window.history.replaceState({}, "", "/settings");
    } else if (googleParam === "denied") {
      toast({ title: "Connection cancelled", description: "You did not grant access to Google.", variant: "destructive" });
      window.history.replaceState({}, "", "/settings");
    } else if (googleParam === "error") {
      const msg = params.get("msg") || "Unknown error";
      toast({ title: "Connection failed", description: msg, variant: "destructive" });
      window.history.replaceState({}, "", "/settings");
    } else if (googleParam === "not_configured") {
      toast({ title: "OAuth not configured", description: "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your .env file.", variant: "destructive" });
      window.history.replaceState({}, "", "/settings");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchString]);

  const handleDisconnectGoogle = async () => {
    try {
      const res = await fetch("/api/google/disconnect", { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Failed to disconnect");
      toast({ title: "Google account disconnected" });
      refetchGoogleAccount();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleSelectGA4Property = (prop: GA4Property) => {
    setGa4PropertyId(prop.id);
    queryClient.invalidateQueries({ queryKey: ["/api/metrics/top-pages"] });
    queryClient.invalidateQueries({ queryKey: ["/api/metrics/overview"] });
    toast({ title: "GA4 property selected", description: `${prop.displayName} (${prop.id})` });
  };

  const handleSelectGSCSite = (site: GSCSite) => {
    setGscSiteUrl(site.siteUrl);
    queryClient.invalidateQueries({ queryKey: ["/api/metrics/gsc/queries"] });
    queryClient.invalidateQueries({ queryKey: ["/api/metrics/gsc/pages"] });
    toast({ title: "GSC site selected", description: site.siteUrl });
  };

  const [syncingProviders, setSyncingProviders] = useState<Record<string, boolean>>({});

  const handleSync = async (provider: string) => {
    const providerKey = provider.toLowerCase().replace(/ /g, "");
    setSyncingProviders(prev => ({ ...prev, [providerKey]: true }));
    try {
      const resp = await fetch(`/api/sync/${providerKey}`, { method: "POST", credentials: "include" });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Sync failed");
      toast({
        title: "✅ Cache Cleared",
        description: data.message || `${provider} cache cleared. Fresh data will load on next view.`,
      });
      // Invalidate sync status + all metrics so dashboard refreshes
      queryClient.invalidateQueries({ queryKey: ["/api/sync/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/metrics/overview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/metrics/traffic-trend"] });
      queryClient.invalidateQueries({ queryKey: ["/api/metrics/top-pages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/metrics/rankings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dataforseo/backlinks"] });
    } catch (e: any) {
      toast({
        title: "❌ Sync Error",
        description: e.message,
        variant: "destructive",
      });
    } finally {
      setSyncingProviders(prev => ({ ...prev, [providerKey]: false }));
    }
  };

  const handleSyncAll = async () => {
    setSyncingProviders(prev => ({ ...prev, all: true }));
    try {
      const resp = await fetch("/api/sync/all", { method: "POST", credentials: "include" });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Sync all failed");
      toast({ title: "✅ All Caches Cleared", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/sync/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/metrics"] });
    } catch (e: any) {
      toast({ title: "❌ Error", description: e.message, variant: "destructive" });
    } finally {
      setSyncingProviders(prev => ({ ...prev, all: false }));
    }
  };

  const handleSaveDomain = () => {
    const cleanDomain = domainInput.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    setDomain(cleanDomain);
    queryClient.invalidateQueries({ queryKey: ["/api/metrics/overview"] });
    queryClient.invalidateQueries({ queryKey: ["/api/metrics/rankings"] });
    queryClient.invalidateQueries({ queryKey: ["/api/backlinks"] });
    toast({
      title: "Domain updated",
      description: `Now showing data for ${cleanDomain}`,
    });
  };

  const handleSaveGa4PropertyId = () => {
    const cleanId = ga4PropertyInput.trim();
    setGa4PropertyId(cleanId);
    queryClient.invalidateQueries({ queryKey: ["/api/metrics/top-pages"] });
    queryClient.invalidateQueries({ queryKey: ["/api/metrics/ai-referrers"] });
    toast({
      title: "GA4 Property ID updated",
      description: cleanId ? `GA4 property set to ${cleanId}` : "GA4 property ID cleared",
    });
  };

  const handleSaveGscSiteUrl = () => {
    const cleanUrl = gscSiteUrlInput.trim();
    setGscSiteUrl(cleanUrl);
    queryClient.invalidateQueries({ queryKey: ["/api/metrics/gsc/queries"] });
    queryClient.invalidateQueries({ queryKey: ["/api/metrics/gsc/pages"] });
    toast({
      title: "GSC Site URL updated",
      description: cleanUrl ? `GSC site set to ${cleanUrl}` : "GSC site URL cleared",
    });
  };

  const getInitials = (firstName?: string | null, lastName?: string | null) => {
    const first = firstName?.charAt(0) || "";
    const last = lastName?.charAt(0) || "";
    return (first + last).toUpperCase() || "U";
  };

  const getProviderName = (provider: string) => {
    switch (provider) {
      case "GA4":
        return "Google Analytics 4";
      case "GSC":
        return "Google Search Console";
      case "DataForSEO":
        return "DataForSEO";
      default:
        return provider;
    }
  };

  const formatLastSync = (lastSync: string | null) => {
    if (!lastSync) return "Not synced";
    const date = new Date(lastSync);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="space-y-6" data-testid="settings-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage your account, data sources, and preferences
        </p>
      </div>

      {/* Google Account Connect — full width, shown first */}
      <Card className="border-white/10 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Google Account
          </CardTitle>
          <CardDescription>
            Connect your Google account to auto-discover GA4 properties and GSC sites — no manual IDs required
          </CardDescription>
        </CardHeader>
        <CardContent>
          {googleAccountLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-8 w-48" />
            </div>
          ) : googleAccount?.connected ? (
            <div className="space-y-5">
              {/* Connected account banner */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-green-400">Connected</p>
                    <p className="text-xs text-muted-foreground">{googleAccount.googleEmail}</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-400 hover:text-red-300 hover:bg-red-500/10 gap-1.5"
                  onClick={handleDisconnectGoogle}
                >
                  <AlertCircle className="h-4 w-4" />
                  Disconnect
                </Button>
              </div>

              {/* GA4 Properties */}
              {googleAccount.ga4Properties && googleAccount.ga4Properties.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm text-muted-foreground">Select GA4 Property</Label>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {googleAccount.ga4Properties.map((prop) => (
                      <button
                        key={prop.id}
                        onClick={() => handleSelectGA4Property(prop)}
                        className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors text-sm ${
                          ga4PropertyId === prop.id
                            ? "bg-cyan-500/15 border-cyan-500/40 text-cyan-300"
                            : "bg-muted/30 border-white/5 hover:bg-muted/50 hover:border-white/10"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium truncate">{prop.displayName}</p>
                            <p className="text-xs text-muted-foreground truncate">{prop.accountDisplayName} · ID: {prop.id}</p>
                          </div>
                          {ga4PropertyId === prop.id && (
                            <CheckCircle2 className="h-4 w-4 text-cyan-400 shrink-0" />
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* GSC Sites */}
              {googleAccount.gscSites && googleAccount.gscSites.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm text-muted-foreground">Select GSC Site</Label>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {googleAccount.gscSites.map((site) => (
                      <button
                        key={site.siteUrl}
                        onClick={() => handleSelectGSCSite(site)}
                        className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors text-sm ${
                          gscSiteUrl === site.siteUrl
                            ? "bg-green-500/15 border-green-500/40 text-green-300"
                            : "bg-muted/30 border-white/5 hover:bg-muted/50 hover:border-white/10"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium truncate">{site.siteUrl}</p>
                            <p className="text-xs text-muted-foreground capitalize">{site.permissionLevel?.replace("sitePermissionLevel", "")}</p>
                          </div>
                          {gscSiteUrl === site.siteUrl && (
                            <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {googleAccount.ga4Properties?.length === 0 && googleAccount.gscSites?.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No GA4 properties or GSC sites found in this Google account.
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-start gap-4">
              <p className="text-sm text-muted-foreground">
                Sign in with Google to automatically discover your GA4 properties and Search Console sites. You won't need to enter any IDs manually.
              </p>
              <a href="/api/auth/google/connect">
                <Button className="gap-2 bg-white text-gray-800 hover:bg-gray-100 border border-gray-200">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Sign in with Google
                </Button>
              </a>
              <p className="text-xs text-muted-foreground">
                You'll be asked to grant read-only access to Google Analytics and Search Console.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-white/10 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5 text-cyan-400" />
              Profile
            </CardTitle>
            <CardDescription>Your account information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16 border-2 border-white/10">
                <AvatarImage src={user?.profileImageUrl || undefined} />
                <AvatarFallback className="bg-muted text-foreground text-lg">
                  {getInitials(user?.firstName, user?.lastName)}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="font-semibold text-lg">
                  {user?.firstName} {user?.lastName}
                </p>
                <p className="text-sm text-muted-foreground">{user?.email}</p>
                <Badge variant="secondary" className="mt-1">Admin</Badge>
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-sm text-muted-foreground">First Name</Label>
                <Input
                  defaultValue={user?.firstName || ""}
                  className="bg-muted/50 border-white/10"
                  data-testid="input-first-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm text-muted-foreground">Last Name</Label>
                <Input
                  defaultValue={user?.lastName || ""}
                  className="bg-muted/50 border-white/10"
                  data-testid="input-last-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm text-muted-foreground">Email</Label>
                <Input
                  defaultValue={user?.email || ""}
                  disabled
                  className="bg-muted/30 border-white/10"
                  data-testid="input-email"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-cyan-400" />
              Domain Configuration
            </CardTitle>
            <CardDescription>Configure the domain for SEMrush data</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Domain</Label>
              <div className="flex gap-2">
                <Input
                  value={domainInput}
                  onChange={(e) => setDomainInput(e.target.value)}
                  placeholder="example.com"
                  className="bg-muted/50 border-white/10"
                  data-testid="input-domain-settings"
                />
                <Button 
                  onClick={handleSaveDomain}
                  className="gradient-cyan-purple text-white"
                  data-testid="button-save-domain"
                >
                  Save
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Enter your domain without https:// to fetch rankings and backlinks data from SEMrush
              </p>
            </div>

            {domain && (
              <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-400" />
                  <span className="text-sm text-green-400">Currently tracking: {domain}</span>
                </div>
              </div>
            )}

            {googleStatus?.sites && googleStatus.sites.length > 0 && (
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">Available GSC Properties</Label>
                <div className="space-y-1 max-h-32 overflow-auto">
                  {googleStatus.sites.map((site) => (
                    <div key={site} className="text-sm px-2 py-1 rounded bg-muted/30">
                      {site}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2 pt-4 border-t border-white/10">
              <Label className="text-sm text-muted-foreground">GA4 Property ID</Label>
              <div className="flex gap-2">
                <Input
                  value={ga4PropertyInput}
                  onChange={(e) => setGa4PropertyInput(e.target.value)}
                  placeholder="123456789"
                  className="bg-muted/50 border-white/10"
                  data-testid="input-ga4-property-id"
                />
                <Button 
                  onClick={handleSaveGa4PropertyId}
                  className="gradient-cyan-purple text-white"
                  data-testid="button-save-ga4-property"
                >
                  Save
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Enter your GA4 property ID (numeric) to fetch top pages and AI referrer data
              </p>
              {ga4PropertyId && (
                <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 mt-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-400" />
                    <span className="text-sm text-green-400">GA4 Property: {ga4PropertyId}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2 pt-4 border-t border-white/10">
              <Label className="text-sm text-muted-foreground">GSC Site URL</Label>
              <div className="flex gap-2">
                <Input
                  value={gscSiteUrlInput}
                  onChange={(e) => setGscSiteUrlInput(e.target.value)}
                  placeholder="https://example.com/ or sc-domain:example.com"
                  className="bg-muted/50 border-white/10"
                  data-testid="input-gsc-site-url"
                />
                <Button 
                  onClick={handleSaveGscSiteUrl}
                  className="gradient-cyan-purple text-white"
                  data-testid="button-save-gsc-site"
                >
                  Save
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Enter your GSC site URL exactly as shown in Search Console (e.g., https://example.com/ or sc-domain:example.com)
              </p>
              {gscSiteUrl && (
                <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 mt-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-400" />
                    <span className="text-sm text-green-400">GSC Site: {gscSiteUrl}</span>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-purple-400" />
              Notifications
            </CardTitle>
            <CardDescription>Configure how you receive updates</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="font-medium">Email Notifications</p>
                <p className="text-sm text-muted-foreground">
                  Receive updates via email
                </p>
              </div>
              <Switch
                checked={notifications.email}
                onCheckedChange={(checked) =>
                  setNotifications({ ...notifications, email: checked })
                }
                data-testid="switch-email-notifications"
              />
            </div>

            <div className="flex items-center justify-between py-2">
              <div>
                <p className="font-medium">Sync Failure Alerts</p>
                <p className="text-sm text-muted-foreground">
                  Get notified when data sync fails
                </p>
              </div>
              <Switch
                checked={notifications.syncAlerts}
                onCheckedChange={(checked) =>
                  setNotifications({ ...notifications, syncAlerts: checked })
                }
                data-testid="switch-sync-alerts"
              />
            </div>

            <div className="flex items-center justify-between py-2">
              <div>
                <p className="font-medium">Weekly Report</p>
                <p className="text-sm text-muted-foreground">
                  Receive a summary every Monday
                </p>
              </div>
              <Switch
                checked={notifications.weeklyReport}
                onCheckedChange={(checked) =>
                  setNotifications({ ...notifications, weeklyReport: checked })
                }
                data-testid="switch-weekly-report"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-amber-400" />
              API Configuration
            </CardTitle>
            <CardDescription>Status of your API integrations</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between py-2 border-b border-white/5">
              <div className="flex items-center gap-3">
                {googleStatus?.configured ? (
                  <CheckCircle2 className="h-5 w-5 text-green-400" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-amber-400" />
                )}
                <div>
                  <p className="font-medium">Google APIs</p>
                  <p className="text-sm text-muted-foreground">
                    GSC & GA4 Integration
                  </p>
                </div>
              </div>
              <Badge variant={googleStatus?.configured ? "secondary" : "outline"}>
                {googleStatus?.configured ? "Connected" : "Not Configured"}
              </Badge>
            </div>

            <div className="flex items-center justify-between py-2 border-b border-white/5">
              <div className="flex items-center gap-3">
                {semrushStatus?.configured ? (
                  <CheckCircle2 className="h-5 w-5 text-green-400" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-amber-400" />
                )}
                <div>
                  <p className="font-medium">SEMrush API</p>
                  <p className="text-sm text-muted-foreground">
                    Rankings & Backlinks
                  </p>
                </div>
              </div>
              <Badge variant={semrushStatus?.configured ? "secondary" : "outline"}>
                {semrushStatus?.configured ? "Connected" : "Not Configured"}
              </Badge>
            </div>

            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-3">
                {dataforseoStatus?.configured ? (
                  <CheckCircle2 className="h-5 w-5 text-green-400" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-amber-400" />
                )}
                <div>
                  <p className="font-medium">DataForSEO API</p>
                  <p className="text-sm text-muted-foreground">
                    Keywords & SERP Data
                  </p>
                </div>
              </div>
              <Badge variant={dataforseoStatus?.configured ? "secondary" : "outline"}>
                {dataforseoStatus?.configured ? "Connected" : "Not Configured"}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-card/50 backdrop-blur-sm lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5 text-cyan-400" />
                Data Sources
              </CardTitle>
              <CardDescription>Status of your connected data integrations. Click Sync to force-refresh a source.</CardDescription>
            </div>
            <Button
              onClick={handleSyncAll}
              disabled={syncingProviders["all"]}
              className="gradient-cyan-purple text-white gap-1.5 shrink-0"
              data-testid="button-sync-all"
            >
              <RefreshCw className={`h-4 w-4 ${syncingProviders["all"] ? "animate-spin" : ""}`} />
              {syncingProviders["all"] ? "Refreshing All..." : "Refresh All Data"}
            </Button>
          </CardHeader>
          <CardContent>
            {syncLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {syncStatus?.map((source) => (
                  <div
                    key={source.provider}
                    className="flex items-center justify-between p-4 rounded-lg bg-muted/30 border border-white/5"
                  >
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-lg bg-muted/50 flex items-center justify-center">
                        {source.status === "ok" ? (
                          <CheckCircle2 className="h-5 w-5 text-green-400" />
                        ) : source.status === "failed" ? (
                          <AlertCircle className="h-5 w-5 text-red-400" />
                        ) : (
                          <Database className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium">{getProviderName(source.provider)}</p>
                        <p className="text-sm text-muted-foreground">
                          {source.configured
                            ? source.lastSync
                              ? `Last fetched: ${formatLastSync(source.lastSync)}`
                              : "⏳ Not fetched yet — click Sync"
                            : "❌ Not configured"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge status={source.status} />
                      {source.configured && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleSync(source.provider)}
                          disabled={syncingProviders[source.provider.toLowerCase().replace(/ /g, "")]}
                          className="gap-1.5"
                          data-testid={`button-sync-${source.provider.toLowerCase()}`}
                        >
                          <RefreshCw className={`h-4 w-4 ${
                            syncingProviders[source.provider.toLowerCase().replace(/ /g, "")] ? "animate-spin" : ""
                          }`} />
                          {syncingProviders[source.provider.toLowerCase().replace(/ /g, "")] ? "Syncing..." : "Sync"}
                        </Button>
                      )}
                      <a
                        href={
                          source.provider === "GA4"
                            ? "https://analytics.google.com"
                            : source.provider === "GSC"
                            ? "https://search.google.com/search-console"
                            : source.provider === "SEMrush"
                            ? "https://www.semrush.com"
                            : "https://app.dataforseo.com"
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
