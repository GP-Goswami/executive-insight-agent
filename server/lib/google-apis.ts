import { google, searchconsole_v1, analyticsdata_v1beta } from "googleapis";
import { debugLog, isDebugMode } from "./debug";

let authClient: any = null;
let searchConsoleClient: searchconsole_v1.Searchconsole | null = null;
let analyticsDataClient: analyticsdata_v1beta.Analyticsdata | null = null;

/**
 * Clears all cached Google API clients so the next call re-authenticates.
 * Called automatically on invalid_grant / 401 errors inside withRetry().
 */
export function resetAuthClients(): void {
  authClient = null;
  searchConsoleClient = null;
  analyticsDataClient = null;
}

/**
 * Retries an async function up to maxRetries times.
 * On auth errors (invalid_grant / 401) it also resets the cached clients
 * so the next attempt obtains a fresh token.
 */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const msg: string = err?.message || "";
      const isAuthError =
        msg.includes("invalid_grant") ||
        msg.includes("invalid_token") ||
        msg.includes("UNAUTHENTICATED") ||
        err?.code === 401 ||
        err?.status === 401 ||
        err?.response?.status === 401;

      if (isAuthError) {
        console.error(`[GoogleAPI][retry] Auth error on attempt ${attempt + 1} — resetting clients: ${msg}`);
        resetAuthClients();
      }

      if (attempt < maxRetries) {
        const delayMs = Math.pow(2, attempt) * 1000; // 1 s, 2 s
        console.error(`[GoogleAPI][retry] Attempt ${attempt + 1}/${maxRetries + 1} failed: "${msg}". Retrying in ${delayMs}ms…`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

function getCredentials() {
  const credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!credentialsJson) {
    return null;
  }
  try {
    return JSON.parse(credentialsJson);
  } catch (e) {
    console.error("Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON:", e);
    return null;
  }
}

async function getAuthClient() {
  if (authClient) return authClient;
  
  const credentials = getCredentials();
  if (!credentials) return null;

  authClient = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      "https://www.googleapis.com/auth/webmasters.readonly",
      "https://www.googleapis.com/auth/analytics.readonly",
    ],
  });

  return authClient;
}

export function hasGoogleCredentials(): boolean {
  return !!getCredentials();
}

export async function getSearchConsoleClient(): Promise<searchconsole_v1.Searchconsole | null> {
  if (searchConsoleClient) return searchConsoleClient;
  
  const auth = await getAuthClient();
  if (!auth) return null;

  searchConsoleClient = google.searchconsole({ version: "v1", auth });
  return searchConsoleClient;
}

export async function getAnalyticsDataClient(): Promise<analyticsdata_v1beta.Analyticsdata | null> {
  if (analyticsDataClient) return analyticsDataClient;
  
  const auth = await getAuthClient();
  if (!auth) return null;

  analyticsDataClient = google.analyticsdata({ version: "v1beta", auth });
  return analyticsDataClient;
}

