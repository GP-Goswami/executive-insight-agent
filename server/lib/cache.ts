/**
 * Smart API Cache Layer
 * ──────────────────────────────────────────────────────────────────────────────
 * Intercepts external API calls for GA4, GSC, SEMrush, and Backlinks.
 * Returns cached data from the database until TTL expires, then re-fetches.
 *
 * Usage:
 *   const data = await fetchWithCache("ga4", propertyId, "top-pages", () => getGA4TopPages(...));
 */
import { pool } from "../db";

type Provider = "ga4" | "gsc" | "semrush" | "backlinks";

const TABLE_MAP: Record<Provider, string> = {
  ga4: "ga4_data",
  gsc: "gsc_data",
  semrush: "semrush_data",
  backlinks: "backlink_data",
};

const ID_FIELD_MAP: Record<Provider, string> = {
  ga4: "property_id",
  gsc: "site_url",
  semrush: "domain",
  backlinks: "domain",
};

/**
 * Smart fetch with DB-backed caching.
 * @param provider   Which API: "ga4" | "gsc" | "semrush" | "backlinks"
 * @param identifier The primary key value (e.g. propertyId, siteUrl, domain)
 * @param endpoint   A short label for this specific query (e.g. "top-pages")
 * @param fetcher    The async function that calls the real external API
 * @param forceRefresh  If true, ignores cache and forces a fresh fetch
 * @param ttlHours   Hours before cached data is considered stale (default: 24)
 */
export async function fetchWithCache<T>(
  provider: Provider,
  identifier: string,
  endpoint: string,
  fetcher: () => Promise<T>,
  forceRefresh = false,
  ttlHours = 24
): Promise<T> {
  const table = TABLE_MAP[provider];
  const idField = ID_FIELD_MAP[provider];

  // ── 1. Check cache (skip if forceRefresh) ──
  if (!forceRefresh) {
    const result = await pool.query(
      `SELECT data_json, fetched_at FROM ${table} WHERE ${idField} = $1 AND endpoint = $2 LIMIT 1`,
      [identifier, endpoint]
    );
    if (result.rows.length > 0) {
      const row = result.rows[0];
      const ageHours = (Date.now() - new Date(row.fetched_at).getTime()) / 3_600_000;
      if (ageHours < ttlHours) {
        console.log(`[CACHE HIT] ${provider}/${endpoint} for "${identifier}" (age: ${ageHours.toFixed(1)}h)`);
        return row.data_json as T;
      }
      console.log(`[CACHE EXPIRED] ${provider}/${endpoint} for "${identifier}" (age: ${ageHours.toFixed(1)}h) — re-fetching`);
    }
  } else {
    console.log(`[CACHE BYPASS] Force-refresh for ${provider}/${endpoint} - "${identifier}"`);
  }

  // ── 2. Call external API ──
  console.log(`[CACHE MISS] Fetching live data: ${provider}/${endpoint} - "${identifier}"`);
  const freshData = await fetcher();

  // ── 3. Upsert into cache table ──
  await pool.query(
    `DELETE FROM ${table} WHERE ${idField} = $1 AND endpoint = $2`,
    [identifier, endpoint]
  );
  await pool.query(
    `INSERT INTO ${table} (${idField}, endpoint, data_json, fetched_at) VALUES ($1, $2, $3, NOW())`,
    [identifier, endpoint, JSON.stringify(freshData)]
  );

  return freshData;
}

/**
 * Wipe all cached data for a given provider.
 * Called by POST /api/sync/:provider manual refresh endpoint.
 */
export async function clearProviderCache(provider: Provider): Promise<void> {
  const table = TABLE_MAP[provider];
  await pool.query(`DELETE FROM ${table}`);
  console.log(`[CACHE CLEARED] All ${provider} cache entries deleted`);
}

/**
 * Get cache status (last fetch time + count) for all 4 providers.
 */
export async function getCacheStatus(): Promise<Record<Provider, { fetchedAt: string | null; count: number }>> {
  const providers: Provider[] = ["ga4", "gsc", "semrush", "backlinks"];
  const result: Record<string, { fetchedAt: string | null; count: number }> = {};

  for (const p of providers) {
    const table = TABLE_MAP[p];
    try {
      const row = await pool.query(
        `SELECT MAX(fetched_at)::text AS last_fetched, COUNT(*)::int AS cnt FROM ${table}`
      );
      result[p] = {
        fetchedAt: row.rows[0]?.last_fetched ?? null,
        count: row.rows[0]?.cnt ?? 0,
      };
    } catch {
      result[p] = { fetchedAt: null, count: 0 };
    }
  }

  return result as Record<Provider, { fetchedAt: string | null; count: number }>;
}
