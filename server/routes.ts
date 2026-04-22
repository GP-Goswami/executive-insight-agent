import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./lib/auth";
import { getSemrushClient, hasSemrushApiKey } from "./lib/semrush";
import {
  hasGoogleCredentials,
  getAnalyticsDataClient,
  getGSCTable,
  getGSCSummary,
  getGSCTopKeywords,
  getGSCSites,
  getGSCRankings,
  getGSCMonthlyAggregation,
  getGA4Metrics,
  getGA4TrafficMetrics,
  getGA4TopPagesExtended,
  getGA4DailyTraffic,
  getGA4TopPages,
  getGA4TrafficSources,
  getGA4AIReferrers,
} from "./lib/google-apis";
import { getOrchestratedData } from "./lib/analytics-orchestrator";
import { debugLog } from "./lib/debug";
import {
  isDataForSEOConfigured,
  getKeywordData,
  getDomainBacklinks,
  getDomainMetrics,
  getSerpResults,
  getReferringDomains,
} from "./lib/dataforseo";
import { randomBytes } from "crypto";
import { subDays, format, startOfDay } from "date-fns";
import {
  runPrompt,
  runPromptSet,
  getPromptSetResults,
  getAiMentionsStats,
} from "./lib/ai-mentions";
import {
  aiPromptSets,
  aiPrompts,
  aiBrandEntities,
  aiPromptRuns,
  aiMentions,
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { db } from "./db";
import { fetchWithCache, clearProviderCache, getCacheStatus } from "./lib/cache";
import { ga4Data, gscData, semrushData, backlinkData } from "@shared/schema";

const ga4PropertyCache = new Map<string, string>();

function cacheGA4Property(propertyId: string, domain?: string) {
  if (propertyId) {
    ga4PropertyCache.set("_last", propertyId);
    if (domain) {
      ga4PropertyCache.set(domain.toLowerCase(), propertyId);
    }
  }
}

function getCachedGA4Property(domain: string): string | undefined {
  const cached = ga4PropertyCache.get(domain.toLowerCase());
  if (cached) return cached;
  return ga4PropertyCache.get("_last");
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Setup authentication
  await setupAuth(app);
  registerAuthRoutes(app);

  // ─── SYNC STATUS ENDPOINT ───────────────────────────────────────────────────
  // GET /api/sync/status — returns last-fetched timestamps from cache tables
  app.get("/api/sync/status", isAuthenticated, async (_req, res) => {
    try {
      const status = await getCacheStatus();
      res.json([
        {
          provider: "GA4",
          status: status.ga4.count > 0 ? "ok" : "pending",
          lastSync: status.ga4.fetchedAt,
          configured: hasGoogleCredentials(),
          cachedItems: status.ga4.count,
        },
        {
          provider: "GSC",
          status: status.gsc.count > 0 ? "ok" : "pending",
          lastSync: status.gsc.fetchedAt,
          configured: hasGoogleCredentials(),
          cachedItems: status.gsc.count,
        },
        {
          provider: "SEMrush",
          status: status.semrush.count > 0 ? "ok" : "pending",
          lastSync: status.semrush.fetchedAt,
          configured: hasSemrushApiKey(),
          cachedItems: status.semrush.count,
        },
        {
          provider: "DataForSEO",
          status: status.backlinks.count > 0 ? "ok" : "pending",
          lastSync: status.backlinks.fetchedAt,
          configured: isDataForSEOConfigured(),
          cachedItems: status.backlinks.count,
        },
      ]);
    } catch (e: any) {
      console.error("[/api/sync/status] Failed:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── MANUAL SYNC / REFRESH ENDPOINT ─────────────────────────────────────────
  // POST /api/sync/:provider — wipes cache for provider so next request re-fetches live
  app.post("/api/sync/:provider", isAuthenticated, async (req, res) => {
    const raw = req.params.provider.toLowerCase();
    const providerMap: Record<string, "ga4" | "gsc" | "semrush" | "backlinks"> = {
      ga4: "ga4",
      gsc: "gsc",
      semrush: "semrush",
      dataforseo: "backlinks",
      backlinks: "backlinks",
    };
    const provider = providerMap[raw];
    if (!provider) {
      return res.status(400).json({ error: `Unknown provider: ${raw}. Use ga4, gsc, semrush, or dataforseo.` });
    }
    try {
      await clearProviderCache(provider);
      res.json({
        success: true,
        message: `Cache cleared for ${raw.toUpperCase()}. Data will be freshly fetched on next dashboard load.`,
      });
    } catch (e: any) {
      console.error(`[/api/sync/${raw}] Failed:`, e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── FETCH-ALL SYNC ENDPOINT ─────────────────────────────────────────────────
  // POST /api/sync/all — wipes ALL provider caches at once
  app.post("/api/sync/all", isAuthenticated, async (_req, res) => {
    try {
      await Promise.all([
        clearProviderCache("ga4"),
        clearProviderCache("gsc"),
        clearProviderCache("semrush"),
        clearProviderCache("backlinks"),
      ]);
      res.json({
        success: true,
        message: "All caches cleared. All data will be freshly fetched on next dashboard load.",
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.use("/api/metrics", async (req, _res, next) => {
    const propertyId = req.query.propertyId as string;
    if (propertyId) {
      const domain = req.query.domain as string;
      cacheGA4Property(propertyId, domain);
      if (req.session) {
        (req.session as any).ga4PropertyId = propertyId;
      }
      try {
        const allProperties = await storage.getProperties();
        const existing = allProperties.find(p => p.ga4PropertyId === propertyId && (!domain || p.name === domain));
        if (!existing && domain) {
          let clientId: string | undefined;
          const clients = await storage.getClients();
          if (clients.length > 0) {
            clientId = clients[0].id;
          } else {
            const newClient = await storage.createClient({ name: domain, status: "active" });
            clientId = newClient.id;
          }
          await storage.createProperty({
            clientId: clientId!,
            name: domain,
            ga4PropertyId: propertyId,
            gscSiteUrl: null,
            semrushProjectId: null,
            timezone: "UTC",
          });
          debugLog("middleware", `Auto-created property record: ga4PropertyId=${propertyId}, domain=${domain}`);
        } else if (existing && domain && existing.name !== domain) {
          debugLog("middleware", `Property already exists for ga4PropertyId=${propertyId}, domain=${domain}`);
        }
      } catch (err) {
        debugLog("middleware", `Failed to auto-create property: ${err}`);
      }
    }
    next();
  });

  // Health check - tests all external API integrations
  app.get("/api/health", async (_req, res) => {
    const timestamp = new Date().toISOString();
    console.log(`\n[/api/health] ========== API HEALTH CHECK START (${timestamp}) ==========`);

    const envStatus: Record<string, string> = {
      GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? "set" : "missing",
      SEMRUSH_API_KEY: process.env.SEMRUSH_API_KEY ? "set" : "missing",
      DATAFORSEO_LOGIN: process.env.DATAFORSEO_LOGIN ? "set" : "missing",
      DATAFORSEO_PASSWORD: process.env.DATAFORSEO_PASSWORD ? "set" : "missing",
      RESEND_API_KEY: process.env.RESEND_API_KEY ? "set" : "missing",
      DATABASE_URL: process.env.DATABASE_URL ? "set" : "missing",
      SESSION_SECRET: process.env.SESSION_SECRET ? "set" : "missing",
    };
    console.log("[/api/health] Environment variables:", JSON.stringify(envStatus));

    type ApiStatus = { status: "working" | "not configured" | "error"; detail: string; responseTime?: number };
    const results: Record<string, ApiStatus> = {};

    // --- GA4 ---
    const ga4Start = Date.now();
    if (hasGoogleCredentials()) {
      try {
        console.log("[/api/health] [GA4] Testing connection via analyticsdata client...");
        const client = await getAnalyticsDataClient();
        if (!client) throw new Error("Failed to initialize Analytics Data client");
        console.log("[/api/health] [GA4] Client initialized successfully");
        results.ga4 = { status: "working", detail: "Analytics Data client initialized and authenticated", responseTime: Date.now() - ga4Start };
        console.log(`[/api/health] [GA4] ✓ WORKING (${results.ga4.responseTime}ms)`);
      } catch (e: any) {
        results.ga4 = { status: "error", detail: e.message, responseTime: Date.now() - ga4Start };
        console.error(`[/api/health] [GA4] ✗ ERROR (${results.ga4.responseTime}ms): ${e.message}`);
        if (e.stack) console.error("[/api/health] [GA4] Stack:", e.stack);
      }
    } else {
      results.ga4 = { status: "not configured", detail: "GOOGLE_SERVICE_ACCOUNT_JSON environment variable is missing" };
      console.log("[/api/health] [GA4] ⚠ NOT CONFIGURED - Missing GOOGLE_SERVICE_ACCOUNT_JSON");
    }

    // --- Google Search Console ---
    const gscStart = Date.now();
    if (hasGoogleCredentials()) {
      try {
        console.log("[/api/health] [GSC] Testing connection via sites.list...");
        const sites = await getGSCSites();
        results.gsc = { status: "working", detail: `Connected. Found ${sites.length} site(s): ${sites.join(", ") || "(none)"}`, responseTime: Date.now() - gscStart };
        console.log(`[/api/health] [GSC] ✓ WORKING (${results.gsc.responseTime}ms) - ${sites.length} sites found`);
      } catch (e: any) {
        results.gsc = { status: "error", detail: e.message, responseTime: Date.now() - gscStart };
        console.error(`[/api/health] [GSC] ✗ ERROR (${results.gsc.responseTime}ms): ${e.message}`);
        if (e.stack) console.error("[/api/health] [GSC] Stack:", e.stack);
      }
    } else {
      results.gsc = { status: "not configured", detail: "GOOGLE_SERVICE_ACCOUNT_JSON environment variable is missing (shared with GA4)" };
      console.log("[/api/health] [GSC] ⚠ NOT CONFIGURED - Missing GOOGLE_SERVICE_ACCOUNT_JSON");
    }

    // --- SEMrush ---
    const semrushStart = Date.now();
    if (hasSemrushApiKey()) {
      try {
        console.log("[/api/health] [SEMrush] Testing connection via domain_rank for google.com...");
        const client = getSemrushClient();
        if (!client) throw new Error("Failed to initialize SEMrush client");
        const testData = await client.getDomainOverview("google.com");
        if (!testData) throw new Error("API returned empty response");
        results.semrush = { status: "working", detail: "API key valid, domain_rank returned data", responseTime: Date.now() - semrushStart };
        console.log(`[/api/health] [SEMrush] ✓ WORKING (${results.semrush.responseTime}ms)`);
      } catch (e: any) {
        results.semrush = { status: "error", detail: e.message, responseTime: Date.now() - semrushStart };
        console.error(`[/api/health] [SEMrush] ✗ ERROR (${results.semrush.responseTime}ms): ${e.message}`);
        if (e.stack) console.error("[/api/health] [SEMrush] Stack:", e.stack);
      }
    } else {
      results.semrush = { status: "not configured", detail: "SEMRUSH_API_KEY environment variable is missing" };
      console.log("[/api/health] [SEMrush] ⚠ NOT CONFIGURED - Missing SEMRUSH_API_KEY");
    }

    // --- DataForSEO ---
    const dfsStart = Date.now();
    if (isDataForSEOConfigured()) {
      try {
        console.log("[/api/health] [DataForSEO] Testing connection via backlinks/summary/live for google.com...");
        const dfsResult = await getDomainMetrics("google.com");
        if (dfsResult) {
          results.dataforseo = { status: "working", detail: "API authenticated, backlinks/summary returned data", responseTime: Date.now() - dfsStart };
          console.log(`[/api/health] [DataForSEO] ✓ WORKING (${results.dataforseo.responseTime}ms)`);
        } else {
          results.dataforseo = { status: "error", detail: "API returned null - likely authentication failure (check credentials at app.dataforseo.com/api-access)", responseTime: Date.now() - dfsStart };
          console.error(`[/api/health] [DataForSEO] ✗ ERROR (${results.dataforseo.responseTime}ms): API returned null (auth failure)`);
        }
      } catch (e: any) {
        results.dataforseo = { status: "error", detail: e.message, responseTime: Date.now() - dfsStart };
        console.error(`[/api/health] [DataForSEO] ✗ ERROR (${results.dataforseo.responseTime}ms): ${e.message}`);
        if (e.stack) console.error("[/api/health] [DataForSEO] Stack:", e.stack);
      }
    } else {
      results.dataforseo = { status: "not configured", detail: "DATAFORSEO_LOGIN and/or DATAFORSEO_PASSWORD environment variables are missing" };
      console.log("[/api/health] [DataForSEO] ⚠ NOT CONFIGURED - Missing DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD");
    }

    // --- Resend (Email) ---
    const resendStart = Date.now();
    if (process.env.RESEND_API_KEY) {
      try {
        console.log("[/api/health] [Resend] Testing connection via GET /api/keys...");
        const resp = await fetch("https://api.resend.com/api-keys", {
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
        });
        if (resp.ok) {
          results.resend = { status: "working", detail: "API key valid", responseTime: Date.now() - resendStart };
          console.log(`[/api/health] [Resend] ✓ WORKING (${results.resend.responseTime}ms)`);
        } else {
          const body = await resp.text();
          results.resend = { status: "error", detail: `HTTP ${resp.status}: ${body}`, responseTime: Date.now() - resendStart };
          console.error(`[/api/health] [Resend] ✗ ERROR (${results.resend.responseTime}ms): HTTP ${resp.status} - ${body}`);
        }
      } catch (e: any) {
        results.resend = { status: "error", detail: e.message, responseTime: Date.now() - resendStart };
        console.error(`[/api/health] [Resend] ✗ ERROR (${results.resend.responseTime}ms): ${e.message}`);
      }
    } else {
      results.resend = { status: "not configured", detail: "RESEND_API_KEY environment variable is missing" };
      console.log("[/api/health] [Resend] ⚠ NOT CONFIGURED - Missing RESEND_API_KEY");
    }

    // --- Database ---
    const dbStart = Date.now();
    try {
      console.log("[/api/health] [Database] Testing connection...");
      const testResult = await storage.getClients();
      results.database = { status: "working", detail: `Connected, ${testResult.length} client(s) found`, responseTime: Date.now() - dbStart };
      console.log(`[/api/health] [Database] ✓ WORKING (${results.database.responseTime}ms)`);
    } catch (e: any) {
      results.database = { status: "error", detail: e.message, responseTime: Date.now() - dbStart };
      console.error(`[/api/health] [Database] ✗ ERROR (${results.database.responseTime}ms): ${e.message}`);
    }

    const allStatuses = Object.values(results).map(r => r.status);
    const overallStatus = allStatuses.every(s => s === "working") ? "all_healthy"
      : allStatuses.some(s => s === "error") ? "has_errors"
      : "partial";

    console.log(`[/api/health] ========== HEALTH CHECK COMPLETE: ${overallStatus} ==========\n`);

    return res.json({
      status: overallStatus,
      timestamp,
      envVars: envStatus,
      apis: results,
    });
  });

  // SEMrush backlinks endpoint
  app.get("/api/semrush-backlinks", async (req, res) => {
    const apiKey = process.env.SEMRUSH_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        status: "error",
        message: "SEMRUSH_API_KEY environment variable is not configured.",
      });
    }

    const domain = (req.query.domain as string) || "truefirms.co";
    const semUrl = `https://api.semrush.com/?type=backlinks_overview&target=${encodeURIComponent(domain)}&target_type=root_domain&key=${apiKey}`;

    console.log(`[/api/semrush-backlinks] Fetching backlinks for ${domain}...`);
    console.log(`[/api/semrush-backlinks] URL: https://api.semrush.com/?type=backlinks_overview&target=${domain}&target_type=root_domain`);

    try {
      const startTime = Date.now();
      const response = await fetch(semUrl);
      const text = await response.text();
      const responseTime = Date.now() - startTime;

      console.log(`[/api/semrush-backlinks] Response received in ${responseTime}ms`);
      console.log(`[/api/semrush-backlinks] Raw response: ${text.substring(0, 1000)}`);

      if (!response.ok || text.startsWith("ERROR")) {
        console.error(`[/api/semrush-backlinks] ✗ API error: ${text.substring(0, 500)}`);
        return res.status(400).json({
          status: "error",
          message: text.trim() || `HTTP ${response.status}`,
          domain,
        });
      }

      const lines = text.trim().split("\n");
      if (lines.length < 2) {
        console.log(`[/api/semrush-backlinks] No data rows returned`);
        return res.json({
          domain,
          total_backlinks: 0,
          referring_domains: 0,
          source: "SEMrush API",
          status: "no data returned",
        });
      }

      const headers = lines[0].split(";").map((h: string) => h.trim().toLowerCase());
      const values = lines[1].split(";");

      const getVal = (key: string): number => {
        const idx = headers.indexOf(key);
        return idx >= 0 ? parseInt(values[idx], 10) || 0 : 0;
      };

      const totalBacklinks = getVal("total");
      const referringDomains = getVal("domains_num");

      console.log(`[/api/semrush-backlinks] ✓ Total backlinks: ${totalBacklinks}, Referring domains: ${referringDomains}`);

      return res.json({
        domain,
        total_backlinks: totalBacklinks,
        referring_domains: referringDomains,
        source: "SEMrush API",
      });
    } catch (e: any) {
      console.error(`[/api/semrush-backlinks] Error: ${e.message}`);
      return res.status(500).json({
        status: "error",
        message: e.message,
      });
    }
  });

  // DataForSEO backlinks summary endpoint
  app.get("/api/backlinks-summary", async (req, res) => {
    const login = process.env.DATAFORSEO_LOGIN;
    const password = process.env.DATAFORSEO_PASSWORD;

    if (!login || !password) {
      return res.status(500).json({
        status: "error",
        message: "DataForSEO credentials not configured. Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD environment variables.",
      });
    }

    const domain = (req.query.domain as string) || "truefirms.co";
    const authHeader = `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
    const url = "https://api.dataforseo.com/v3/backlinks/summary/live";
    const body = [{ target: domain }];

    console.log(`[/api/backlinks-summary] Fetching backlinks summary for ${domain}...`);

    try {
      const startTime = Date.now();
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      const responseTime = Date.now() - startTime;

      console.log(`[/api/backlinks-summary] Response received in ${responseTime}ms`);
      console.log(`[/api/backlinks-summary] API status_code: ${data.status_code}`);
      console.log(`[/api/backlinks-summary] Raw response: ${JSON.stringify(data).substring(0, 3000)}`);

      if (data.status_code !== 20000) {
        console.error(`[/api/backlinks-summary] API error: ${data.status_message}`);
        return res.status(400).json({
          status: "error",
          message: data.status_message || "DataForSEO API returned an error",
          statusCode: data.status_code,
        });
      }

      const taskStatus = data.tasks?.[0]?.status_code;
      const taskMessage = data.tasks?.[0]?.status_message;

      if (taskStatus && taskStatus !== 20000) {
        console.error(`[/api/backlinks-summary] Task error: ${taskStatus} - ${taskMessage}`);
        return res.json({
          domain,
          total_backlinks: 0,
          referring_domains: 0,
          status: taskMessage || "no backlinks found",
          source: "DataForSEO Backlinks API",
        });
      }

      const result = data.tasks?.[0]?.result?.[0];

      if (!result) {
        console.log(`[/api/backlinks-summary] No result data returned`);
        return res.json({
          domain,
          total_backlinks: 0,
          referring_domains: 0,
          status: "no backlinks found",
          source: "DataForSEO Backlinks API",
        });
      }

      const totalBacklinks = result.backlinks || 0;
      const referringDomains = result.referring_domains || 0;

      console.log(`[/api/backlinks-summary] ✓ Total backlinks: ${totalBacklinks}, Referring domains: ${referringDomains}`);

      return res.json({
        domain,
        total_backlinks: totalBacklinks,
        referring_domains: referringDomains,
        source: "DataForSEO Backlinks API",
      });
    } catch (e: any) {
      console.error(`[/api/backlinks-summary] Error: ${e.message}`);
      return res.status(500).json({
        status: "error",
        message: e.message,
      });
    }
  });

  // DataForSEO backlinks endpoint
  app.get("/api/backlinks", async (_req, res) => {
    const login = process.env.DATAFORSEO_LOGIN;
    const password = process.env.DATAFORSEO_PASSWORD;

    if (!login || !password) {
      return res.status(500).json({
        status: "error",
        message: "DataForSEO credentials not configured. Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD environment variables.",
      });
    }

    const authHeader = `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
    const url = "https://api.dataforseo.com/v3/backlinks/backlinks/live";
    const body = [
      {
        target: "truefirms.co",
        limit: 100,
      },
    ];

    console.log(`[/api/backlinks] Fetching backlinks for truefirms.co...`);

    try {
      const startTime = Date.now();
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      const responseTime = Date.now() - startTime;

      console.log(`[/api/backlinks] Response received in ${responseTime}ms`);
      console.log(`[/api/backlinks] API status_code: ${data.status_code}`);
      console.log(`[/api/backlinks] Raw response: ${JSON.stringify(data).substring(0, 3000)}`);

      if (data.status_code !== 20000) {
        console.error(`[/api/backlinks] API error: ${data.status_message}`);
        return res.status(400).json({
          status: "error",
          message: data.status_message || "DataForSEO API returned an error",
          statusCode: data.status_code,
        });
      }

      const result = data.tasks?.[0]?.result?.[0];
      const totalBacklinks = result?.total_count || 0;
      const items = result?.items || [];
      const referringDomains = new Set(
        items
          .filter((item: any) => item.domain_from)
          .map((item: any) => item.domain_from)
      ).size;

      console.log(`[/api/backlinks] ✓ Total backlinks: ${totalBacklinks}, Referring domains (from sample): ${referringDomains}`);

      return res.json({
        domain: "truefirms.co",
        total_backlinks: totalBacklinks,
        referring_domains: referringDomains,
      });
    } catch (e: any) {
      console.error(`[/api/backlinks] Error: ${e.message}`);
      return res.status(500).json({
        status: "error",
        message: e.message,
      });
    }
  });

  // DataForSEO ranking verification endpoint
  app.get("/api/verify-dataforseo", async (_req, res) => {
    const login = process.env.DATAFORSEO_LOGIN;
    const password = process.env.DATAFORSEO_PASSWORD;

    if (!login || !password) {
      return res.status(500).json({
        status: "error",
        message: "DataForSEO credentials not configured. Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD environment variables.",
      });
    }

    const authHeader = `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
    const url = "https://api.dataforseo.com/v3/serp/google/organic/live/advanced";
    const body = [
      {
        keyword: "truefirms",
        location_code: 2840,
        language_code: "en",
        depth: 100,
        target: "truefirms.co",
      },
    ];

    console.log(`[/api/verify-dataforseo] Verifying ranking for "truefirms" / truefirms.co...`);

    try {
      const startTime = Date.now();
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      const responseTime = Date.now() - startTime;

      console.log(`[/api/verify-dataforseo] Response received in ${responseTime}ms`);
      console.log(`[/api/verify-dataforseo] API status_code: ${data.status_code}`);
      console.log(`[/api/verify-dataforseo] Raw response: ${JSON.stringify(data).substring(0, 3000)}`);

      if (data.status_code !== 20000) {
        console.error(`[/api/verify-dataforseo] API error: ${data.status_message}`);
        return res.status(400).json({
          status: "error",
          message: data.status_message || "DataForSEO API returned an error",
          statusCode: data.status_code,
        });
      }

      const items = data.tasks?.[0]?.result?.[0]?.items || [];
      console.log(`[/api/verify-dataforseo] Total SERP items returned: ${items.length}`);

      const match = items.find((item: any) =>
        item.type === "organic" && item.domain && item.domain.includes("truefirms.co")
      );

      if (match) {
        console.log(`[/api/verify-dataforseo] ✓ Found truefirms.co at position ${match.rank_absolute}`);
        console.log(`[/api/verify-dataforseo] URL: ${match.url}`);
        console.log(`[/api/verify-dataforseo] Title: ${match.title}`);
        return res.json({
          keyword: "truefirms",
          domain: match.domain,
          position: match.rank_absolute,
          ranking_url: match.url,
          title: match.title || "",
          description: match.description || "",
          source: "DataForSEO",
        });
      } else {
        console.log(`[/api/verify-dataforseo] ✗ truefirms.co not found in ${items.length} results`);
        return res.json({
          status: "not_found",
          message: "truefirms.co not found in top 100 results",
        });
      }
    } catch (e: any) {
      console.error(`[/api/verify-dataforseo] Error: ${e.message}`);
      return res.status(500).json({
        status: "error",
        message: e.message,
      });
    }
  });

  // Unified API health check - tests all external API integrations
  app.get("/api/check-all-apis", async (_req, res) => {
    const checkedAt = new Date().toISOString();
    console.log(`\n[/api/check-all-apis] ========== CHECK ALL APIs START (${checkedAt}) ==========`);

    const apiStatus: Record<string, string> = {};

    // --- 1. DataForSEO ---
    const dfsLogin = process.env.DATAFORSEO_LOGIN;
    const dfsPassword = process.env.DATAFORSEO_PASSWORD;
    if (!dfsLogin || !dfsPassword) {
      apiStatus.dataforseo = "missing_key";
      console.log("[/api/check-all-apis] [DataForSEO] ⚠ missing_key - DATAFORSEO_LOGIN or DATAFORSEO_PASSWORD not set");
    } else {
      try {
        const authHeader = `Basic ${Buffer.from(`${dfsLogin}:${dfsPassword}`).toString("base64")}`;
        console.log("[/api/check-all-apis] [DataForSEO] Testing SERP API...");
        const dfsStart = Date.now();
        const dfsResp = await fetch("https://api.dataforseo.com/v3/serp/google/organic/live/advanced", {
          method: "POST",
          headers: { "Authorization": authHeader, "Content-Type": "application/json" },
          body: JSON.stringify([{ keyword: "seo tools", location_code: 2840, language_code: "en", depth: 5 }]),
        });
        const dfsData = await dfsResp.json();
        const dfsTime = Date.now() - dfsStart;
        if (dfsData.status_code === 20000) {
          apiStatus.dataforseo = "working";
          console.log(`[/api/check-all-apis] [DataForSEO] ✓ working (${dfsTime}ms)`);
        } else if (dfsData.status_code === 40100 || dfsData.status_code === 40101) {
          apiStatus.dataforseo = "failed";
          console.error(`[/api/check-all-apis] [DataForSEO] ✗ authentication failed (${dfsTime}ms): ${dfsData.status_message}`);
        } else {
          apiStatus.dataforseo = "failed";
          console.error(`[/api/check-all-apis] [DataForSEO] ✗ failed (${dfsTime}ms): status_code=${dfsData.status_code} - ${dfsData.status_message}`);
        }
      } catch (e: any) {
        apiStatus.dataforseo = "failed";
        console.error(`[/api/check-all-apis] [DataForSEO] ✗ network error: ${e.message}`);
      }
    }

    // --- 2. SEMrush ---
    const semrushKey = process.env.SEMRUSH_API_KEY;
    if (!semrushKey) {
      apiStatus.semrush = "missing_key";
      console.log("[/api/check-all-apis] [SEMrush] ⚠ missing_key - SEMRUSH_API_KEY not set");
    } else {
      try {
        console.log("[/api/check-all-apis] [SEMrush] Testing domain_ranks for google.com...");
        const semStart = Date.now();
        const semUrl = `https://api.semrush.com/?type=domain_ranks&key=${semrushKey}&domain=google.com&database=us`;
        const semResp = await fetch(semUrl);
        const semText = await semResp.text();
        const semTime = Date.now() - semStart;
        if (semResp.ok && semText && !semText.startsWith("ERROR")) {
          apiStatus.semrush = "working";
          console.log(`[/api/check-all-apis] [SEMrush] ✓ working (${semTime}ms)`);
        } else {
          apiStatus.semrush = "failed";
          console.error(`[/api/check-all-apis] [SEMrush] ✗ failed (${semTime}ms): ${semText.substring(0, 200)}`);
        }
      } catch (e: any) {
        apiStatus.semrush = "failed";
        console.error(`[/api/check-all-apis] [SEMrush] ✗ network error: ${e.message}`);
      }
    }

    // --- 3. Google Search Console ---
    if (!hasGoogleCredentials()) {
      apiStatus.google_search_console = "missing_key";
      console.log("[/api/check-all-apis] [GSC] ⚠ missing_key - GOOGLE_SERVICE_ACCOUNT_JSON not set");
    } else {
      try {
        console.log("[/api/check-all-apis] [GSC] Testing sites.list via service account...");
        const gscStart = Date.now();
        const sites = await getGSCSites();
        const gscTime = Date.now() - gscStart;
        apiStatus.google_search_console = "working";
        console.log(`[/api/check-all-apis] [GSC] ✓ working (${gscTime}ms) - ${sites.length} site(s) found`);
      } catch (e: any) {
        apiStatus.google_search_console = "failed";
        console.error(`[/api/check-all-apis] [GSC] ✗ failed: ${e.message}`);
      }
    }

    // --- 4. GA4 (Google Analytics) ---
    if (!hasGoogleCredentials()) {
      apiStatus.google_analytics = "missing_key";
      console.log("[/api/check-all-apis] [GA4] ⚠ missing_key - GOOGLE_SERVICE_ACCOUNT_JSON not set");
    } else {
      try {
        console.log("[/api/check-all-apis] [GA4] Testing Analytics Data client...");
        const ga4Start = Date.now();
        const client = await getAnalyticsDataClient();
        const ga4Time = Date.now() - ga4Start;
        if (client) {
          apiStatus.google_analytics = "working";
          console.log(`[/api/check-all-apis] [GA4] ✓ working (${ga4Time}ms)`);
        } else {
          apiStatus.google_analytics = "failed";
          console.error(`[/api/check-all-apis] [GA4] ✗ failed to initialize client`);
        }
      } catch (e: any) {
        apiStatus.google_analytics = "failed";
        console.error(`[/api/check-all-apis] [GA4] ✗ failed: ${e.message}`);
      }
    }

    // --- 5. OpenAI (via Replit AI Integrations) ---
    const openaiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    if (!openaiKey) {
      apiStatus.openai = "missing_key";
      console.log("[/api/check-all-apis] [OpenAI] ⚠ missing_key - AI_INTEGRATIONS_OPENAI_API_KEY not set");
    } else {
      apiStatus.openai = "working";
      console.log("[/api/check-all-apis] [OpenAI] ✓ working (Replit AI Integration configured, key present)");
    }

    // --- 6. Resend (Email) ---
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      apiStatus.resend = "missing_key";
      console.log("[/api/check-all-apis] [Resend] ⚠ missing_key - RESEND_API_KEY not set");
    } else {
      try {
        console.log("[/api/check-all-apis] [Resend] Testing API key...");
        const resStart = Date.now();
        const resResp = await fetch("https://api.resend.com/api-keys", {
          headers: { Authorization: `Bearer ${resendKey}` },
        });
        const resTime = Date.now() - resStart;
        if (resResp.ok) {
          apiStatus.resend = "working";
          console.log(`[/api/check-all-apis] [Resend] ✓ working (${resTime}ms)`);
        } else {
          apiStatus.resend = "failed";
          console.error(`[/api/check-all-apis] [Resend] ✗ failed (${resTime}ms): HTTP ${resResp.status}`);
        }
      } catch (e: any) {
        apiStatus.resend = "failed";
        console.error(`[/api/check-all-apis] [Resend] ✗ network error: ${e.message}`);
      }
    }

    // --- 7. Database ---
    try {
      console.log("[/api/check-all-apis] [Database] Testing connection...");
      const dbStart = Date.now();
      await storage.getClients();
      const dbTime = Date.now() - dbStart;
      apiStatus.database = "working";
      console.log(`[/api/check-all-apis] [Database] ✓ working (${dbTime}ms)`);
    } catch (e: any) {
      apiStatus.database = "failed";
      console.error(`[/api/check-all-apis] [Database] ✗ failed: ${e.message}`);
    }

    // Note: Ahrefs is not integrated in this project
    apiStatus.ahrefs = "not_integrated";

    console.log(`[/api/check-all-apis] ========== CHECK COMPLETE ==========\n`);

    return res.json({
      api_status: apiStatus,
      checked_at: checkedAt,
    });
  });

  // DataForSEO test endpoint - uses SERP API with Basic Auth to verify credentials
  app.get("/api/test-dataforseo", async (_req, res) => {
    const login = process.env.DATAFORSEO_LOGIN;
    const password = process.env.DATAFORSEO_PASSWORD;

    if (!login || !password) {
      return res.status(500).json({
        success: false,
        error: "DataForSEO credentials not configured. Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD environment variables.",
      });
    }

    const authHeader = `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
    const url = "https://api.dataforseo.com/v3/serp/google/organic/live/advanced";
    const body = [
      {
        keyword: "seo tools",
        location_code: 2840,
        language_code: "en",
        depth: 10,
      },
    ];

    console.log(`[/api/test-dataforseo] Testing DataForSEO SERP API...`);
    console.log(`[/api/test-dataforseo] URL: ${url}`);
    console.log(`[/api/test-dataforseo] Auth: Basic <base64 of login:password>`);

    try {
      const startTime = Date.now();
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const responseTime = Date.now() - startTime;
      const data = await response.json();

      console.log(`[/api/test-dataforseo] Response status: ${response.status} (${responseTime}ms)`);
      console.log(`[/api/test-dataforseo] API status_code: ${data.status_code}`);
      console.log(`[/api/test-dataforseo] API status_message: ${data.status_message}`);

      if (data.status_code === 20000) {
        console.log(`[/api/test-dataforseo] ✓ SUCCESS - credentials are valid`);
        return res.json({
          success: true,
          responseTime,
          data,
        });
      } else {
        console.error(`[/api/test-dataforseo] ✗ FAILED - status_code: ${data.status_code}`);
        return res.status(response.status >= 400 ? response.status : 200).json({
          success: false,
          error: data.status_message || "Unknown DataForSEO error",
          statusCode: data.status_code,
          responseTime,
          data,
        });
      }
    } catch (e: any) {
      console.error(`[/api/test-dataforseo] ✗ ERROR: ${e.message}`);
      return res.status(500).json({
        success: false,
        error: e.message,
      });
    }
  });

  // Full backend diagnostic endpoint
  app.get("/api/diagnostics", isAuthenticated, async (_req, res) => {
    console.log("[/api/diagnostics] Running full backend diagnostic...");
    const results: Record<string, any> = {
      timestamp: new Date().toISOString(),
      routes: {},
      integrations: {},
      envVars: {},
    };

    results.routes = {
      "/api/dashboard": "REGISTERED",
      "/api/metrics/overview": "REGISTERED",
      "/api/metrics/top-pages": "REGISTERED",
      "/api/metrics/traffic-trend": "REGISTERED",
      "/api/metrics/ai-referrers": "REGISTERED",
      "/api/metrics/gsc/queries": "REGISTERED",
      "/api/metrics/gsc/pages": "REGISTERED",
      "/api/metrics/gsc/rankings": "REGISTERED",
      "/api/metrics/gsc/monthly": "REGISTERED",
      "/api/metrics/rankings": "REGISTERED",
      "/api/metrics/backlinks": "REGISTERED",
    };

    results.envVars = {
      GOOGLE_SERVICE_ACCOUNT_JSON: hasGoogleCredentials() ? "SET" : "MISSING",
      SEMRUSH_API_KEY: hasSemrushApiKey() ? "SET" : "MISSING",
      DATAFORSEO_LOGIN: isDataForSEOConfigured() ? "SET" : "MISSING",
      DATAFORSEO_PASSWORD: isDataForSEOConfigured() ? "SET" : "MISSING",
      SESSION_SECRET: process.env.SESSION_SECRET ? "SET" : "MISSING",
      DATABASE_URL: process.env.DATABASE_URL ? "SET" : "MISSING",
    };

    try {
      if (hasGoogleCredentials()) {
        results.integrations.ga4 = { status: "CONFIGURED", detail: "Google service account JSON is set" };
      } else {
        results.integrations.ga4 = { status: "NOT_CONFIGURED", detail: "Missing GOOGLE_SERVICE_ACCOUNT_JSON" };
      }

      if (hasSemrushApiKey()) {
        try {
          const semrush = getSemrushClient()!;
          const testCsv = await semrush.getDomainOverview("google.com");
          results.integrations.semrush = {
            status: "CONNECTED",
            detail: "API key valid, returned data",
            sampleResponse: testCsv ? "Has data" : "Empty response",
          };
        } catch (e: any) {
          results.integrations.semrush = {
            status: "ERROR",
            detail: e.message,
          };
        }
      } else {
        results.integrations.semrush = { status: "NOT_CONFIGURED", detail: "Missing SEMRUSH_API_KEY" };
      }

      if (isDataForSEOConfigured()) {
        try {
          const dfsResult = await getDomainMetrics("google.com");
          results.integrations.dataforseo = {
            status: dfsResult ? "CONNECTED" : "AUTH_ERROR",
            detail: dfsResult ? "API returned data" : "API returned null (likely auth issue)",
          };
        } catch (e: any) {
          results.integrations.dataforseo = {
            status: "ERROR",
            detail: e.message,
          };
        }
      } else {
        results.integrations.dataforseo = { status: "NOT_CONFIGURED", detail: "Missing DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD" };
      }
    } catch (e: any) {
      results.error = e.message;
    }

    console.log("[/api/diagnostics] Results:", JSON.stringify(results, null, 2));
    return res.json(results);
  });

  // SEMrush API status
  app.get("/api/semrush/status", isAuthenticated, async (_req, res) => {
    res.json({
      configured: hasSemrushApiKey(),
      message: hasSemrushApiKey() 
        ? "SEMrush API is configured" 
        : "SEMrush API key not configured. Add SEMRUSH_API_KEY to secrets.",
    });
  });

  // DataForSEO API status
  app.get("/api/dataforseo/status", isAuthenticated, async (_req, res) => {
    res.json({
      configured: isDataForSEOConfigured(),
      message: isDataForSEOConfigured()
        ? "DataForSEO API is configured"
        : "DataForSEO API not configured. Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to secrets.",
    });
  });

  // DataForSEO Keyword Data
  app.get("/api/dataforseo/keywords", isAuthenticated, async (req, res) => {
    try {
      const keywordsParam = req.query.keywords as string;
      if (!keywordsParam) {
        return res.status(400).json({ message: "Keywords parameter is required" });
      }

      if (!isDataForSEOConfigured()) {
        return res.status(503).json({ 
          message: "DataForSEO API not configured",
          configured: false,
        });
      }

      const keywords = keywordsParam.split(",").map(k => k.trim());
      const data = await getKeywordData(keywords);
      res.json({ data, source: "dataforseo" });
    } catch (error) {
      console.error("Error fetching DataForSEO keywords:", error);
      res.status(500).json({ message: "Failed to fetch keyword data" });
    }
  });

  // DataForSEO Domain Metrics
  app.get("/api/dataforseo/domain-metrics", isAuthenticated, async (req, res) => {
    try {
      const domain = req.query.domain as string;
      if (!domain) {
        return res.status(400).json({ message: "Domain parameter is required" });
      }

      if (!isDataForSEOConfigured()) {
        return res.status(503).json({ 
          message: "DataForSEO API not configured",
          configured: false,
        });
      }

      const forceRefresh = req.query.refresh === "true";
      const metrics = await fetchWithCache(
        "backlinks",
        domain,
        "domain-metrics",
        () => getDomainMetrics(domain),
        forceRefresh
      );
      res.json({ data: metrics, source: "dataforseo", cached: !forceRefresh });
    } catch (error) {
      console.error("Error fetching DataForSEO domain metrics:", error);
      res.status(500).json({ message: "Failed to fetch domain metrics" });
    }
  });

  // DataForSEO Backlinks
  app.get("/api/dataforseo/backlinks", isAuthenticated, async (req, res) => {
    try {
      const domain = req.query.domain as string;
      const limit = parseInt(req.query.limit as string) || 100;
      
      if (!domain) {
        return res.status(400).json({ message: "Domain parameter is required" });
      }

      if (!isDataForSEOConfigured()) {
        return res.status(503).json({ 
          message: "DataForSEO API not configured",
          configured: false,
        });
      }

      const forceRefresh = req.query.refresh === "true";
      const backlinks = await fetchWithCache(
        "backlinks",
        domain,
        `backlinks-${limit}`,
        () => getDomainBacklinks(domain, limit),
        forceRefresh
      );
      res.json({ data: backlinks, source: "dataforseo", cached: !forceRefresh });
    } catch (error) {
      console.error("Error fetching DataForSEO backlinks:", error);
      res.status(500).json({ message: "Failed to fetch backlinks" });
    }
  });

  // DataForSEO Referring Domains
  app.get("/api/dataforseo/referring-domains", isAuthenticated, async (req, res) => {
    try {
      const domain = req.query.domain as string;
      const limit = parseInt(req.query.limit as string) || 100;
      
      if (!domain) {
        return res.status(400).json({ message: "Domain parameter is required" });
      }

      if (!isDataForSEOConfigured()) {
        return res.status(503).json({ 
          message: "DataForSEO API not configured",
          configured: false,
        });
      }

      const domains = await getReferringDomains(domain, limit);
      res.json({ data: domains, source: "dataforseo" });
    } catch (error) {
      console.error("Error fetching DataForSEO referring domains:", error);
      res.status(500).json({ message: "Failed to fetch referring domains" });
    }
  });

  // DataForSEO SERP Results
  app.get("/api/dataforseo/serp", isAuthenticated, async (req, res) => {
    try {
      const keyword = req.query.keyword as string;
      
      if (!keyword) {
        return res.status(400).json({ message: "Keyword parameter is required" });
      }

      if (!isDataForSEOConfigured()) {
        return res.status(503).json({ 
          message: "DataForSEO API not configured",
          configured: false,
        });
      }

      const results = await getSerpResults(keyword);
      res.json({ data: results, source: "dataforseo" });
    } catch (error) {
      console.error("Error fetching DataForSEO SERP results:", error);
      res.status(500).json({ message: "Failed to fetch SERP results" });
    }
  });

  // SEMrush Domain Overview
  app.get("/api/semrush/domain-overview", isAuthenticated, async (req, res) => {
    try {
      const domain = req.query.domain as string;
      if (!domain) {
        return res.status(400).json({ message: "Domain parameter is required" });
      }

      const client = getSemrushClient();
      if (!client) {
        return res.status(503).json({ 
          message: "SEMrush API not configured",
          configured: false,
        });
      }

      const overview = await client.getDomainOverview(domain);
      res.json(overview);
    } catch (error) {
      console.error("Error fetching domain overview:", error);
      res.status(500).json({ message: "Failed to fetch domain overview" });
    }
  });

  // Clients
  app.get("/api/clients", isAuthenticated, async (_req, res) => {
    try {
      const clients = await storage.getClients();
      res.json(clients);
    } catch (error) {
      console.error("Error fetching clients:", error);
      res.status(500).json({ message: "Failed to fetch clients" });
    }
  });

  app.get("/api/clients/:id", isAuthenticated, async (req, res) => {
    try {
      const client = await storage.getClient(req.params.id);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      res.json(client);
    } catch (error) {
      console.error("Error fetching client:", error);
      res.status(500).json({ message: "Failed to fetch client" });
    }
  });

  // Properties
  app.get("/api/properties", isAuthenticated, async (req, res) => {
    try {
      const clientId = req.query.clientId as string | undefined;
      const properties = await storage.getProperties(clientId);
      res.json(properties);
    } catch (error) {
      console.error("Error fetching properties:", error);
      res.status(500).json({ message: "Failed to fetch properties" });
    }
  });

  async function persistGA4Metrics(
    ga4PropertyId: string,
    startDate: string,
    endDate: string,
    data: { totalUsers: number; sessions: number; screenPageViews: number }
  ) {
    try {
      const dbPropertyId = await storage.getPropertyIdByGa4Id(ga4PropertyId);
      if (!dbPropertyId) {
        console.log(`[GA4 Persist] No properties record found for GA4 ID ${ga4PropertyId}, skipping DB insert`);
        return;
      }

      const row = {
        date: new Date(startDate),
        propertyId: dbPropertyId,
        totalUsers: data.totalUsers,
        sessions: data.sessions,
        conversions: data.screenPageViews,
      };

      const count = await storage.upsertGa4DailyMetrics([row]);
      console.log(`[GA4 Persist] Inserted/updated ${count} rows into ga4_daily_metrics for property ${ga4PropertyId} (${startDate} to ${endDate})`);
    } catch (err: any) {
      console.error(`[GA4 Persist] Error persisting GA4 metrics: ${err.message}`);
    }
  }

  async function persistGA4TopPages(
    ga4PropertyId: string,
    startDate: string,
    pages: Array<{ page: string; sessions: number; users: number; conversions: number }>
  ) {
    try {
      const dbPropertyId = await storage.getPropertyIdByGa4Id(ga4PropertyId);
      if (!dbPropertyId) {
        console.log(`[GA4 Persist] No properties record for GA4 ID ${ga4PropertyId}, skipping top pages insert`);
        return;
      }

      const rows = pages.map(p => ({
        date: new Date(startDate),
        propertyId: dbPropertyId,
        totalUsers: p.users,
        sessions: p.sessions,
        conversions: p.conversions,
        landingPagePath: p.page,
      }));

      const count = await storage.upsertGa4DailyMetrics(rows);
      console.log(`[GA4 Persist] Inserted/updated ${count} top page rows into ga4_daily_metrics`);
    } catch (err: any) {
      console.error(`[GA4 Persist] Error persisting top pages: ${err.message}`);
    }
  }

  // Metrics Overview
  // 
  // DATA SOURCE DOCUMENTATION:
  // ============================================================
  // METRIC              | SOURCE                       | DATE-FILTERABLE?
  // --------------------|------------------------------|------------------
  // Organic Traffic     | GA4 API (runReport)          | YES - uses startDate/endDate
  // Sessions            | GA4 API (runReport)          | YES - uses startDate/endDate  
  // Pageviews           | GA4 API (runReport)          | YES - uses startDate/endDate
  // Organic Keywords    | SEMrush domain_organic       | NO - aggregated from current keyword list
  // Organic Cost        | SEMrush domain_organic       | NO - aggregated from current keyword list
  // Backlinks           | DataForSEO → SEMrush fallback| NO - snapshot of current state
  // Referring Domains   | DataForSEO → SEMrush fallback| NO - snapshot of current state
  //
  // SEMrush API endpoint: https://api.semrush.com/?type=domain_organic&domain=X
  //   - Returns individual keyword rows
  //   - We aggregate: count = totalKeywords, sum(Tc) = totalTrafficCost
  //   - Snapshot API - same data regardless of date range
  //
  // GA4 API endpoint: analyticsdata.googleapis.com/v1beta/properties/{id}:runReport
  //   - Accepts dateRanges: [{startDate, endDate}]
  //   - Returns different data for different date ranges
  //
  // When APIs fail, we return 0 (not null or "-") for backlinks/referring domains
  // ============================================================
  // Main Executive Overview Endpoint
  app.get("/api/metrics/overview", isAuthenticated, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const domain = req.query.domain as string;
      const rawStart = req.query.start as string;
      const rawEnd = req.query.end as string;
      let propertyId = req.query.propertyId as string;

      if (!domain || !rawStart || !rawEnd) {
        return res.status(400).json({ message: "Domain, start date, and end date are required" });
      }

      // Format dates for Google APIs (yyyy-MM-dd)
      const startDate = format(new Date(rawStart), "yyyy-MM-dd");
      const endDate = format(new Date(rawEnd), "yyyy-MM-dd");

      debugLog("overview", `Request: domain=${domain}, dates=${startDate} to ${endDate}`);

      // 1. Resolve Property and Site URL
      let gscSiteUrl: string | null = null;
      try {
        const allProperties = await storage.getProperties();
        const matchingProperty = allProperties.find(p => {
          const normalizedDomain = domain.replace(/^(https?:\/\/)?(www\.)?/, "").replace(/\/$/, "").replace(/^sc-domain:/, "").toLowerCase();
          const pName = (p.name || "").replace(/^(https?:\/\/)?(www\.)?/, "").replace(/\/$/, "").toLowerCase();
          const pGsc = (p.gscSiteUrl || "").replace(/^(https?:\/\/)?(www\.)?/, "").replace(/\/$/, "").replace(/^sc-domain:/, "").toLowerCase();
          return normalizedDomain === pName || normalizedDomain === pGsc;
        });

        if (matchingProperty) {
          propertyId = propertyId || matchingProperty.ga4PropertyId || "";
          gscSiteUrl = matchingProperty.gscSiteUrl;
          debugLog("overview", `  Resolved property: name="${matchingProperty.name}", gscSiteUrl="${gscSiteUrl}", ga4PropertyId="${propertyId}"`);
        }
      } catch (err) {
        debugLog("overview", `Property resolution error: ${err}`);
      }

      // 2. Execute Orchestrated Fetch
      const response = await getOrchestratedData(
        domain,
        gscSiteUrl || "",
        propertyId || "",
        startDate,
        endDate,
        req.query.refresh === "true"
      );

      return res.json(response);
    } catch (error: any) {
      console.error("Error in orchestrated overview:", error);
      res.status(500).json({ message: "Failed to fetch overview metrics", error: error.message });
    }
  });

  // Traffic Trend - Daily time series from GA4
  // GA4 Traffic Metrics — users, sessions, engaged sessions, avg duration, engagement rate
  app.get("/api/metrics/ga4/traffic", isAuthenticated, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const propertyId = req.query.propertyId as string;
      const startDate = req.query.start
        ? format(new Date(req.query.start as string), "yyyy-MM-dd")
        : format(subDays(new Date(), 30), "yyyy-MM-dd");
      const endDate = req.query.end
        ? format(new Date(req.query.end as string), "yyyy-MM-dd")
        : format(new Date(), "yyyy-MM-dd");

      if (!hasGoogleCredentials()) {
        return res.status(503).json({
          message: "Google Analytics not configured. Add GOOGLE_SERVICE_ACCOUNT_JSON to secrets.",
          configured: false,
        });
      }
      if (!propertyId) {
        return res.status(400).json({
          message: "GA4 property ID is required",
          configured: true,
        });
      }

      const data = await getGA4TrafficMetrics(propertyId, startDate, endDate);
      return res.json({ ...data, source: "ga4" });
    } catch (error: any) {
      console.error("Error fetching GA4 traffic metrics:", error);
      res.status(500).json({ message: "Failed to fetch GA4 traffic metrics", error: error.message });
    }
  });

  // GSC Top Keywords — matches user's exact curl.
  // POST /webmasters/v3/sites/{siteUrl}/searchAnalytics/query with:
  //   { dimensions: ["query"], rowLimit: 100, dataState: "final" }
  // siteUrl, start, end, rowLimit all come from query params (dynamic).
  // The frontend decides how many to DISPLAY (top 10) — backend fetches up to
  // rowLimit so we have headroom to re-sort / filter later.
  app.get("/api/metrics/gsc/top-keywords", isAuthenticated, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const siteUrl = req.query.siteUrl as string;
      const parseYmdLocal = (s: string): string => {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        if (m) return s; // already a valid YYYY-MM-DD, pass through as-is
        return format(new Date(s), "yyyy-MM-dd");
      };
      const startDate = req.query.start
        ? parseYmdLocal(req.query.start as string)
        : format(subDays(new Date(), 30), "yyyy-MM-dd");
      const endDate = req.query.end
        ? parseYmdLocal(req.query.end as string)
        : format(new Date(), "yyyy-MM-dd");
      const rowLimit = parseInt(req.query.rowLimit as string) || 100;

      if (!hasGoogleCredentials()) {
        return res.status(503).json({
          message: "Google Search Console not configured. Add GOOGLE_SERVICE_ACCOUNT_JSON to secrets.",
          configured: false,
          data: [],
        });
      }
      if (!siteUrl) {
        return res.status(400).json({
          message: "Site URL is required",
          configured: true,
          data: [],
        });
      }

      const data = await getGSCTopKeywords(siteUrl, startDate, endDate, rowLimit);
      return res.json({ data, source: "gsc", dataState: "final", rowLimit });
    } catch (error: any) {
      console.error("Error fetching GSC top keywords:", error);
      res.status(500).json({ message: "Failed to fetch GSC top keywords", error: error.message });
    }
  });

  // GA4 Top Pages (extended) — pagePath dimension with screenPageViews,
  // totalUsers, averageSessionDuration, sessions, engagementRate. Ordered by
  // screenPageViews desc, limit 10. Property ID and dates come from query
  // params so the request is dynamic per user selection.
  app.get("/api/metrics/ga4/top-pages-extended", isAuthenticated, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const propertyId = req.query.propertyId as string;
      const startDate = req.query.start
        ? format(new Date(req.query.start as string), "yyyy-MM-dd")
        : format(subDays(new Date(), 30), "yyyy-MM-dd");
      const endDate = req.query.end
        ? format(new Date(req.query.end as string), "yyyy-MM-dd")
        : format(new Date(), "yyyy-MM-dd");
      const limit = parseInt(req.query.limit as string) || 10;

      if (!hasGoogleCredentials()) {
        return res.status(503).json({
          message: "Google Analytics not configured. Add GOOGLE_SERVICE_ACCOUNT_JSON to secrets.",
          configured: false,
          data: [],
        });
      }
      if (!propertyId) {
        return res.status(400).json({
          message: "GA4 property ID is required",
          configured: true,
          data: [],
        });
      }

      const data = await getGA4TopPagesExtended(propertyId, startDate, endDate, limit);
      return res.json({ data, source: "ga4" });
    } catch (error: any) {
      console.error("Error fetching GA4 top pages extended:", error);
      res.status(500).json({ message: "Failed to fetch GA4 top pages", error: error.message });
    }
  });

  app.get("/api/metrics/traffic-trend", isAuthenticated, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const propertyId = req.query.propertyId as string;
      const startDate = req.query.start 
        ? format(new Date(req.query.start as string), "yyyy-MM-dd")
        : format(subDays(new Date(), 30), "yyyy-MM-dd");
      const endDate = req.query.end 
        ? format(new Date(req.query.end as string), "yyyy-MM-dd")
        : format(new Date(), "yyyy-MM-dd");

      debugLog("traffic-trend", `Request: propertyId=${propertyId}, dates=${startDate} to ${endDate}`);

      if (!hasGoogleCredentials()) {
        return res.status(503).json({ 
          message: "Google Analytics not configured. Add GOOGLE_SERVICE_ACCOUNT_JSON to secrets.",
          configured: false,
          data: [],
        });
      }

      if (!propertyId) {
        return res.status(400).json({ 
          message: "GA4 property ID is required for traffic trend data",
          configured: true,
          data: [],
        });
      }

      const forceRefresh = req.query.refresh === "true";
      const cacheKey = `traffic-trend:${startDate}:${endDate}`;
      const dailyData = await fetchWithCache(
        "ga4",
        propertyId,
        cacheKey,
        () => getGA4DailyTraffic(propertyId, startDate, endDate),
        forceRefresh
      );
      debugLog("traffic-trend", `Returned ${(dailyData as any[]).length} daily data points for ${startDate} to ${endDate}`);

      return res.json({ 
        data: dailyData,
        source: "ga4",
        dateFiltered: true,
        cached: !forceRefresh,
      });
    } catch (error) {
      console.error("Error fetching traffic trend:", error);
      res.status(500).json({ message: "Failed to fetch traffic trend from GA4" });
    }
  });

  // Top Pages - Uses GA4 when configured
  app.get("/api/metrics/top-pages", isAuthenticated, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const propertyId = req.query.propertyId as string;
      const startDate = req.query.start 
        ? format(new Date(req.query.start as string), "yyyy-MM-dd")
        : format(subDays(new Date(), 30), "yyyy-MM-dd");
      const endDate = req.query.end 
        ? format(new Date(req.query.end as string), "yyyy-MM-dd")
        : format(new Date(), "yyyy-MM-dd");

      debugLog("top-pages", `Request: propertyId=${propertyId}, dates=${startDate} to ${endDate}`);

      if (!hasGoogleCredentials()) {
        return res.status(503).json({ 
          message: "Google Analytics not configured. Add GOOGLE_SERVICE_ACCOUNT_JSON to secrets.",
          configured: false,
          data: [],
        });
      }

      if (!propertyId) {
        return res.status(400).json({ 
          message: "GA4 property ID is required",
          configured: true,
          data: [],
        });
      }

      const forceRefresh = req.query.refresh === "true";
      const cacheKey = `top-pages:${startDate}:${endDate}`;
      const ga4PagesData = await fetchWithCache(
        "ga4",
        propertyId,
        cacheKey,
        () => getGA4TopPages(propertyId, startDate, endDate, 10),
        forceRefresh
      );
      const pagesArr = (ga4PagesData as any[]) || [];
      debugLog("top-pages", `Returned ${pagesArr.length} pages for ${startDate} to ${endDate}`);

      if (pagesArr.length > 0 && propertyId) {
        persistGA4TopPages(propertyId, startDate, pagesArr);
      }

      return res.json({ data: pagesArr, source: "ga4", dateFiltered: true, cached: !forceRefresh });
    } catch (error) {
      console.error("Error fetching top pages:", error);
      res.status(500).json({ message: "Failed to fetch top pages from GA4" });
    }
  });

  // Dashboard endpoint - Returns GA4 landing pages data in { landingPages: [...] } format
  app.get("/api/dashboard", isAuthenticated, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    console.log("[/api/dashboard] Endpoint hit");
    try {
      const propertyId = req.query.propertyId as string;
      const startDate = req.query.start
        ? format(new Date(req.query.start as string), "yyyy-MM-dd")
        : format(subDays(new Date(), 30), "yyyy-MM-dd");
      const endDate = req.query.end
        ? format(new Date(req.query.end as string), "yyyy-MM-dd")
        : format(new Date(), "yyyy-MM-dd");

      debugLog("dashboard", `Request: propertyId=${propertyId}, dates=${startDate} to ${endDate}`);

      if (!hasGoogleCredentials()) {
        console.log("[/api/dashboard] Google credentials not configured");
        return res.status(503).json({
          error: "Google Analytics not configured. Add GOOGLE_SERVICE_ACCOUNT_JSON to secrets.",
          landingPages: [],
        });
      }

      if (!propertyId) {
        let resolvedPropertyId: string | null = null;

        const sessionPropertyId = (req.session as any)?.ga4PropertyId;
        if (sessionPropertyId) {
          resolvedPropertyId = sessionPropertyId;
        }

        if (!resolvedPropertyId) {
          const domain = req.query.domain as string;
          if (domain) {
            const properties = await storage.getProperties();
            const match = properties?.find((p: any) =>
              p.domain === domain || p.ga4PropertyId
            );
            if (match?.ga4PropertyId) {
              resolvedPropertyId = match.ga4PropertyId;
            }
          }
        }

        if (!resolvedPropertyId) {
          console.log("[/api/dashboard] No GA4 property ID available");
          return res.status(400).json({
            error: "GA4 property ID is required. Pass ?propertyId=XXXXX or configure it in Settings.",
            landingPages: [],
          });
        }

        console.log(`[/api/dashboard] Resolved propertyId from session/db: ${resolvedPropertyId}`);
        const forceRefresh = req.query.refresh === "true";
        const cacheKey = `dashboard-top-pages:${startDate}:${endDate}`;
        const cachedPages = await fetchWithCache(
          "ga4",
          resolvedPropertyId,
          cacheKey,
          () => getGA4TopPages(resolvedPropertyId!, startDate, endDate, 10),
          forceRefresh
        );
        const ga4Data = (cachedPages as any[]) || [];
        console.log(`[/api/dashboard] Raw GA4 response length: ${ga4Data.length}`);
        const result = { landingPages: ga4Data, cached: !forceRefresh };
        console.log(`[/api/dashboard] Final processed output: ${JSON.stringify(result)}`);
        return res.json(result);
      }

      const forceRefresh = req.query.refresh === "true";
      const cacheKey = `dashboard-top-pages:${startDate}:${endDate}`;
      const cachedPages = await fetchWithCache(
        "ga4",
        propertyId,
        cacheKey,
        () => getGA4TopPages(propertyId, startDate, endDate, 10),
        forceRefresh
      );
      const ga4Data = (cachedPages as any[]) || [];
      console.log(`[/api/dashboard] Raw GA4 response length: ${ga4Data.length}`);
      const result = { landingPages: ga4Data, cached: !forceRefresh };
      console.log(`[/api/dashboard] Final processed output: ${JSON.stringify(result)}`);
      return res.json(result);
    } catch (error: any) {
      console.error("[/api/dashboard] Error:", error?.message || error);
      return res.status(500).json({
        error: "Failed to fetch dashboard data from GA4",
        details: error?.message || "Unknown error",
        landingPages: [],
      });
    }
  });

  // AI Referrers - Uses GA4 when configured
  app.get("/api/metrics/ai-referrers", isAuthenticated, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const propertyId = req.query.propertyId as string;
      const startDate = req.query.start 
        ? format(new Date(req.query.start as string), "yyyy-MM-dd")
        : format(subDays(new Date(), 30), "yyyy-MM-dd");
      const endDate = req.query.end 
        ? format(new Date(req.query.end as string), "yyyy-MM-dd")
        : format(new Date(), "yyyy-MM-dd");

      debugLog("ai-referrers", `Request: propertyId=${propertyId}, dates=${startDate} to ${endDate}`);

      if (!hasGoogleCredentials()) {
        return res.status(503).json({ 
          message: "Google Analytics not configured. Add GOOGLE_SERVICE_ACCOUNT_JSON to secrets.",
          configured: false,
          data: [],
        });
      }

      if (!propertyId) {
        return res.status(400).json({ 
          message: "GA4 property ID is required",
          configured: true,
          data: [],
        });
      }

      const aiData = await getGA4AIReferrers(propertyId, startDate, endDate);
      debugLog("ai-referrers", `Returned ${aiData?.length || 0} AI referrers for ${startDate} to ${endDate}`);
      const formattedData = (aiData || []).map((item) => ({
        source: item.source,
        totalUsers: item.users,
        sessions: item.sessions,
        avgSessionDuration: item.avgSessionDuration,
        bounceRate: item.bounceRate,
        topLandingPage: "-",
      }));
      return res.json({ data: formattedData, source: "ga4", dateFiltered: true });
    } catch (error) {
      console.error("Error fetching AI referrers:", error);
      res.status(500).json({ message: "Failed to fetch AI referrers from GA4" });
    }
  });

  // Google API Status
  app.get("/api/google/status", isAuthenticated, async (_req, res) => {
    const configured = hasGoogleCredentials();
    let sites: string[] = [];
    
    if (configured) {
      try {
        sites = await getGSCSites();
      } catch (error) {
        console.error("Error fetching GSC sites:", error);
      }
    }
    
    res.json({
      configured,
      sites,
      message: configured 
        ? `Google APIs configured with ${sites.length} verified sites`
        : "Google service account not configured. Add GOOGLE_SERVICE_ACCOUNT_JSON to secrets.",
    });
  });

  // GSC Sites list
  app.get("/api/gsc/sites", isAuthenticated, async (_req, res) => {
    try {
      const sites = await getGSCSites();
      res.json(sites);
    } catch (error) {
      console.error("Error fetching GSC sites:", error);
      res.status(500).json({ message: "Failed to fetch GSC sites" });
    }
  });

  // GSC Summary - Strict summary using aggregationType: auto
  app.get("/api/metrics/gsc/summary", isAuthenticated, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const siteUrl = req.query.siteUrl as string;
      const startDate = req.query.start 
        ? format(new Date(req.query.start as string), "yyyy-MM-dd")
        : format(subDays(new Date(), 30), "yyyy-MM-dd");
      const endDate = req.query.end 
        ? format(new Date(req.query.end as string), "yyyy-MM-dd")
        : format(new Date(), "yyyy-MM-dd");
      const country = req.query.country as string | undefined;
      const device = req.query.device as string | undefined;

      if (!hasGoogleCredentials()) {
        return res.status(503).json({ 
          message: "Google Search Console not configured.",
          configured: false,
        });
      }

      if (!siteUrl) {
        return res.status(400).json({ 
          message: "Site URL is required. Please configure your GSC site URL in Settings.",
          configured: true,
        });
      }

      debugLog("gsc", `Summary request: ${siteUrl}, ${startDate} to ${endDate}`);
      const summary = await getGSCSummary(siteUrl, startDate, endDate, country, device);
      
      return res.json(summary);
    } catch (error: any) {
      console.error("Error fetching GSC summary:", error);
      res.status(500).json({ 
        message: error.message || "Failed to fetch GSC summary data",
      });
    }
  });

  // GSC Queries - Uses real data when configured
  app.get("/api/metrics/gsc/queries", isAuthenticated, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const siteUrl = req.query.siteUrl as string;
      const startDate = req.query.start 
        ? format(new Date(req.query.start as string), "yyyy-MM-dd")
        : format(subDays(new Date(), 30), "yyyy-MM-dd");
      const endDate = req.query.end 
        ? format(new Date(req.query.end as string), "yyyy-MM-dd")
        : format(new Date(), "yyyy-MM-dd");
      const country = req.query.country as string | undefined;
      const device = req.query.device as string | undefined;

      if (!hasGoogleCredentials()) {
        return res.status(503).json({ 
          message: "Google Search Console not configured. Add GOOGLE_SERVICE_ACCOUNT_JSON to secrets.",
          configured: false,
          data: [],
        });
      }

      if (!siteUrl) {
        return res.status(400).json({ 
          message: "Site URL is required",
          configured: true,
          data: [],
        });
      }

      debugLog("gsc-queries", `Request: siteUrl=${siteUrl}, dates=${startDate} to ${endDate}`);
      debugLog("gsc-queries", `Filters: country=${country || 'all'}, device=${device || 'all'}`);
      
      const forceRefresh = req.query.refresh === "true";
      const cacheKey = `queries:${startDate}:${endDate}-${country || 'all'}-${device || 'all'}`;
      const cachedQueries = await fetchWithCache(
        "gsc",
        siteUrl,
        cacheKey,
        () => getGSCTable(siteUrl, startDate, endDate, "query", 100, country, device),
        forceRefresh
      );
      
      const gscData = (cachedQueries as any[]) || [];
      debugLog("gsc-queries", `Returned ${gscData.length} queries for ${startDate} to ${endDate}`);
      return res.json({ data: gscData, source: "gsc", dateFiltered: true, cached: !forceRefresh });
    } catch (error) {
      console.error("Error fetching GSC queries:", error);
      res.status(500).json({ message: "Failed to fetch GSC queries" });
    }
  });

  // GSC Pages - Uses real data when configured
  app.get("/api/metrics/gsc/pages", isAuthenticated, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const siteUrl = req.query.siteUrl as string;
      const startDate = req.query.start 
        ? format(new Date(req.query.start as string), "yyyy-MM-dd")
        : format(subDays(new Date(), 30), "yyyy-MM-dd");
      const endDate = req.query.end 
        ? format(new Date(req.query.end as string), "yyyy-MM-dd")
        : format(new Date(), "yyyy-MM-dd");
      const country = req.query.country as string | undefined;
      const device = req.query.device as string | undefined;

      if (!hasGoogleCredentials()) {
        return res.status(503).json({ 
          message: "Google Search Console not configured. Add GOOGLE_SERVICE_ACCOUNT_JSON to secrets.",
          configured: false,
          data: [],
        });
      }

      if (!siteUrl) {
        return res.status(400).json({ 
          message: "Site URL is required",
          configured: true,
          data: [],
        });
      }

      debugLog("gsc-pages", `Request: siteUrl=${siteUrl}, dates=${startDate} to ${endDate}`);
      debugLog("gsc-pages", `Filters: country=${country || 'all'}, device=${device || 'all'}`);
      
      const forceRefresh = req.query.refresh === "true";
      const cacheKey = `pages:${startDate}:${endDate}-${country || 'all'}-${device || 'all'}`;
      const cachedPages = await fetchWithCache(
        "gsc",
        siteUrl,
        cacheKey,
        () => getGSCTable(siteUrl, startDate, endDate, "page", 100, country, device),
        forceRefresh
      );
      
      const gscData = (cachedPages as any[]) || [];
      debugLog("gsc-pages", `Returned ${gscData.length} pages for ${startDate} to ${endDate}`);
      return res.json({ data: gscData, source: "gsc", dateFiltered: true, cached: !forceRefresh });
    } catch (error) {
      console.error("Error fetching GSC pages:", error);
      res.status(500).json({ message: "Failed to fetch GSC pages" });
    }
  });

  // GSC Rankings - Keyword performance data from Google Search Console
  app.get("/api/metrics/gsc/rankings", isAuthenticated, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const siteUrl = req.query.siteUrl as string;
      const startDate = req.query.start 
        ? format(new Date(req.query.start as string), "yyyy-MM-dd")
        : format(subDays(new Date(), 30), "yyyy-MM-dd");
      const endDate = req.query.end 
        ? format(new Date(req.query.end as string), "yyyy-MM-dd")
        : format(new Date(), "yyyy-MM-dd");
      const country = req.query.country as string | undefined;
      const device = req.query.device as string | undefined;
      
      const previousDays = Math.round(
        (new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)
      );
      const previousEndDate = format(subDays(new Date(startDate), 1), "yyyy-MM-dd");
      const previousStartDate = format(subDays(new Date(previousEndDate), previousDays), "yyyy-MM-dd");

      if (!hasGoogleCredentials()) {
        return res.status(503).json({ 
          message: "Google Search Console not configured. Add GOOGLE_SERVICE_ACCOUNT_JSON to secrets.",
          configured: false,
          data: [],
        });
      }

      if (!siteUrl) {
        return res.status(400).json({ 
          message: "Site URL is required. Please configure your GSC site URL in Settings.",
          configured: true,
          data: [],
        });
      }

      debugLog("gsc-rankings", `Request: siteUrl=${siteUrl}, current=${startDate} to ${endDate}, previous=${previousStartDate} to ${previousEndDate}`);
      debugLog("gsc-rankings", `Filters: country=${country || 'all'}, device=${device || 'all'}`);
      const rankings = await getGSCRankings(siteUrl, startDate, endDate, previousStartDate, previousEndDate, 500, country, device);
      debugLog("gsc-rankings", `Returned ${rankings.length} keywords for ${startDate} to ${endDate}`);
      
      const totalKeywords = rankings.length;
      const improvements = rankings.filter(r => r.change > 0).length;
      const declines = rankings.filter(r => r.change < 0).length;
      const avgPosition = rankings.length > 0 
        ? Math.round(rankings.reduce((sum, r) => sum + r.position, 0) / rankings.length * 10) / 10
        : 0;

      return res.json({ 
        data: rankings, 
        summary: {
          totalKeywords,
          improvements,
          declines,
          avgPosition,
        },
        source: "gsc",
        dateFiltered: true,
      });
    } catch (error: any) {
      console.error("Error fetching GSC rankings:", error);
      const message = error?.message || "Failed to fetch GSC rankings";
      
      if (message.includes("GSC_PERMISSION_DENIED")) {
        return res.status(403).json({ 
          message: "Service account does not have access to this site. Please add the service account email to Google Search Console with read access.",
          configured: true,
          permissionError: true,
          data: [],
        });
      }
      if (message.includes("GSC_QUOTA_EXCEEDED")) {
        return res.status(429).json({ 
          message: "API quota exceeded. Please try again later.",
          configured: true,
          data: [],
        });
      }
      if (message.includes("GSC_SITE_NOT_FOUND")) {
        return res.status(404).json({ 
          message: "Site not found. Please verify the GSC site URL format (e.g., https://example.com/ or sc-domain:example.com).",
          configured: true,
          data: [],
        });
      }
      
      res.status(500).json({ message: "Failed to fetch GSC rankings" });
    }
  });

  // GSC Monthly Aggregation - For reporting dashboards
  app.get("/api/metrics/gsc/monthly", isAuthenticated, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const siteUrl = req.query.siteUrl as string;
      const startDate = req.query.start 
        ? format(new Date(req.query.start as string), "yyyy-MM-dd")
        : format(subDays(new Date(), 365), "yyyy-MM-dd");
      const endDate = req.query.end 
        ? format(new Date(req.query.end as string), "yyyy-MM-dd")
        : format(new Date(), "yyyy-MM-dd");
      const country = req.query.country as string | undefined;
      const device = req.query.device as string | undefined;

      if (!hasGoogleCredentials()) {
        return res.status(503).json({ 
          message: "Google Search Console not configured.",
          configured: false,
          data: [],
        });
      }

      if (!siteUrl) {
        return res.status(400).json({ 
          message: "Site URL is required.",
          configured: true,
          data: [],
        });
      }

      debugLog("gsc-monthly", `Request: siteUrl=${siteUrl}, dates=${startDate} to ${endDate}`);
      debugLog("gsc-monthly", `Filters: country=${country || 'all'}, device=${device || 'all'}`);
      const monthlyData = await getGSCMonthlyAggregation(siteUrl, startDate, endDate, country, device);
      debugLog("gsc-monthly", `Returned ${monthlyData?.length || 0} months for ${startDate} to ${endDate}`);
      return res.json({ data: monthlyData, source: "gsc", dateFiltered: true });
    } catch (error: any) {
      console.error("Error fetching GSC monthly data:", error);
      const message = error?.message || "";
      
      if (message.includes("GSC_PERMISSION_DENIED")) {
        return res.status(403).json({ 
          message: "Service account does not have access to this site.",
          configured: true,
          permissionError: true,
          data: [],
        });
      }
      
      res.status(500).json({ message: "Failed to fetch GSC monthly data" });
    }
  });

  // Rankings - Uses SEMrush organic keywords (snapshot API - not date-filterable)
  app.get("/api/metrics/rankings", isAuthenticated, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const domain = req.query.domain as string;
      const limit = parseInt(req.query.limit as string) || 50;
      const client = getSemrushClient();

      debugLog("rankings", `Request: domain=${domain}, limit=${limit} (snapshot - not date-filterable)`);

      if (!domain) {
        return res.status(400).json({ 
          message: "Domain parameter is required",
          configured: hasSemrushApiKey(),
          data: [],
        });
      }

      if (!client) {
        return res.status(503).json({ 
          message: "SEMrush API not configured. Add SEMRUSH_API_KEY to secrets.",
          configured: false,
          data: [],
        });
      }

      let keywords;
      try {
        keywords = await client.getOrganicKeywords(domain, limit);
      } catch (keywordsError: any) {
        const errorMessage = keywordsError?.message || "";
        if (errorMessage.includes("NOTHING FOUND")) {
          return res.status(404).json({ 
            message: `No keyword rankings found for domain "${domain}". This domain may not have enough organic rankings tracked by SEMrush.`,
            configured: true,
            noData: true,
            data: [],
          });
        }
        throw keywordsError;
      }
      
      const rankings = keywords.map((kw) => ({
        keyword: kw.keyword,
        position: kw.position,
        previousPosition: kw.previousPosition || kw.position,
        change: kw.positionDifference,
        url: kw.url,
        searchVolume: kw.searchVolume,
        traffic: kw.traffic,
        cpc: kw.cpc,
        location: "US",
        source: "semrush",
      }));
      return res.json(rankings);
    } catch (error: any) {
      console.error("Error fetching rankings:", error);
      const errorMessage = error?.message || "";
      if (errorMessage.includes("NOTHING FOUND")) {
        return res.status(404).json({ 
          message: `No keyword data found for this domain in SEMrush.`,
          configured: true,
          noData: true,
          data: [],
        });
      }
      res.status(500).json({ message: "Failed to fetch rankings from SEMrush" });
    }
  });

  // Backlinks - Uses DataForSEO as primary, SEMrush as fallback (snapshot API - not date-filterable)
  app.get("/api/metrics/backlinks", isAuthenticated, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const domain = req.query.domain as string;
      const limit = parseInt(req.query.limit as string) || 50;
      const client = getSemrushClient();

      debugLog("backlinks", `=== BACKLINKS REQUEST ===`);
      debugLog("backlinks", `  domain=${domain}, limit=${limit} (snapshot - not date-filterable)`);
      debugLog("backlinks", `  DataForSEO configured: ${isDataForSEOConfigured()}`);
      debugLog("backlinks", `  SEMrush configured: ${!!client}`);

      if (!domain) {
        return res.status(400).json({ 
          message: "Domain parameter is required. Please configure your domain in Settings.",
          configured: hasSemrushApiKey() || isDataForSEOConfigured(),
          backlinks: [],
          overview: null,
        });
      }

      // Try DataForSEO first (primary source)
      if (isDataForSEOConfigured()) {
        debugLog("backlinks", `  [DataForSEO] Using as PRIMARY source`);
        debugLog("backlinks", `  [DataForSEO] Calling getDomainBacklinks: target="${domain}", limit=${limit}`);
        debugLog("backlinks", `  [DataForSEO] Calling getDomainMetrics: target="${domain}"`);
        try {
          let domainMetrics = null;
          const backlinksData = await getDomainBacklinks(domain, limit);
          debugLog("backlinks", `  [DataForSEO] getDomainBacklinks returned ${backlinksData.length} items`);
          
          try {
            domainMetrics = await getDomainMetrics(domain);
            debugLog("backlinks", `  [DataForSEO] getDomainMetrics raw response: ${JSON.stringify(domainMetrics)}`);
          } catch (metricsError: any) {
            debugLog("backlinks", `  [DataForSEO] getDomainMetrics FAILED: ${metricsError?.message || metricsError}`);
          }
          
          const backlinks = backlinksData.map((bl) => {
            let sourceDomain = "";
            try {
              sourceDomain = new URL(bl.url.startsWith("http") ? bl.url : `https://${bl.url}`).hostname;
            } catch {
              sourceDomain = bl.url;
            }
            return {
              domain: sourceDomain,
              targetUrl: `https://${domain}`,
              anchorText: bl.anchor,
              discoveredAt: bl.firstSeen,
              type: bl.isDofollow ? "dofollow" : "nofollow",
              source: "dataforseo",
            };
          });

          const result = {
            backlinks,
            overview: domainMetrics ? {
              totalBacklinks: domainMetrics.backlinks,
              referringDomains: domainMetrics.referringDomains,
            } : (backlinks.length > 0 ? {
              totalBacklinks: backlinks.length,
              referringDomains: new Set(backlinks.map(b => b.domain)).size,
            } : null),
            source: "dataforseo",
            dateFiltered: false,
          };
          debugLog("backlinks", `  [DataForSEO] SUCCESS: returning ${backlinks.length} backlinks, overview=${JSON.stringify(result.overview)}`);
          return res.json(result);
        } catch (dataForSeoError: any) {
          debugLog("backlinks", `  [DataForSEO] Backlinks API FAILED: ${dataForSeoError?.message || dataForSeoError}`);
        }
      }

      // Fallback to SEMrush if DataForSEO fails or unavailable
      if (client) {
        debugLog("backlinks", `  [SEMrush] Using as FALLBACK source`);
        debugLog("backlinks", `  [SEMrush] Calling getBacklinks: target="${domain}", limit=${limit}`);
        debugLog("backlinks", `  [SEMrush] Calling getBacklinksOverview: target="${domain}"`);
        try {
          const [backlinksData, overview] = await Promise.all([
            client.getBacklinks(domain, limit),
            client.getBacklinksOverview(domain),
          ]);
          debugLog("backlinks", `  [SEMrush] getBacklinks returned ${backlinksData.length} items`);
          debugLog("backlinks", `  [SEMrush] getBacklinksOverview raw response: ${JSON.stringify(overview)}`);
          
          const backlinks = backlinksData.map((bl) => {
            let sourceDomain = "";
            try {
              sourceDomain = new URL(bl.sourceUrl.startsWith("http") ? bl.sourceUrl : `https://${bl.sourceUrl}`).hostname;
            } catch {
              sourceDomain = bl.sourceUrl;
            }
            return {
              domain: sourceDomain,
              targetUrl: bl.targetUrl,
              anchorText: bl.anchorText,
              discoveredAt: bl.firstSeen,
              type: bl.type,
              source: "semrush",
            };
          });

          debugLog("backlinks", `  [SEMrush] SUCCESS: returning ${backlinks.length} backlinks`);
          return res.json({
            backlinks,
            overview: {
              totalBacklinks: overview.totalBacklinks,
              referringDomains: overview.referringDomains,
            },
            source: "semrush",
            dateFiltered: false,
          });
        } catch (semrushError: any) {
          debugLog("backlinks", `  [SEMrush] Backlinks API FAILED: ${semrushError?.message || semrushError}`);
        }
      }

      // Neither API is working
      if (!client && !isDataForSEOConfigured()) {
        debugLog("backlinks", `  No backlinks API configured`);
        return res.status(503).json({ 
          message: "No backlinks API configured. Add either SEMRUSH_API_KEY or DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD to secrets.",
          configured: false,
          backlinks: [],
          overview: null,
        });
      }

      debugLog("backlinks", `  Both APIs failed or returned no data`);
      return res.status(503).json({
        message: "Backlinks data is not available. DataForSEO and/or SEMrush APIs may require additional credits or subscriptions.",
        configured: true,
        backlinks: [],
        overview: null,
      });
    } catch (error: any) {
      console.error("Error fetching backlinks:", error);
      debugLog("backlinks", `  UNHANDLED ERROR: ${error?.message || error}`);
      res.status(500).json({ message: "Failed to fetch backlinks" });
    }
  });

  // Sync Status
  app.get("/api/sync/status", isAuthenticated, async (_req, res) => {
    try {
      const semrushConfigured = hasSemrushApiKey();
      const googleConfigured = hasGoogleCredentials();
      const dataforseoConfigured = isDataForSEOConfigured();
      const syncStatus = [
        { 
          provider: "GA4", 
          status: googleConfigured ? "ok" : "pending", 
          lastSync: googleConfigured ? new Date().toISOString() : null, 
          configured: googleConfigured,
        },
        { 
          provider: "GSC", 
          status: googleConfigured ? "ok" : "pending", 
          lastSync: googleConfigured ? new Date().toISOString() : null, 
          configured: googleConfigured,
        },
        { 
          provider: "SEMrush", 
          status: semrushConfigured ? "ok" : "pending", 
          lastSync: semrushConfigured ? new Date().toISOString() : null, 
          configured: semrushConfigured,
        },
        { 
          provider: "DataForSEO", 
          status: dataforseoConfigured ? "ok" : "pending", 
          lastSync: dataforseoConfigured ? new Date().toISOString() : null, 
          configured: dataforseoConfigured,
        },
      ];
      res.json(syncStatus);
    } catch (error) {
      console.error("Error fetching sync status:", error);
      res.status(500).json({ message: "Failed to fetch sync status" });
    }
  });

  // Share Links
  app.get("/api/share-links", isAuthenticated, async (req, res) => {
    try {
      const propertyId = req.query.propertyId as string || "default";
      const links = await storage.getShareLinks(propertyId);
      res.json(links);
    } catch (error) {
      console.error("Error fetching share links:", error);
      res.status(500).json({ message: "Failed to fetch share links" });
    }
  });

  app.post("/api/share-links", isAuthenticated, async (req: any, res) => {
    try {
      const { propertyId, filters, dateRange, expiresAt } = req.body;
      const token = randomBytes(16).toString("hex");
      const userId = req.user?.claims?.sub;

      const link = await storage.createShareLink({
        token,
        propertyId: propertyId || "default",
        createdBy: userId,
        filters,
        dateRange,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      });

      res.json(link);
    } catch (error) {
      console.error("Error creating share link:", error);
      res.status(500).json({ message: "Failed to create share link" });
    }
  });

  // Public share link access (no auth required)
  app.get("/api/share/:token", async (req, res) => {
    try {
      const link = await storage.getShareLinkByToken(req.params.token);
      if (!link) {
        return res.status(404).json({ message: "Share link not found" });
      }

      if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
        return res.status(410).json({ message: "Share link has expired" });
      }

      res.json({
        propertyId: link.propertyId,
        filters: link.filters,
        dateRange: link.dateRange,
      });
    } catch (error) {
      console.error("Error fetching share link:", error);
      res.status(500).json({ message: "Failed to fetch share link" });
    }
  });

  // =====================
  // AI MENTIONS ROUTES
  // =====================

  // Prompt Sets CRUD
  app.get("/api/ai-mentions/prompt-sets", isAuthenticated, async (_req, res) => {
    try {
      const sets = await db.select().from(aiPromptSets).orderBy(desc(aiPromptSets.createdAt));
      res.json(sets);
    } catch (error) {
      console.error("Error fetching prompt sets:", error);
      res.status(500).json({ message: "Failed to fetch prompt sets" });
    }
  });

  app.get("/api/ai-mentions/prompt-sets/:id", isAuthenticated, async (req, res) => {
    try {
      const [set] = await db.select().from(aiPromptSets).where(eq(aiPromptSets.id, req.params.id));
      if (!set) {
        return res.status(404).json({ message: "Prompt set not found" });
      }
      res.json(set);
    } catch (error) {
      console.error("Error fetching prompt set:", error);
      res.status(500).json({ message: "Failed to fetch prompt set" });
    }
  });

  app.post("/api/ai-mentions/prompt-sets", isAuthenticated, async (req, res) => {
    try {
      const { name, description, clientId } = req.body;
      const [set] = await db.insert(aiPromptSets).values({
        name,
        description,
        clientId,
      }).returning();
      res.status(201).json(set);
    } catch (error) {
      console.error("Error creating prompt set:", error);
      res.status(500).json({ message: "Failed to create prompt set" });
    }
  });

  app.put("/api/ai-mentions/prompt-sets/:id", isAuthenticated, async (req, res) => {
    try {
      const { name, description } = req.body;
      const [set] = await db.update(aiPromptSets)
        .set({ name, description })
        .where(eq(aiPromptSets.id, req.params.id))
        .returning();
      res.json(set);
    } catch (error) {
      console.error("Error updating prompt set:", error);
      res.status(500).json({ message: "Failed to update prompt set" });
    }
  });

  app.delete("/api/ai-mentions/prompt-sets/:id", isAuthenticated, async (req, res) => {
    try {
      await db.delete(aiPromptSets).where(eq(aiPromptSets.id, req.params.id));
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting prompt set:", error);
      res.status(500).json({ message: "Failed to delete prompt set" });
    }
  });

  // Prompts CRUD
  app.get("/api/ai-mentions/prompts", isAuthenticated, async (req, res) => {
    try {
      const promptSetId = req.query.promptSetId as string;
      let query = db.select().from(aiPrompts).orderBy(aiPrompts.priority);
      if (promptSetId) {
        const prompts = await db.select().from(aiPrompts)
          .where(eq(aiPrompts.promptSetId, promptSetId))
          .orderBy(aiPrompts.priority);
        return res.json(prompts);
      }
      const prompts = await query;
      res.json(prompts);
    } catch (error) {
      console.error("Error fetching prompts:", error);
      res.status(500).json({ message: "Failed to fetch prompts" });
    }
  });

  app.post("/api/ai-mentions/prompts", isAuthenticated, async (req, res) => {
    try {
      const { promptSetId, promptText, geo, language, category, priority } = req.body;
      const [prompt] = await db.insert(aiPrompts).values({
        promptSetId,
        promptText,
        geo: geo || "US",
        language: language || "en",
        category,
        priority: priority || 0,
      }).returning();
      res.status(201).json(prompt);
    } catch (error) {
      console.error("Error creating prompt:", error);
      res.status(500).json({ message: "Failed to create prompt" });
    }
  });

  app.put("/api/ai-mentions/prompts/:id", isAuthenticated, async (req, res) => {
    try {
      const { promptText, geo, language, category, priority } = req.body;
      const [prompt] = await db.update(aiPrompts)
        .set({ promptText, geo, language, category, priority })
        .where(eq(aiPrompts.id, req.params.id))
        .returning();
      res.json(prompt);
    } catch (error) {
      console.error("Error updating prompt:", error);
      res.status(500).json({ message: "Failed to update prompt" });
    }
  });

  app.delete("/api/ai-mentions/prompts/:id", isAuthenticated, async (req, res) => {
    try {
      await db.delete(aiPrompts).where(eq(aiPrompts.id, req.params.id));
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting prompt:", error);
      res.status(500).json({ message: "Failed to delete prompt" });
    }
  });

  // Brand Entities CRUD
  app.get("/api/ai-mentions/brand-entities", isAuthenticated, async (req, res) => {
    try {
      const clientId = req.query.clientId as string;
      if (clientId) {
        const entities = await db.select().from(aiBrandEntities)
          .where(eq(aiBrandEntities.clientId, clientId));
        return res.json(entities);
      }
      const entities = await db.select().from(aiBrandEntities);
      res.json(entities);
    } catch (error) {
      console.error("Error fetching brand entities:", error);
      res.status(500).json({ message: "Failed to fetch brand entities" });
    }
  });

  app.post("/api/ai-mentions/brand-entities", isAuthenticated, async (req, res) => {
    try {
      const { clientId, brandName, domainsJson, synonymsJson, competitorsJson } = req.body;
      const [entity] = await db.insert(aiBrandEntities).values({
        clientId,
        brandName,
        domainsJson: domainsJson || [],
        synonymsJson: synonymsJson || [],
        competitorsJson: competitorsJson || [],
      }).returning();
      res.status(201).json(entity);
    } catch (error) {
      console.error("Error creating brand entity:", error);
      res.status(500).json({ message: "Failed to create brand entity" });
    }
  });

  app.put("/api/ai-mentions/brand-entities/:id", isAuthenticated, async (req, res) => {
    try {
      const { brandName, domainsJson, synonymsJson, competitorsJson } = req.body;
      const [entity] = await db.update(aiBrandEntities)
        .set({ brandName, domainsJson, synonymsJson, competitorsJson })
        .where(eq(aiBrandEntities.id, req.params.id))
        .returning();
      res.json(entity);
    } catch (error) {
      console.error("Error updating brand entity:", error);
      res.status(500).json({ message: "Failed to update brand entity" });
    }
  });

  app.delete("/api/ai-mentions/brand-entities/:id", isAuthenticated, async (req, res) => {
    try {
      await db.delete(aiBrandEntities).where(eq(aiBrandEntities.id, req.params.id));
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting brand entity:", error);
      res.status(500).json({ message: "Failed to delete brand entity" });
    }
  });

  // Run prompts
  app.post("/api/ai-mentions/run", isAuthenticated, async (req, res) => {
    try {
      const { promptSetId, brandEntityId, model } = req.body;
      
      if (!promptSetId) {
        return res.status(400).json({ message: "Prompt set ID is required" });
      }

      const result = await runPromptSet(promptSetId, brandEntityId, model || "gpt-4o");
      res.json(result);
    } catch (error) {
      console.error("Error running prompts:", error);
      res.status(500).json({ message: "Failed to run prompts" });
    }
  });

  // Get results for a prompt set
  app.get("/api/ai-mentions/results/:promptSetId", isAuthenticated, async (req, res) => {
    try {
      const { promptSetId } = req.params;
      const startDate = req.query.start ? new Date(req.query.start as string) : undefined;
      const endDate = req.query.end ? new Date(req.query.end as string) : undefined;

      const results = await getPromptSetResults(promptSetId, startDate, endDate);
      
      const enrichedPrompts = results.prompts.map(prompt => {
        const promptRuns = results.runs.filter(r => r.promptId === prompt.id);
        const latestRun = promptRuns[0];
        const mention = latestRun 
          ? results.mentions.find(m => m.runId === latestRun.id)
          : null;

        return {
          ...prompt,
          lastRun: latestRun || null,
          mention: mention || null,
        };
      });

      res.json({ prompts: enrichedPrompts });
    } catch (error) {
      console.error("Error fetching results:", error);
      res.status(500).json({ message: "Failed to fetch results" });
    }
  });

  // Get stats for a prompt set
  app.get("/api/ai-mentions/stats/:promptSetId", isAuthenticated, async (req, res) => {
    try {
      const { promptSetId } = req.params;
      const startDate = req.query.start ? new Date(req.query.start as string) : undefined;
      const endDate = req.query.end ? new Date(req.query.end as string) : undefined;

      const stats = await getAiMentionsStats(promptSetId, startDate, endDate);
      res.json(stats);
    } catch (error) {
      console.error("Error fetching stats:", error);
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  // generate-pdf: accepts a `snapshot` object (pre-fetched on the frontend)
  // so the PDF contains exactly the data the user sees — no re-fetching.
  app.post("/api/generate-pdf", isAuthenticated, async (req, res) => {
    try {
      const { domain, start, end, snapshot } = req.body;

      if (!snapshot || !snapshot.metrics) {
        return res.status(400).json({ error: "snapshot with metrics is required" });
      }

      const { generatePdfReport, buildPdfFilename } = await import("./lib/pdf-generator");

      const reportDomain = domain || "unknown-domain";
      const filename = buildPdfFilename(reportDomain);

      const pdfBuffer = await generatePdfReport({
        domain: reportDomain,
        dateRange: { start: start || "", end: end || "" },
        metrics: snapshot.metrics,
        insights: snapshot.insights || [],
        summary: snapshot.summary || "",
        topPages: snapshot.topPages || [],
        topPagesSource: snapshot.topPagesSource || "gsc",
        dailyTrends: snapshot.dailyTrends || { ga4Daily: [], gscDaily: [] },
        keywordDistribution: snapshot.keywordDistribution || { top3: 0, top10: 0, top20: 0, top50: 0, top100: 0, beyond: 0 },
        aiReferrers: snapshot.aiReferrers || [],
        keywords: snapshot.keywords || [],
        trafficSummary: snapshot.trafficSummary || null,
        ga4TopPages: snapshot.ga4TopPages || [],
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", pdfBuffer.length);
      res.send(pdfBuffer);
    } catch (error) {
      console.error("PDF generation error:", error);
      res.status(500).json({ error: "Failed to generate PDF report" });
    }
  });

  app.get("/api/report-data", isAuthenticated, async (req, res) => {
    // Prevent any intermediate caching so date filter always refetches fresh data.
    res.set('Cache-Control', 'no-store');
    try {
      const ga4PropertyId = req.query.propertyId as string;
      if (!ga4PropertyId) {
        return res.status(400).json({ error: "propertyId query parameter is required" });
      }

      const reportDomain = req.query.domain as string;
      const internalPropertyId = await storage.getPropertyIdByGa4Id(ga4PropertyId, reportDomain);
      if (!internalPropertyId) {
        return res.status(404).json({ error: "No property found for the given GA4 Property ID. Please ensure data has been synced first." });
      }

      // ── Parse dates without timezone shift ──────────────────────────────────
      // Frontend sends "YYYY-MM-DD" (local calendar date). `new Date("YYYY-MM-DD")`
      // parses as UTC midnight which can shift the calendar day on non-UTC servers.
      // Build the Date from the literal Y/M/D components so the calendar day is
      // preserved regardless of the server timezone.
      const parseYmd = (s: string): Date => {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
        return startOfDay(new Date(s));
      };

      let endDate: Date;
      let startDate: Date;
      if (req.query.start && req.query.end) {
        startDate = parseYmd(req.query.start as string);
        endDate = parseYmd(req.query.end as string);
      } else {
        const days = parseInt(req.query.days as string) || 30;
        endDate = startOfDay(new Date());
        startDate = subDays(endDate, days - 1);
      }
      const diffDays = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);
      const previousEndDate = subDays(startDate, 1);
      const previousStartDate = subDays(previousEndDate, diffDays - 1);

      const gscProcessingDelay = 2;
      const gscAdjustedEnd = subDays(endDate, gscProcessingDelay);
      const gscAdjustedStart = startDate > gscAdjustedEnd ? gscAdjustedEnd : startDate;

      const { normalizeData } = await import("./lib/normalization-engine");
      const { computeSeoMetrics } = await import("./lib/seo-metrics");
      const { generateInsights } = await import("./lib/insight-engine");
      const { generateNarrative } = await import("./lib/ai-narrative");

      const aggregatedData = await storage.getAggregatedSeoData(
        internalPropertyId,
        startDate,
        endDate,
        previousStartDate,
        previousEndDate
      );

      const property = await storage.getProperty(internalPropertyId);
      const domainParam = req.query.domain as string;
      const gscSiteUrl = property?.gscSiteUrl
        || (req.query.gscSiteUrl as string)
        || (domainParam ? `https://${domainParam.replace(/^https?:\/\//, "")}/` : "");
      const ga4PropId = ga4PropertyId;
      // ── Live GSC summary (service account) ─────────────────────────────────
      // Matches user's curl: POST /webmasters/v3/sites/{siteUrl}/searchAnalytics/query
      // with no dimensions → summary totals for clicks, impressions, ctr, position.
      //
      // IMPORTANT: Use the user's actual startDate/endDate (NOT the 2-day
      // adjusted range). getGSCSummary sets dataState: "all" which includes
      // fresh/partial data matching what the GSC dashboard shows. Using the
      // gscProcessingDelay here would drop 2 days of real clicks/impressions.
      if (gscSiteUrl && hasGoogleCredentials()) {
        try {
          const gscStartDate = format(startDate, "yyyy-MM-dd");
          const gscEndDate = format(endDate, "yyyy-MM-dd");
          const liveGsc = await getGSCSummary(gscSiteUrl, gscStartDate, gscEndDate);
          aggregatedData.gsc = {
            clicks: liveGsc.clicks,
            impressions: liveGsc.impressions,
            ctr: liveGsc.ctr,
            avgPosition: liveGsc.position,
          };
        } catch (e) {
          console.error("Failed to fetch live GSC summary:", e);
        }
      }

      // ── Live GA4 summary (service account) ─────────────────────────────────
      // Matches user's curl: POST /v1beta/properties/{id}:runReport
      // with totalUsers + sessions metrics for the selected date range.
      if (ga4PropId && hasGoogleCredentials()) {
        try {
          const ga4Start = format(startDate, "yyyy-MM-dd");
          const ga4End = format(endDate, "yyyy-MM-dd");
          const liveGa4 = await getGA4Metrics(ga4PropId, ga4Start, ga4End);
          aggregatedData.ga4 = {
            ...aggregatedData.ga4,
            users: liveGa4.totalUsers,
            sessions: liveGa4.sessions,
          };
        } catch (e) {
          console.error("Failed to fetch live GA4 summary:", e);
        }
      }

      const normalized = normalizeData(aggregatedData);
      const metrics = computeSeoMetrics(normalized);
      const insights = generateInsights(normalized);

      let summary: string;
      try {
        summary = await generateNarrative(insights);
      } catch {
        summary = "Executive summary generation is unavailable. Please review the insights below for a detailed performance breakdown.";
      }

      let dailyTrends = { ga4Daily: [] as any[], gscDaily: [] as any[] };
      let keywordDistribution = { top3: 0, top10: 0, top20: 0, top50: 0, top100: 0, beyond: 0 };

      const liveStartDate = format(startDate, "yyyy-MM-dd");
      const liveEndDate = format(endDate, "yyyy-MM-dd");

      const dataResults = await Promise.allSettled([
        hasGoogleCredentials() && ga4PropertyId
          ? getGA4DailyTraffic(ga4PropertyId, liveStartDate, liveEndDate).then(data => ({
              ga4Daily: data.map(d => ({ date: d.date, users: d.users, sessions: d.sessions })),
              gscDaily: [] as any[],
            }))
          : storage.getDailyTrends(internalPropertyId, startDate, endDate),
        storage.getKeywordDistribution(internalPropertyId, startDate, endDate),
      ]);
      if (dataResults[0].status === "fulfilled") dailyTrends = dataResults[0].value;
      if (dataResults[1].status === "fulfilled") keywordDistribution = dataResults[1].value;

      if (dailyTrends.ga4Daily.length === 0) {
        try {
          const dbTrends = await storage.getDailyTrends(internalPropertyId, startDate, endDate);
          dailyTrends.ga4Daily = dbTrends.ga4Daily;
          if (dailyTrends.gscDaily.length === 0) dailyTrends.gscDaily = dbTrends.gscDaily;
        } catch {}
      }

      if (dailyTrends.gscDaily.length === 0 && gscSiteUrl && hasGoogleCredentials()) {
        try {
          const client = await (await import("./lib/google-apis")).getSearchConsoleClient();
          if (client) {
            const response = await client.searchanalytics.query({
              siteUrl: gscSiteUrl,
              requestBody: {
                startDate: format(gscAdjustedStart, "yyyy-MM-dd"),
                endDate: format(gscAdjustedEnd, "yyyy-MM-dd"),
                dimensions: ["date"],
                rowLimit: 500,
                dataState: "final",
              },
            });
            if (response.data.rows && response.data.rows.length > 0) {
              dailyTrends.gscDaily = response.data.rows.map((row) => ({
                date: row.keys?.[0] || "",
                clicks: row.clicks || 0,
                impressions: row.impressions || 0,
              }));
            }
          }
        } catch (e) {
          console.error("Failed to fetch live GSC daily trends:", e);
        }
      }

      let topPages: any[] = [];
      let topPagesSource: "gsc" | "ga4" = "gsc";

      if (gscSiteUrl && hasGoogleCredentials()) {
        try {
          const gscStartDate = format(startDate, "yyyy-MM-dd");
          const gscEndDate = format(endDate, "yyyy-MM-dd");
          const gscPageData = await getGSCTable(gscSiteUrl, gscStartDate, gscEndDate, "page", 10);
          if (gscPageData && gscPageData.length > 0) {
            topPages = gscPageData.map((p: any) => ({
              page: p.page || "",
              clicks: p.clicks || 0,
              impressions: p.impressions || 0,
              ctr: p.ctr ? Math.round(p.ctr * 100) / 100 : 0,
              position: p.position ? Math.round(p.position * 10) / 10 : 0,
            }));
          }
        } catch (e) {
          console.error("Failed to fetch GSC top pages from API:", e);
        }
      }

      if (topPages.length === 0) {
        topPagesSource = "ga4";
        try {
          const ga4Metrics = await storage.getGa4Metrics(internalPropertyId, startDate, endDate);
          const pageMap = new Map<string, { sessions: number; users: number; conversions: number }>();
          for (const row of ga4Metrics) {
            if (row.landingPagePath) {
              const existing = pageMap.get(row.landingPagePath) || { sessions: 0, users: 0, conversions: 0 };
              existing.sessions += Number(row.sessions || 0);
              existing.users += Number(row.totalUsers || 0);
              existing.conversions += Number(row.conversions || 0);
              pageMap.set(row.landingPagePath, existing);
            }
          }
          topPages = Array.from(pageMap.entries())
            .map(([page, data]) => ({ page, ...data }))
            .sort((a, b) => b.sessions - a.sessions)
            .slice(0, 10);
        } catch {
          topPages = [];
        }
      }

      let aiReferrers: any[] = [];
      if (hasGoogleCredentials() && ga4PropId) {
        try {
          const aiData = await getGA4AIReferrers(ga4PropId, format(startDate, "yyyy-MM-dd"), format(endDate, "yyyy-MM-dd"));
          aiReferrers = (aiData || []).map((item) => ({
            source: item.source,
            totalUsers: item.users,
            sessions: item.sessions,
          }));
        } catch (e) {
          console.error("Failed to fetch AI referrers for report:", e);
        }
      }

      const totalUsers = metrics.traffic.users;
      const totalAiUsers = aiReferrers.reduce((s: number, r: any) => s + (r.totalUsers || 0), 0);
      const totalAiSessions = aiReferrers.reduce((s: number, r: any) => s + (r.sessions || 0), 0);
      for (const ref of aiReferrers) {
        ref.percentOfTotal = totalUsers > 0 ? Math.round((ref.totalUsers / totalUsers) * 10000) / 100 : 0;
      }
      const aiTrafficSummary = {
        totalAiUsers,
        totalAiSessions,
        percentOfTotalTraffic: totalUsers > 0 ? Math.round((totalAiUsers / totalUsers) * 10000) / 100 : 0,
        sourcesDetected: aiReferrers.length,
      };

      const missingData: string[] = [];
      if (!normalized.quality.hasSearch && dailyTrends.gscDaily.length === 0) {
        missingData.push("Search Console click and impression trend data is unavailable for this reporting period.");
      }
      if (!normalized.quality.hasKeywords) {
        missingData.push("Keyword ranking tracking data is currently unavailable for this reporting period.");
      }
      if (!normalized.quality.hasTraffic) {
        missingData.push("GA4 traffic data is unavailable for this reporting period.");
      }
      if (topPages.length === 0) {
        missingData.push("Page-level data is unavailable for this reporting period.");
      } else if (topPagesSource === "ga4") {
        missingData.push("GSC page-level data is unavailable. Top pages are shown from GA4 session data instead.");
      }

      res.json({
        domain: req.query.domain || "unknown",
        dateRange: {
          start: format(startDate, "yyyy-MM-dd"),
          end: format(endDate, "yyyy-MM-dd"),
        },
        metrics,
        insights,
        summary,
        topPages,
        topPagesSource,
        dailyTrends,
        keywordDistribution,
        aiReferrers,
        aiTrafficSummary,
        missingData,
      });
    } catch (error) {
      console.error("Report data error:", error);
      res.status(500).json({ error: "Failed to generate report data" });
    }
  });

  app.get("/api/ai-summary-test", isAuthenticated, async (req, res) => {
    try {
      const propertyId = req.query.propertyId as string;
      if (!propertyId) {
        return res.status(400).json({ error: "propertyId query parameter is required" });
      }

      const days = parseInt(req.query.days as string) || 30;
      const endDate = new Date();
      const startDate = subDays(endDate, days - 1);
      const previousEndDate = subDays(startDate, 1);
      const previousStartDate = subDays(previousEndDate, days - 1);

      const { normalizeData } = await import("./lib/normalization-engine");
      const { computeSeoMetrics } = await import("./lib/seo-metrics");
      const { generateInsights } = await import("./lib/insight-engine");
      const { generateNarrative } = await import("./lib/ai-narrative");

      const aggregatedData = await storage.getAggregatedSeoData(
        propertyId,
        startDate,
        endDate,
        previousStartDate,
        previousEndDate
      );

      const normalized = normalizeData(aggregatedData);
      const metrics = computeSeoMetrics(normalized);
      const insights = generateInsights(normalized);
      const summary = await generateNarrative(insights);

      res.json({
        propertyId,
        dateRange: {
          start: format(startDate, "yyyy-MM-dd"),
          end: format(endDate, "yyyy-MM-dd"),
        },
        insights,
        summary,
      });
    } catch (error) {
      console.error("AI summary test error:", error);
      res.status(500).json({ error: "Failed to generate AI summary" });
    }
  });

  app.get("/api/insights-test", isAuthenticated, async (req, res) => {
    try {
      const propertyId = req.query.propertyId as string;
      if (!propertyId) {
        return res.status(400).json({ error: "propertyId query parameter is required" });
      }

      const days = parseInt(req.query.days as string) || 30;
      const endDate = new Date();
      const startDate = subDays(endDate, days - 1);
      const previousEndDate = subDays(startDate, 1);
      const previousStartDate = subDays(previousEndDate, days - 1);

      const { normalizeData } = await import("./lib/normalization-engine");
      const { computeSeoMetrics } = await import("./lib/seo-metrics");
      const { generateInsights } = await import("./lib/insight-engine");

      const aggregatedData = await storage.getAggregatedSeoData(
        propertyId,
        startDate,
        endDate,
        previousStartDate,
        previousEndDate
      );

      const normalized = normalizeData(aggregatedData);
      const metrics = computeSeoMetrics(normalized);
      const insights = generateInsights(normalized);

      res.json({
        propertyId,
        dateRange: {
          start: format(startDate, "yyyy-MM-dd"),
          end: format(endDate, "yyyy-MM-dd"),
        },
        metrics,
        insights,
      });
    } catch (error) {
      console.error("Insights test error:", error);
      res.status(500).json({ error: "Failed to generate insights" });
    }
  });

  app.get("/api/seo-metrics-test", isAuthenticated, async (req, res) => {
    try {
      const propertyId = req.query.propertyId as string;
      if (!propertyId) {
        return res.status(400).json({ error: "propertyId query parameter is required" });
      }

      const days = parseInt(req.query.days as string) || 30;
      const endDate = new Date();
      const startDate = subDays(endDate, days - 1);
      const previousEndDate = subDays(startDate, 1);
      const previousStartDate = subDays(previousEndDate, days - 1);

      const { normalizeData } = await import("./lib/normalization-engine");
      const { computeSeoMetrics } = await import("./lib/seo-metrics");

      const aggregatedData = await storage.getAggregatedSeoData(
        propertyId,
        startDate,
        endDate,
        previousStartDate,
        previousEndDate
      );

      const normalized = normalizeData(aggregatedData);
      const metrics = computeSeoMetrics(normalized);

      res.json({
        propertyId,
        dateRange: {
          start: format(startDate, "yyyy-MM-dd"),
          end: format(endDate, "yyyy-MM-dd"),
          previousStart: format(previousStartDate, "yyyy-MM-dd"),
          previousEnd: format(previousEndDate, "yyyy-MM-dd"),
        },
        rawData: aggregatedData,
        normalizedData: normalized,
        computedMetrics: metrics,
      });
    } catch (error) {
      console.error("SEO metrics test error:", error);
      res.status(500).json({ error: "Failed to compute SEO metrics" });
    }
  });

  return httpServer;
}