export interface GSCQueryData {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GSCPageData {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}
export async function getGA4Summary(
  propertyId: string,
  startDate: string,
  endDate: string
) {
  const client = await getAnalyticsDataClient();
  if (!client) throw new Error("GA4 client not configured");

  const res = await client.properties.runReport({
    property: `properties/${propertyId}`,
    requestBody: {
      dateRanges: [{ startDate, endDate }],
      metrics: [
        { name: "sessions" },
        { name: "totalUsers" },
        { name: "screenPageViews" },
      ],
    },
  });

  const row = res.data.rows?.[0];
  if (!row) throw new Error("No GA4 data");

  return {
    sessions: parseInt(row.metricValues?.[0]?.value || "0"),
    users: parseInt(row.metricValues?.[1]?.value || "0"),
    pageviews: parseInt(row.metricValues?.[2]?.value || "0"),
  };
}


// export async function getGSCSearchAnalytics(
//   siteUrl: string,
//   startDate: string,
//   endDate: string,
//   dimension: "query" | "page" | null = "query",
//   rowLimit: number = 100,
//   country?: string,
//   device?: string
// ): Promise<any> {
//   if (!siteUrl || !startDate || !endDate) {
//     throw new Error("Site URL, start date, and end date are required");
//   }

//   const client = await getSearchConsoleClient();
//   if (!client) {
//     throw new Error("Google Search Console client not configured");
//   }

//   const filters = [];
//   if (country) {
//     filters.push(`country=${country.toUpperCase()}`);
//   }
//   if (device) {
//     filters.push(`device=${device.toLowerCase()}`);
//   }
//   const filterString = filters.length > 0 ? ` [filters: ${filters.join(", ")}]` : "";
//   debugLog("gsc", `SearchAnalytics request: ${siteUrl}, ${dimension || "summary"}, ${startDate} to ${endDate}${filterString}`);

//   const requestBody: any = {
//     startDate,
//     endDate,
//     dimensions: dimension ? [dimension] : [],
//     rowLimit: dimension ? rowLimit : 1,
//     dataState: "final",
//   };

//   if (country || device) {
//     requestBody.dimensionFilterGroups = [
//       {
//         filters: [
//           ...(country ? [{ dimension: "country", operator: "equals", expression: country.toUpperCase() }] : []),
//           ...(device ? [{ dimension: "device", operator: "equals", expression: device.toLowerCase() }] : []),
//         ]
//       }
//     ];
//   }

//   const response = await client.searchanalytics.query({
//     siteUrl,
//     requestBody,
//   });

//   if (!dimension) {
//     // Summary Only Mode
//     const row = response.data.rows?.[0];
//     return {
//       clicks: row?.clicks || 0,
//       impressions: row?.impressions || 0,
//       ctr: Math.round((row?.ctr || 0) * 10000) / 100,
//       position: Math.round((row?.position || 0) * 10) / 10,
//     };
//   }

//   if (!response.data.rows) {
//     debugLog("gsc", `SearchAnalytics returned no rows for ${dimension}`);
//     return [];
//   }

//   debugLog("gsc", `SearchAnalytics returned ${response.data.rows.length} rows for ${dimension}`);

//   return response.data.rows.map((row) => ({
//     [dimension]: row.keys?.[0] || "",
//     clicks: row.clicks || 0,
//     impressions: row.impressions || 0,
//     ctr: Math.round((row.ctr || 0) * 10000) / 100,
//     position: Math.round((row.position || 0) * 10) / 10,
//   })) as any;
// }

// ── GSC Top Keywords (matches user's exact curl) ──────────────────────────
// POST /webmasters/v3/sites/{siteUrl}/searchAnalytics/query
// body: { startDate, endDate, dimensions: ["query"], rowLimit: 100, dataState: "final" }
// rowLimit is overridable, but defaults to the curl's value (100). Frontend
// slices to top N for display (e.g. top 10). siteUrl + dates are dynamic.
export interface GSCTopKeyword {
  query: string;
  clicks: number;
  impressions: number;
  /** CTR as a percentage (e.g. 3.45 means 3.45%). */
  ctr: number;
  /** Average position (weighted by GSC). */
  position: number;
}

export async function getGSCTopKeywords(
  siteUrl: string,
  startDate: string,
  endDate: string,
  rowLimit: number = 100
): Promise<GSCTopKeyword[]> {
  if (!siteUrl || !startDate || !endDate) {
    throw new Error("Site URL, start date, and end date are required");
  }

  return withRetry(async () => {
    const client = await getSearchConsoleClient();
    if (!client) {
      throw new Error("Google Search Console client not configured");
    }

    const requestBody: any = {
      startDate,
      endDate,
      dimensions: ["query"],
      rowLimit,
      dataState: "all",
    };

    debugLog("gsc-top-keywords", `Request: siteUrl=${siteUrl}, ${startDate} → ${endDate}, rowLimit=${rowLimit}`);

    const response = await client.searchanalytics.query({ siteUrl, requestBody });
    if (!response.data.rows) return [];

    return response.data.rows.map((row) => ({
      query: row.keys?.[0] || "",
      clicks: row.clicks || 0,
      impressions: row.impressions || 0,
      ctr: Math.round((row.ctr || 0) * 10000) / 100,
      position: Math.round((row.position || 0) * 10) / 10,
    }));
  });
}

export async function getGSCSites(): Promise<string[]> {
  const client = await getSearchConsoleClient();
  if (!client) {
    throw new Error("Google Search Console client not configured");
  }

  const response = await client.sites.list();
  return response.data.siteEntry?.map((site) => site.siteUrl || "") || [];
}

export interface GSCRankingData {
  keyword: string;
  position: number;
  previousPosition: number | null;
  change: number;
  url: string;
  clicks: number;
  impressions: number;
  ctr: number;
  clicksDelta: number;
  impressionsDelta: number;
  ctrDelta: number;
  source: "gsc";
}

export interface GSCMonthlyData {
  month: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GSCQueryPageData {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}


// --------------------------
export async function getGSCSummary(
  siteUrl: string,
  startDate: string,
  endDate: string,
  country?: string,
  device?: string
) {
  return withRetry(async () => {
    const client = await getSearchConsoleClient();
    if (!client) throw new Error("GSC client not configured");

    // ─── STRICT RULE: NO dimensions — this returns true aggregate totals ───
    // Using dimensions would give per-row data that sums incorrectly when
    // rowLimit is hit. aggregationType: "auto" is the correct GSC summary call.
    // dataState: "all" includes the most recent 2-3 days that are still being
    // processed by Google, matching what the GSC dashboard shows by default.
    const requestBody: any = {
      startDate,
      endDate,
      dataState: "all",
      aggregationType: "auto",
    };

    if (country || device) {
      requestBody.dimensionFilterGroups = [
        {
          filters: [
            ...(country ? [{ dimension: "country", operator: "equals", expression: country.toUpperCase() }] : []),
            ...(device ? [{ dimension: "device", operator: "equals", expression: device.toLowerCase() }] : []),
          ],
        },
      ];
    }

    const res = await client.searchanalytics.query({ siteUrl, requestBody });
    const row = res.data.rows?.[0];

    if (!row) {
      throw new Error("No GSC summary data returned for the selected period");
    }

    const clicks = row.clicks || 0;
    const impressions = row.impressions || 0;
    // Always recalculate CTR from raw clicks/impressions to avoid API rounding
    const ctr = impressions > 0
      ? Math.round((clicks / impressions) * 10000) / 100
      : 0;

    return {
      clicks,
      impressions,
      ctr,
      position: Math.round((row.position || 0) * 10) / 10,
    };
  });
}

export async function getGSCTable(
  siteUrl: string,
  startDate: string,
  endDate: string,
  dimension: "query" | "page",
  rowLimit: number = 25000,
  country?: string,
  device?: string
) {
  return withRetry(async () => {
    const client = await getSearchConsoleClient();
    if (!client) throw new Error("GSC client not configured");

    // NEVER use this data to calculate summary totals. rowLimit caps results.
    const requestBody: any = {
      startDate,
      endDate,
      dimensions: [dimension],
      rowLimit,
      dataState: "all",
    };

    if (country || device) {
      requestBody.dimensionFilterGroups = [
        {
          filters: [
            ...(country ? [{ dimension: "country", operator: "equals", expression: country.toUpperCase() }] : []),
            ...(device ? [{ dimension: "device", operator: "equals", expression: device.toLowerCase() }] : []),
          ],
        },
      ];
    }

    const res = await client.searchanalytics.query({ siteUrl, requestBody });
    if (!res.data.rows) return [];

    return res.data.rows.map((row) => ({
      [dimension]: row.keys?.[0] || "",
      clicks: row.clicks || 0,
      impressions: row.impressions || 0,
      ctr: Math.round((row.ctr || 0) * 10000) / 100,
      position: Math.round((row.position || 0) * 10) / 10,
    }));
  });
}
export async function getGSCSearchAnalyticsMultiDimension(
  siteUrl: string,
  startDate: string,
  endDate: string,
  dimensions: string[] = ["query", "page"],
  rowLimit: number = 500,
  country?: string,
  device?: string
): Promise<GSCQueryPageData[]> {
  if (!siteUrl || !startDate || !endDate) {
    throw new Error("Site URL, start date, and end date are required");
  }

  const client = await getSearchConsoleClient();
  if (!client) {
    throw new Error("Google Search Console client not configured");
  }

  const filters = [];
  if (country) {
    filters.push(`country=${country.toUpperCase()}`);
  }
  if (device) {
    filters.push(`device=${device.toLowerCase()}`);
  }
  const filterString = filters.length > 0 ? ` [filters: ${filters.join(", ")}]` : "";
  debugLog("gsc", `SearchAnalyticsMultiDimension request: ${siteUrl}, dimensions=[${dimensions.join(", ")}], ${startDate} to ${endDate}${filterString}`);

  try {
    const requestBody: any = {
      startDate,
      endDate,
      dimensions,
      rowLimit,
      dataState: "final",
    };

    if (country || device) {
      requestBody.dimensionFilterGroups = [
        {
          filters: [
            ...(country ? [{ dimension: "country", operator: "equals", expression: country.toUpperCase() }] : []),
            ...(device ? [{ dimension: "device", operator: "equals", expression: device.toLowerCase() }] : []),
          ]
        }
      ];
    }

    const response = await client.searchanalytics.query({
      siteUrl,
      requestBody,
    });

    if (!response.data.rows) return [];

    return response.data.rows.map((row) => ({
      query: row.keys?.[0] || "",
      page: row.keys?.[1] || "",
      clicks: row.clicks || 0,
      impressions: row.impressions || 0,
      ctr: Math.round((row.ctr || 0) * 10000) / 100,
      position: Math.round((row.position || 0) * 10) / 10,
    }));
  } catch (error: any) {
    if (error.code === 403) {
      throw new Error("GSC_PERMISSION_DENIED: Service account does not have access to this site. Please add the service account email to Google Search Console.");
    }
    if (error.code === 429) {
      throw new Error("GSC_QUOTA_EXCEEDED: Google Search Console API quota exceeded. Please try again later.");
    }
    throw error;
  }
}

export async function getGSCMonthlyAggregation(
  siteUrl: string,
  startDate: string,
  endDate: string,
  country?: string,
  device?: string
): Promise<GSCMonthlyData[]> {
  if (!siteUrl || !startDate || !endDate) {
    throw new Error("Site URL, start date, and end date are required");
  }

  const client = await getSearchConsoleClient();
  if (!client) {
    throw new Error("Google Search Console client not configured");
  }

  const filters = [];
  if (country) {
    filters.push(`country=${country.toUpperCase()}`);
  }
  if (device) {
    filters.push(`device=${device.toLowerCase()}`);
  }
  const filterString = filters.length > 0 ? ` [filters: ${filters.join(", ")}]` : "";
  debugLog("gsc", `MonthlyAggregation request: ${siteUrl}, ${startDate} to ${endDate}${filterString}`);

  try {
    const requestBody: any = {
      startDate,
      endDate,
      dimensions: ["date"],
      rowLimit: 365,
      dataState: "final",
    };

    if (country || device) {
      requestBody.dimensionFilterGroups = [
        {
          filters: [
            ...(country ? [{ dimension: "country", operator: "equals", expression: country.toUpperCase() }] : []),
            ...(device ? [{ dimension: "device", operator: "equals", expression: device.toLowerCase() }] : []),
          ]
        }
      ];
    }

    const response = await client.searchanalytics.query({
      siteUrl,
      requestBody,
    });

    if (!response.data.rows) return [];

    const monthlyMap = new Map<string, { clicks: number; impressions: number; ctrSum: number; positionSum: number; count: number }>();

    for (const row of response.data.rows) {
      const dateStr = row.keys?.[0] || "";
      const month = dateStr.substring(0, 7);
      
      const existing = monthlyMap.get(month) || { clicks: 0, impressions: 0, ctrSum: 0, positionSum: 0, count: 0 };
      existing.clicks += row.clicks || 0;
      existing.impressions += row.impressions || 0;
      existing.ctrSum += (row.ctr || 0) * 100;
      existing.positionSum += row.position || 0;
      existing.count += 1;
      monthlyMap.set(month, existing);
    }

    const result: GSCMonthlyData[] = [];
    Array.from(monthlyMap.entries()).forEach(([month, data]) => {
      result.push({
        month,
        clicks: data.clicks,
        impressions: data.impressions,
        ctr: Math.round((data.ctrSum / data.count) * 100) / 100,
        position: Math.round((data.positionSum / data.count) * 10) / 10,
      });
    });

    return result.sort((a, b) => a.month.localeCompare(b.month));
  } catch (error: any) {
    if (error.code === 403) {
      throw new Error("GSC_PERMISSION_DENIED: Service account does not have access to this site.");
    }
    if (error.code === 429) {
      throw new Error("GSC_QUOTA_EXCEEDED: API quota exceeded. Please try again later.");
    }
    throw error;
  }
}

export async function getGSCRankings(
  siteUrl: string,
  startDate: string,
  endDate: string,
  previousStartDate?: string,
  previousEndDate?: string,
  rowLimit: number = 500,
  country?: string,
  device?: string
): Promise<GSCRankingData[]> {
  if (!siteUrl || !startDate || !endDate) {
    throw new Error("Site URL, start date, and end date are required");
  }

  const client = await getSearchConsoleClient();
  if (!client) {
    throw new Error("Google Search Console client not configured");
  }

  const filters = [];
  if (country) {
    filters.push(`country=${country.toUpperCase()}`);
  }
  if (device) {
    filters.push(`device=${device.toLowerCase()}`);
  }
  const filterString = filters.length > 0 ? ` [filters: ${filters.join(", ")}]` : "";
  debugLog("gsc", `Rankings request: ${siteUrl}, ${startDate} to ${endDate}${filterString}`);

  try {
    const currentRequestBody: any = {
      startDate,
      endDate,
      dimensions: ["query", "page"],
      rowLimit,
      dataState: "final",
    };

    if (country || device) {
      currentRequestBody.dimensionFilterGroups = [
        {
          filters: [
            ...(country ? [{ dimension: "country", operator: "equals", expression: country.toUpperCase() }] : []),
            ...(device ? [{ dimension: "device", operator: "equals", expression: device.toLowerCase() }] : []),
          ]
        }
      ];
    }

    const currentResponse = await client.searchanalytics.query({
      siteUrl,
      requestBody: currentRequestBody,
    });

    const currentData = new Map<string, { page: string; position: number; clicks: number; impressions: number; ctr: number }>();
    
    if (currentResponse.data.rows) {
      for (const row of currentResponse.data.rows) {
        const query = row.keys?.[0] || "";
        const page = row.keys?.[1] || "";
        const existing = currentData.get(query);
        if (!existing || (row.position || 0) < existing.position) {
          currentData.set(query, {
            page,
            position: Math.round((row.position || 0) * 10) / 10,
            clicks: row.clicks || 0,
            impressions: row.impressions || 0,
            ctr: Math.round((row.ctr || 0) * 10000) / 100,
          });
        }
      }
    }

    let previousData = new Map<string, { position: number; clicks: number; impressions: number; ctr: number }>();
    if (previousStartDate && previousEndDate) {
      try {
        const previousRequestBody: any = {
          startDate: previousStartDate,
          endDate: previousEndDate,
          dimensions: ["query"],
          rowLimit,
          dataState: "all",
        };

        if (country || device) {
          previousRequestBody.dimensionFilterGroups = [
            {
              filters: [
                ...(country ? [{ dimension: "country", operator: "equals", expression: country.toUpperCase() }] : []),
                ...(device ? [{ dimension: "device", operator: "equals", expression: device.toLowerCase() }] : []),
              ]
            }
          ];
        }

        const previousResponse = await client.searchanalytics.query({
          siteUrl,
          requestBody: previousRequestBody,
        });

        if (previousResponse.data.rows) {
          for (const row of previousResponse.data.rows) {
            const query = row.keys?.[0] || "";
            previousData.set(query, {
              position: Math.round((row.position || 0) * 10) / 10,
              clicks: row.clicks || 0,
              impressions: row.impressions || 0,
              ctr: Math.round((row.ctr || 0) * 10000) / 100,
            });
          }
        }
      } catch (e) {
        console.log("[gsc] Could not fetch previous period data for comparison");
      }
    }

    const rankings: GSCRankingData[] = [];
    Array.from(currentData.entries()).forEach(([keyword, data]) => {
      const prev = previousData.get(keyword) || null;
      const change           = prev ? Math.round((prev.position    - data.position) * 10) / 10 : 0;
      const clicksDelta      = prev ? data.clicks      - prev.clicks      : 0;
      const impressionsDelta = prev ? data.impressions - prev.impressions  : 0;
      const ctrDelta         = prev ? Math.round((data.ctr - prev.ctr) * 100) / 100 : 0;

      rankings.push({
        keyword,
        position: data.position,
        previousPosition: prev?.position ?? null,
        change,
        url: data.page,
        clicks: data.clicks,
        impressions: data.impressions,
        ctr: data.ctr,
        clicksDelta,
        impressionsDelta,
        ctrDelta,
        source: "gsc",
      });
    });

    return rankings.sort((a, b) => a.position - b.position);
  } catch (error: any) {
    if (error.code === 403) {
      throw new Error("GSC_PERMISSION_DENIED: Service account does not have access to this site. Please add the service account email to Google Search Console with read access.");
    }
    if (error.code === 429) {
      throw new Error("GSC_QUOTA_EXCEEDED: Google Search Console API quota exceeded. Please try again later.");
    }
    if (error.message?.includes("not found")) {
      throw new Error("GSC_SITE_NOT_FOUND: The specified site URL was not found. Please verify the site URL format (e.g., https://example.com/ or sc-domain:example.com).");
    }
    throw error;
  }
}

export interface GA4MetricsData {
  sessions: number;
  totalUsers: number;
  newUsers: number;
  engagementRate: number;
  bounceRate: number;
  /** Avg engagement time per session in seconds (userEngagementDuration / sessions). */
  avgEngagementTimeSeconds: number;
  /** Same value formatted HH:MM:SS. */
  avgEngagementTimeFormatted: string;
  screenPageViews: number;
  conversions: number;
}

export async function getGA4Metrics(
  propertyId: string,
  startDate: string,
  endDate: string
): Promise<GA4MetricsData> {
  if (!propertyId || !startDate || !endDate) {
    throw new Error("Property ID, start date, and end date are required");
  }

  return withRetry(async () => {
    const client = await getAnalyticsDataClient();
    if (!client) {
      throw new Error("Google Analytics client not configured");
    }

    debugLog("ga4", `Metrics request: property=${propertyId}, ${startDate} to ${endDate}`);

    // userEngagementDuration replaces averageSessionDuration — we compute the
    // avg ourselves (userEngagementDuration / sessions) for correctness.
    const response = await client.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        metrics: [
          { name: "sessions" },
          { name: "totalUsers" },
          { name: "newUsers" },
          { name: "engagementRate" },
          { name: "bounceRate" },
          { name: "userEngagementDuration" },
          { name: "screenPageViews" },
          { name: "conversions" },
        ],
      },
    });

    const row = response.data.rows?.[0];
    if (!row?.metricValues) {
      debugLog("ga4", `No data found for property: ${propertyId}`);
      throw new Error(`No GA4 data found for property: ${propertyId}`);
    }

    debugLog("ga4", `Metrics received for property ${propertyId}`);

    const sessions = parseInt(row.metricValues[0]?.value || "0");
    const userEngagementDuration = parseFloat(row.metricValues[5]?.value || "0");
    const avgSec = computeAvgEngagementSeconds(userEngagementDuration, sessions);

    return {
      sessions,
      totalUsers: parseInt(row.metricValues[1]?.value || "0"),
      newUsers: parseInt(row.metricValues[2]?.value || "0"),
      engagementRate: parseFloat(row.metricValues[3]?.value || "0"),
      bounceRate: parseFloat(row.metricValues[4]?.value || "0"),
      avgEngagementTimeSeconds: avgSec,
      avgEngagementTimeFormatted: formatSecondsToHHMMSS(avgSec),
      screenPageViews: parseInt(row.metricValues[6]?.value || "0"),
      conversions: parseInt(row.metricValues[7]?.value || "0"),
    };
  });
}

// ── Engagement-time helpers ────────────────────────────────────────────────
// GA4 does NOT provide "Avg Time on Page" directly. The correct average
// engagement time per session = userEngagementDuration / sessions.
// NEVER use averageSessionDuration. Always use this formula.

/** Returns rounded seconds; safe-divides by 0. */
export function computeAvgEngagementSeconds(userEngagementDuration: number, sessions: number): number {
  if (!sessions || sessions <= 0) return 0;
  return Math.round(userEngagementDuration / sessions);
}

/** Formats seconds as HH:MM:SS (e.g. 38 → "00:00:38", 3670 → "01:01:10"). */
export function formatSecondsToHHMMSS(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export interface GA4TrafficMetrics {
  users: number;
  sessions: number;
  engagedSessions: number;
  /** Avg engagement time per session in whole seconds (rounded). */
  avgEngagementTimeSeconds: number;
  /** Same value formatted HH:MM:SS. */
  avgEngagementTimeFormatted: string;
  engagementRate: number;
}

export async function getGA4TrafficMetrics(
  propertyId: string,
  startDate: string,
  endDate: string
): Promise<GA4TrafficMetrics> {
  if (!propertyId || !startDate || !endDate) {
    throw new Error("Property ID, start date, and end date are required");
  }

  return withRetry(async () => {
    const client = await getAnalyticsDataClient();
    if (!client) {
      throw new Error("Google Analytics client not configured");
    }

    debugLog("ga4", `TrafficMetrics request: property=${propertyId}, ${startDate} to ${endDate}`);

    const response = await client.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        metrics: [
          { name: "totalUsers" },
          { name: "sessions" },
          { name: "engagedSessions" },
          { name: "userEngagementDuration" }, // avg engagement = this / sessions
          { name: "engagementRate" },
        ],
      },
    });

    const row = response.data.rows?.[0];
    const users = parseInt(row?.metricValues?.[0]?.value || "0");
    const sessions = parseInt(row?.metricValues?.[1]?.value || "0");
    const engagedSessions = parseInt(row?.metricValues?.[2]?.value || "0");

    // Look up userEngagementDuration by NAME — GA4 may not always return it at
    // the expected index, which was giving wrong avg engagement time values.
    const headers = (response.data.metricHeaders || []) as Array<{ name?: string }>;
    const idxUserEngDur = headers.findIndex((h) => h?.name === "userEngagementDuration");
    const userEngagementDuration =
      idxUserEngDur >= 0
        ? parseFloat(row?.metricValues?.[idxUserEngDur]?.value || "0")
        : parseFloat(row?.metricValues?.[3]?.value || "0");
    const engagementRateRaw = parseFloat(row?.metricValues?.[4]?.value || "0");

    // avg engagement time (sec) = userEngagementDuration / sessions
    const avgSec = computeAvgEngagementSeconds(userEngagementDuration, sessions);

    return {
      users,
      sessions,
      engagedSessions,
      avgEngagementTimeSeconds: avgSec,
      avgEngagementTimeFormatted: formatSecondsToHHMMSS(avgSec),
      engagementRate: Math.round(engagementRateRaw * 10000) / 100,
    };
  });
}

export interface GA4DailyData {
  date: string;
  users: number;
  sessions: number;
  pageviews: number;
}

export async function getGA4DailyTraffic(
  propertyId: string,
  startDate: string,
  endDate: string
): Promise<GA4DailyData[]> {
  if (!propertyId || !startDate || !endDate) {
    throw new Error("Property ID, start date, and end date are required");
  }

  const client = await getAnalyticsDataClient();
  if (!client) {
    throw new Error("Google Analytics client not configured");
  }

  debugLog("ga4", `Daily traffic request: property=${propertyId}, ${startDate} to ${endDate}`);

  const response = await client.properties.runReport({
    property: `properties/${propertyId}`,
    requestBody: {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: "date" }],
      metrics: [
        { name: "totalUsers" },
        { name: "sessions" },
        { name: "screenPageViews" },
      ],
      orderBys: [{ dimension: { dimensionName: "date" }, desc: false }],
      limit: "366",
    },
  });

  if (!response.data.rows) {
    debugLog("ga4", `No daily traffic data for property ${propertyId}`);
    return [];
  }

  debugLog("ga4", `Daily traffic: ${response.data.rows.length} days returned`);

  return response.data.rows.map((row: any) => {
    const rawDate = row.dimensionValues?.[0]?.value || "";
    const formatted = rawDate.length === 8
      ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
      : rawDate;
    return {
      date: formatted,
      users: parseInt(row.metricValues?.[0]?.value || "0"),
      sessions: parseInt(row.metricValues?.[1]?.value || "0"),
      pageviews: parseInt(row.metricValues?.[2]?.value || "0"),
    };
  });
}

export interface GA4TrafficSource {
  source: string;
  users: number;
  sessions: number;
  avgSessionDuration: string;
  bounceRate: number;
}

export async function getGA4TrafficSources(
  propertyId: string,
  startDate: string,
  endDate: string,
  rowLimit: number = 50
): Promise<GA4TrafficSource[]> {
  if (!propertyId || !startDate || !endDate) {
    throw new Error("Property ID, start date, and end date are required");
  }

  const client = await getAnalyticsDataClient();
  if (!client) {
    throw new Error("Google Analytics client not configured");
  }

  const response = await client.properties.runReport({
    property: `properties/${propertyId}`,
    requestBody: {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: "sessionSource" }],
      metrics: [
        { name: "totalUsers" },
        { name: "sessions" },
        { name: "averageSessionDuration" },
        { name: "bounceRate" },
      ],
      limit: rowLimit.toString(),
      orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
    },
  });

  if (!response.data.rows) return [];

  return response.data.rows.map((row: any) => {
    const avgDuration = parseFloat(row.metricValues?.[2]?.value || "0");
    const minutes = Math.floor(avgDuration / 60);
    const seconds = Math.floor(avgDuration % 60);

    return {
      source: row.dimensionValues?.[0]?.value || "(not set)",
      users: parseInt(row.metricValues?.[0]?.value || "0"),
      sessions: parseInt(row.metricValues?.[1]?.value || "0"),
      avgSessionDuration: `${minutes}:${seconds.toString().padStart(2, "0")}`,
      bounceRate: Math.round(parseFloat(row.metricValues?.[3]?.value || "0") * 100) / 100,
    };
  });
}

export interface GA4TopPage {
  page: string;
  users: number;
  sessions: number;
  conversions: number;
}

export async function getGA4TopPages(
  propertyId: string,
  startDate: string,
  endDate: string,
  rowLimit: number = 10
): Promise<GA4TopPage[]> {
  if (!propertyId || !startDate || !endDate) {
    throw new Error("Property ID, start date, and end date are required");
  }

  const client = await getAnalyticsDataClient();
  if (!client) {
    throw new Error("Google Analytics client not configured");
  }

  debugLog("ga4", `Top pages request: property=${propertyId}, ${startDate} to ${endDate}, limit=${rowLimit}`);

  const response = await client.properties.runReport({
    property: `properties/${propertyId}`,
    requestBody: {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: "pagePath" }],
      metrics: [
        { name: "sessions" },
        { name: "totalUsers" },
        { name: "conversions" },
      ],
      limit: (rowLimit + 5).toString(),
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    },
  });

  if (!response.data.rows) {
    debugLog("ga4", `Top pages: no rows returned for property ${propertyId}`);
    return [];
  }

  const results = response.data.rows
    .map((row: any) => ({
      page: row.dimensionValues?.[0]?.value || "/",
      sessions: parseInt(row.metricValues?.[0]?.value || "0"),
      users: parseInt(row.metricValues?.[1]?.value || "0"),
      conversions: parseInt(row.metricValues?.[2]?.value || "0"),
    }))
    .filter((item: GA4TopPage) => item.page !== "(not set)")
    .slice(0, rowLimit);

  debugLog("ga4", `Top pages: returning ${results.length} pages (filtered out "(not set)")`);
  return results;
}

// ── GA4 Extended Top Pages ─────────────────────────────────────────────────
// Matches user's curl: dimension=pagePath, metrics=screenPageViews, totalUsers,
// averageSessionDuration, sessions, engagementRate, ordered by screenPageViews desc.
export interface GA4TopPageExtended {
  page: string;
  screenPageViews: number;
  totalUsers: number;
  sessions: number;
  entrances: number;
  /** Avg engagement time per session in whole seconds (userEngagementDuration / sessions). */
  avgEngagementTimeSeconds: number;
  /** Same value formatted HH:MM:SS. */
  avgEngagementTimeFormatted: string;
  engagementRate: number;
}

export async function getGA4TopPagesExtended(
  propertyId: string,
  startDate: string,
  endDate: string,
  rowLimit: number = 10
): Promise<GA4TopPageExtended[]> {
  if (!propertyId || !startDate || !endDate) {
    throw new Error("Property ID, start date, and end date are required");
  }

  return withRetry(async () => {
    const client = await getAnalyticsDataClient();
    if (!client) {
      throw new Error("Google Analytics client not configured");
    }

    debugLog("ga4", `TopPagesExtended request: property=${propertyId}, ${startDate} to ${endDate}, limit=${rowLimit}`);

    // Use userEngagementDuration + sessions per page; we compute the avg
    // locally (userEngagementDuration / sessions) instead of averageSessionDuration.
    const response = await client.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "pagePath" }],
        metrics: [
          { name: "screenPageViews" },
          { name: "totalUsers" },
          { name: "userEngagementDuration" },
          { name: "sessions" },
          { name: "engagementRate" },
          { name: "entrances" },
        ],
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
        limit: rowLimit.toString(),
      },
    });

    if (!response.data.rows) return [];

    const headers = (response.data.metricHeaders || []) as Array<{ name?: string }>;
    const idx = (name: string) => headers.findIndex((h) => h?.name === name);
    const idxUserEngDur = idx("userEngagementDuration");
    const idxSessions   = idx("sessions");
    const idxEngRate    = idx("engagementRate");
    const idxEntrances  = idx("entrances");

    return response.data.rows
      .map((row: any) => {
        const mv = row.metricValues || [];
        const userEngagementDuration = parseFloat(mv[idxUserEngDur >= 0 ? idxUserEngDur : 2]?.value || "0");
        const sessions = parseInt(mv[idxSessions >= 0 ? idxSessions : 3]?.value || "0");
        const engagementRateRaw = parseFloat(mv[idxEngRate >= 0 ? idxEngRate : 4]?.value || "0");
        const entrances = parseInt(mv[idxEntrances >= 0 ? idxEntrances : 5]?.value || "0");
        const avgSec = computeAvgEngagementSeconds(userEngagementDuration, sessions);

        return {
          page: row.dimensionValues?.[0]?.value || "/",
          screenPageViews: parseInt(mv[0]?.value || "0"),
          totalUsers: parseInt(mv[1]?.value || "0"),
          sessions,
          entrances,
          avgEngagementTimeSeconds: avgSec,
          avgEngagementTimeFormatted: formatSecondsToHHMMSS(avgSec),
          engagementRate: Math.round(engagementRateRaw * 10000) / 100,
        };
      })
      .filter((item) => item.page !== "(not set)");
  });
}

const AI_REFERRER_PATTERNS = [
  "chatgpt.com",
  "chat.openai.com",
  "gemini.google.com",
  "bard.google.com",
  "perplexity.ai",
  "copilot.microsoft.com",
  "bing.com/chat",
  "claude.ai",
  "you.com",
  "phind.com",
];

export async function getGA4AIReferrers(
  propertyId: string,
  startDate: string,
  endDate: string
): Promise<GA4TrafficSource[]> {
  debugLog("ga4", `AI Referrers request: property=${propertyId}, ${startDate} to ${endDate}`);
  
  const allSources = await getGA4TrafficSources(propertyId, startDate, endDate, 500);
  debugLog("ga4", `AI Referrers: ${allSources.length} total traffic sources retrieved from GA4`);
  
  const aiSources = allSources.filter((source) =>
    AI_REFERRER_PATTERNS.some((pattern) =>
      source.source.toLowerCase().includes(pattern.toLowerCase())
    )
  );
  
  debugLog("ga4", `AI Referrers: ${aiSources.length} matched AI patterns out of ${allSources.length} sources`);
  if (aiSources.length > 0) {
    debugLog("ga4", `AI Referrers found: ${aiSources.map(s => `${s.source}(${s.users} users)`).join(", ")}`);
  }
  
  return aiSources;
}
