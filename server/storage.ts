import {
  clients,
  properties,
  ga4DailyMetrics,
  gscDaily,
  rankDaily,
  backlinksDaily,
  aiReferrerDaily,
  aiSources,
  syncRuns,
  kpiDailySummary,
  shareLinks,
  type Client,
  type InsertClient,
  type Property,
  type InsertProperty,
  type Ga4Metrics,
  type InsertGa4Metrics,
  type GscMetrics,
  type InsertGscMetrics,
  type RankMetrics,
  type InsertRankMetrics,
  type BacklinksMetrics,
  type InsertBacklinksMetrics,
  type AiReferrerMetrics,
  type InsertAiReferrerMetrics,
  type AiSource,
  type InsertAiSource,
  type SyncRun,
  type InsertSyncRun,
  type KpiSummary,
  type InsertKpiSummary,
  type ShareLink,
  type InsertShareLink,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";

export interface IStorage {
  // Clients
  getClients(): Promise<Client[]>;
  getClient(id: string): Promise<Client | undefined>;
  createClient(client: InsertClient): Promise<Client>;

  // Properties
  getProperties(clientId?: string): Promise<Property[]>;
  getProperty(id: string): Promise<Property | undefined>;
  createProperty(property: InsertProperty): Promise<Property>;

  // Metrics Overview
  getOverviewMetrics(propertyId: string, startDate: Date, endDate: Date): Promise<{
    totalUsers: number;
    sessions: number;
    conversions: number;
    clicks: number;
    avgPosition: number;
    totalBacklinks: number;
    aiUsers: number;
  }>;

  // GA4 Metrics
  getGa4Metrics(propertyId: string, startDate: Date, endDate: Date): Promise<Ga4Metrics[]>;
  createGa4Metrics(metrics: InsertGa4Metrics): Promise<Ga4Metrics>;
  upsertGa4DailyMetrics(rows: InsertGa4Metrics[]): Promise<number>;
  getPropertyIdByGa4Id(ga4PropertyId: string, domain?: string): Promise<string | null>;

  // GSC Metrics
  getGscMetrics(propertyId: string, startDate: Date, endDate: Date): Promise<GscMetrics[]>;
  createGscMetrics(metrics: InsertGscMetrics): Promise<GscMetrics>;

  // Rankings
  getRankings(propertyId: string, startDate: Date, endDate: Date): Promise<RankMetrics[]>;
  createRanking(ranking: InsertRankMetrics): Promise<RankMetrics>;

  // Backlinks
  getBacklinks(propertyId: string, startDate: Date, endDate: Date): Promise<BacklinksMetrics[]>;
  createBacklinks(backlinks: InsertBacklinksMetrics): Promise<BacklinksMetrics>;

  // AI Referrers
  getAiReferrers(propertyId: string, startDate: Date, endDate: Date): Promise<AiReferrerMetrics[]>;
  createAiReferrer(referrer: InsertAiReferrerMetrics): Promise<AiReferrerMetrics>;

  // AI Sources
  getAiSources(): Promise<AiSource[]>;
  createAiSource(source: InsertAiSource): Promise<AiSource>;

  // Sync Runs
  getSyncRuns(propertyId?: string): Promise<SyncRun[]>;
  createSyncRun(run: InsertSyncRun): Promise<SyncRun>;

  // Share Links
  getShareLinks(propertyId: string): Promise<ShareLink[]>;
  getShareLinkByToken(token: string): Promise<ShareLink | undefined>;
  createShareLink(link: InsertShareLink): Promise<ShareLink>;

  // SEO Aggregation
  getAggregatedSeoData(propertyId: string, startDate: Date, endDate: Date, previousStartDate?: Date, previousEndDate?: Date): Promise<{
    ga4: { users: number; sessions: number; conversions: number };
    ga4Previous?: { users: number; sessions: number; conversions: number };
    gsc: { clicks: number; impressions: number; ctr: number; avgPosition: number };
    gscPrevious?: { clicks: number };
    rankings: { totalKeywords: number; top10Keywords: number; improvedKeywords: number; declinedKeywords: number };
    backlinks: { currentBacklinks: number; previousBacklinks: number; currentReferringDomains: number; previousReferringDomains: number };
  }>;

  getDailyTrends(propertyId: string, startDate: Date, endDate: Date): Promise<{
    ga4Daily: { date: string; users: number; sessions: number }[];
    gscDaily: { date: string; clicks: number; impressions: number }[];
  }>;

  getKeywordDistribution(propertyId: string, startDate: Date, endDate: Date): Promise<{
    top3: number; top10: number; top20: number; top50: number; top100: number; beyond: number;
  }>;

  getGscTopPages(propertyId: string, startDate: Date, endDate: Date): Promise<{
    page: string; clicks: number; impressions: number; ctr: number; position: number;
  }[]>;
}

export class DatabaseStorage implements IStorage {
  // Clients
  async getClients(): Promise<Client[]> {
    return await db.select().from(clients).orderBy(desc(clients.createdAt));
  }

  async getClient(id: string): Promise<Client | undefined> {
    const [client] = await db.select().from(clients).where(eq(clients.id, id));
    return client;
  }

  async createClient(client: InsertClient): Promise<Client> {
    const [created] = await db.insert(clients).values(client).returning();
    return created;
  }

  // Properties
  async getProperties(clientId?: string): Promise<Property[]> {
    if (clientId) {
      return await db.select().from(properties).where(eq(properties.clientId, clientId));
    }
    return await db.select().from(properties);
  }

  async getProperty(id: string): Promise<Property | undefined> {
    const [property] = await db.select().from(properties).where(eq(properties.id, id));
    return property;
  }

  async createProperty(property: InsertProperty): Promise<Property> {
    const [created] = await db.insert(properties).values(property).returning();
    return created;
  }

  // Overview Metrics
  async getOverviewMetrics(propertyId: string, startDate: Date, endDate: Date) {
    const [ga4Summary] = await db
      .select({
        totalUsers: sql<number>`COALESCE(SUM(${ga4DailyMetrics.totalUsers}), 0)`,
        sessions: sql<number>`COALESCE(SUM(${ga4DailyMetrics.sessions}), 0)`,
        conversions: sql<number>`COALESCE(SUM(${ga4DailyMetrics.conversions}), 0)`,
      })
      .from(ga4DailyMetrics)
      .where(
        and(
          eq(ga4DailyMetrics.propertyId, propertyId),
          gte(ga4DailyMetrics.date, startDate),
          lte(ga4DailyMetrics.date, endDate)
        )
      );

    const [gscSummary] = await db
      .select({
        clicks: sql<number>`COALESCE(SUM(${gscDaily.clicks}), 0)`,
        avgPosition: sql<number>`COALESCE(AVG(${gscDaily.avgPosition}), 0)`,
      })
      .from(gscDaily)
      .where(
        and(
          eq(gscDaily.propertyId, propertyId),
          gte(gscDaily.date, startDate),
          lte(gscDaily.date, endDate)
        )
      );

    const [backlinkSummary] = await db
      .select({
        totalBacklinks: sql<number>`COALESCE(MAX(${backlinksDaily.totalBacklinks}), 0)`,
      })
      .from(backlinksDaily)
      .where(
        and(
          eq(backlinksDaily.propertyId, propertyId),
          gte(backlinksDaily.date, startDate),
          lte(backlinksDaily.date, endDate)
        )
      );

    const [aiSummary] = await db
      .select({
        aiUsers: sql<number>`COALESCE(SUM(${aiReferrerDaily.totalUsers}), 0)`,
      })
      .from(aiReferrerDaily)
      .where(
        and(
          eq(aiReferrerDaily.propertyId, propertyId),
          gte(aiReferrerDaily.date, startDate),
          lte(aiReferrerDaily.date, endDate)
        )
      );

    return {
      totalUsers: Number(ga4Summary?.totalUsers || 0),
      sessions: Number(ga4Summary?.sessions || 0),
      conversions: Number(ga4Summary?.conversions || 0),
      clicks: Number(gscSummary?.clicks || 0),
      avgPosition: Number(gscSummary?.avgPosition || 0),
      totalBacklinks: Number(backlinkSummary?.totalBacklinks || 0),
      aiUsers: Number(aiSummary?.aiUsers || 0),
    };
  }

  // GA4 Metrics
  async getGa4Metrics(propertyId: string, startDate: Date, endDate: Date): Promise<Ga4Metrics[]> {
    return await db
      .select()
      .from(ga4DailyMetrics)
      .where(
        and(
          eq(ga4DailyMetrics.propertyId, propertyId),
          gte(ga4DailyMetrics.date, startDate),
          lte(ga4DailyMetrics.date, endDate)
        )
      )
      .orderBy(desc(ga4DailyMetrics.date));
  }

  async createGa4Metrics(metrics: InsertGa4Metrics): Promise<Ga4Metrics> {
    const [created] = await db.insert(ga4DailyMetrics).values(metrics).returning();
    return created;
  }

  async getPropertyIdByGa4Id(ga4PropertyId: string, domain?: string): Promise<string | null> {
    if (domain) {
      const domainResults = await db
        .select({ id: properties.id })
        .from(properties)
        .where(and(eq(properties.ga4PropertyId, ga4PropertyId), eq(properties.name, domain)))
        .limit(1);
      if (domainResults.length > 0) return domainResults[0].id;
    }
    const results = await db
      .select({ id: properties.id })
      .from(properties)
      .where(eq(properties.ga4PropertyId, ga4PropertyId))
      .limit(1);
    return results.length > 0 ? results[0].id : null;
  }

  async upsertGa4DailyMetrics(rows: InsertGa4Metrics[]): Promise<number> {
    if (rows.length === 0) return 0;
    let inserted = 0;
    for (const row of rows) {
      const existing = await db
        .select({ id: ga4DailyMetrics.id })
        .from(ga4DailyMetrics)
        .where(
          and(
            eq(ga4DailyMetrics.propertyId, row.propertyId),
            eq(ga4DailyMetrics.date, row.date),
            row.landingPagePath
              ? eq(ga4DailyMetrics.landingPagePath, row.landingPagePath)
              : sql`${ga4DailyMetrics.landingPagePath} IS NULL`
          )
        )
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(ga4DailyMetrics)
          .set({
            totalUsers: row.totalUsers,
            sessions: row.sessions,
            conversions: row.conversions,
          })
          .where(eq(ga4DailyMetrics.id, existing[0].id));
      } else {
        await db.insert(ga4DailyMetrics).values(row);
      }
      inserted++;
    }
    return inserted;
  }

  // GSC Metrics
  async getGscMetrics(propertyId: string, startDate: Date, endDate: Date): Promise<GscMetrics[]> {
    return await db
      .select()
      .from(gscDaily)
      .where(
        and(
          eq(gscDaily.propertyId, propertyId),
          gte(gscDaily.date, startDate),
          lte(gscDaily.date, endDate)
        )
      )
      .orderBy(desc(gscDaily.date));
  }

  async createGscMetrics(metrics: InsertGscMetrics): Promise<GscMetrics> {
    const [created] = await db.insert(gscDaily).values(metrics).returning();
    return created;
  }

  // Rankings
  async getRankings(propertyId: string, startDate: Date, endDate: Date): Promise<RankMetrics[]> {
    return await db
      .select()
      .from(rankDaily)
      .where(
        and(
          eq(rankDaily.propertyId, propertyId),
          gte(rankDaily.date, startDate),
          lte(rankDaily.date, endDate)
        )
      )
      .orderBy(desc(rankDaily.date));
  }

  async createRanking(ranking: InsertRankMetrics): Promise<RankMetrics> {
    const [created] = await db.insert(rankDaily).values(ranking).returning();
    return created;
  }

  // Backlinks
  async getBacklinks(propertyId: string, startDate: Date, endDate: Date): Promise<BacklinksMetrics[]> {
    return await db
      .select()
      .from(backlinksDaily)
      .where(
        and(
          eq(backlinksDaily.propertyId, propertyId),
          gte(backlinksDaily.date, startDate),
          lte(backlinksDaily.date, endDate)
        )
      )
      .orderBy(desc(backlinksDaily.date));
  }

  async createBacklinks(backlinks: InsertBacklinksMetrics): Promise<BacklinksMetrics> {
    const [created] = await db.insert(backlinksDaily).values(backlinks).returning();
    return created;
  }

  // AI Referrers
  async getAiReferrers(propertyId: string, startDate: Date, endDate: Date): Promise<AiReferrerMetrics[]> {
    return await db
      .select()
      .from(aiReferrerDaily)
      .where(
        and(
          eq(aiReferrerDaily.propertyId, propertyId),
          gte(aiReferrerDaily.date, startDate),
          lte(aiReferrerDaily.date, endDate)
        )
      )
      .orderBy(desc(aiReferrerDaily.date));
  }

  async createAiReferrer(referrer: InsertAiReferrerMetrics): Promise<AiReferrerMetrics> {
    const [created] = await db.insert(aiReferrerDaily).values(referrer).returning();
    return created;
  }

  // AI Sources
  async getAiSources(): Promise<AiSource[]> {
    return await db.select().from(aiSources);
  }

  async createAiSource(source: InsertAiSource): Promise<AiSource> {
    const [created] = await db.insert(aiSources).values(source).returning();
    return created;
  }

  // Sync Runs
  async getSyncRuns(propertyId?: string): Promise<SyncRun[]> {
    if (propertyId) {
      return await db
        .select()
        .from(syncRuns)
        .where(eq(syncRuns.propertyId, propertyId))
        .orderBy(desc(syncRuns.startedAt));
    }
    return await db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt));
  }

  async createSyncRun(run: InsertSyncRun): Promise<SyncRun> {
    const [created] = await db.insert(syncRuns).values(run).returning();
    return created;
  }

  // Share Links
  async getShareLinks(propertyId: string): Promise<ShareLink[]> {
    return await db
      .select()
      .from(shareLinks)
      .where(eq(shareLinks.propertyId, propertyId))
      .orderBy(desc(shareLinks.createdAt));
  }

  async getShareLinkByToken(token: string): Promise<ShareLink | undefined> {
    const [link] = await db.select().from(shareLinks).where(eq(shareLinks.token, token));
    return link;
  }

  async createShareLink(link: InsertShareLink): Promise<ShareLink> {
    const [created] = await db.insert(shareLinks).values(link).returning();
    return created;
  }
  async getAggregatedSeoData(propertyId: string, startDate: Date, endDate: Date, previousStartDate?: Date, previousEndDate?: Date) {
    const [ga4Summary] = await db
      .select({
        totalUsers: sql<number>`COALESCE(SUM(${ga4DailyMetrics.totalUsers}), 0)`,
        sessions: sql<number>`COALESCE(SUM(${ga4DailyMetrics.sessions}), 0)`,
        conversions: sql<number>`COALESCE(SUM(${ga4DailyMetrics.conversions}), 0)`,
      })
      .from(ga4DailyMetrics)
      .where(
        and(
          eq(ga4DailyMetrics.propertyId, propertyId),
          gte(ga4DailyMetrics.date, startDate),
          lte(ga4DailyMetrics.date, endDate)
        )
      );

    let ga4Previous = undefined;
    if (previousStartDate && previousEndDate) {
      const [prevSummary] = await db
        .select({
          totalUsers: sql<number>`COALESCE(SUM(${ga4DailyMetrics.totalUsers}), 0)`,
          sessions: sql<number>`COALESCE(SUM(${ga4DailyMetrics.sessions}), 0)`,
          conversions: sql<number>`COALESCE(SUM(${ga4DailyMetrics.conversions}), 0)`,
        })
        .from(ga4DailyMetrics)
        .where(
          and(
            eq(ga4DailyMetrics.propertyId, propertyId),
            gte(ga4DailyMetrics.date, previousStartDate),
            lte(ga4DailyMetrics.date, previousEndDate)
          )
        );
      ga4Previous = {
        users: Number(prevSummary?.totalUsers || 0),
        sessions: Number(prevSummary?.sessions || 0),
        conversions: Number(prevSummary?.conversions || 0),
      };
    }

    const [gscSummary] = await db
      .select({
        clicks: sql<number>`COALESCE(SUM(${gscDaily.clicks}), 0)`,
        impressions: sql<number>`COALESCE(SUM(${gscDaily.impressions}), 0)`,
        ctr: sql<number>`CASE WHEN SUM(${gscDaily.impressions}) > 0 THEN (SUM(${gscDaily.clicks})::numeric / SUM(${gscDaily.impressions})) * 100 ELSE 0 END`,
        avgPosition: sql<number>`COALESCE(AVG(${gscDaily.avgPosition}), 0)`,
      })
      .from(gscDaily)
      .where(
        and(
          eq(gscDaily.propertyId, propertyId),
          gte(gscDaily.date, startDate),
          lte(gscDaily.date, endDate)
        )
      );

    let gscPrevious: { clicks: number } | undefined = undefined;
    if (previousStartDate && previousEndDate) {
      const [gscPrevSummary] = await db
        .select({ clicks: sql<number>`COALESCE(SUM(${gscDaily.clicks}), 0)` })
        .from(gscDaily)
        .where(
          and(
            eq(gscDaily.propertyId, propertyId),
            gte(gscDaily.date, previousStartDate),
            lte(gscDaily.date, previousEndDate)
          )
        );
      gscPrevious = { clicks: Number(gscPrevSummary?.clicks || 0) };
    }

    const [rankingSummary] = await db
      .select({
        totalKeywords: sql<number>`COUNT(DISTINCT ${rankDaily.keyword})`,
        top10Keywords: sql<number>`COUNT(DISTINCT CASE WHEN ${rankDaily.position} <= 10 THEN ${rankDaily.keyword} END)`,
      })
      .from(rankDaily)
      .where(
        and(
          eq(rankDaily.propertyId, propertyId),
          gte(rankDaily.date, startDate),
          lte(rankDaily.date, endDate)
        )
      );

    let improvedKeywords = 0;
    let declinedKeywords = 0;
    if (previousStartDate && previousEndDate) {
      const movementResult = await db.execute(sql`
        WITH current_ranks AS (
          SELECT keyword, AVG(position) as avg_pos
          FROM rank_daily
          WHERE property_id = ${propertyId}
            AND date >= ${startDate}
            AND date <= ${endDate}
          GROUP BY keyword
        ),
        previous_ranks AS (
          SELECT keyword, AVG(position) as avg_pos
          FROM rank_daily
          WHERE property_id = ${propertyId}
            AND date >= ${previousStartDate}
            AND date <= ${previousEndDate}
          GROUP BY keyword
        )
        SELECT
          COUNT(CASE WHEN c.avg_pos < p.avg_pos THEN 1 END) as improved,
          COUNT(CASE WHEN c.avg_pos > p.avg_pos THEN 1 END) as declined
        FROM current_ranks c
        JOIN previous_ranks p ON c.keyword = p.keyword
      `);
      const movementRow = movementResult.rows?.[0] as any;
      if (movementRow) {
        improvedKeywords = Number(movementRow.improved || 0);
        declinedKeywords = Number(movementRow.declined || 0);
      }
    }

    let backlinksCurrent = { totalBacklinks: 0, referringDomains: 0 };
    let backlinksPrevious = { totalBacklinks: 0, referringDomains: 0 };
    try {
      const [blCurrent] = await db
        .select({
          totalBacklinks: sql<number>`COALESCE(MAX(${backlinksDaily.totalBacklinks}), 0)`,
          referringDomains: sql<number>`COALESCE(MAX(${backlinksDaily.referringDomains}), 0)`,
        })
        .from(backlinksDaily)
        .where(
          and(
            eq(backlinksDaily.propertyId, propertyId),
            gte(backlinksDaily.date, startDate),
            lte(backlinksDaily.date, endDate)
          )
        );
      if (blCurrent) {
        backlinksCurrent = {
          totalBacklinks: Number(blCurrent.totalBacklinks || 0),
          referringDomains: Number(blCurrent.referringDomains || 0),
        };
      }
      if (previousStartDate && previousEndDate) {
        const [blPrev] = await db
          .select({
            totalBacklinks: sql<number>`COALESCE(MAX(${backlinksDaily.totalBacklinks}), 0)`,
            referringDomains: sql<number>`COALESCE(MAX(${backlinksDaily.referringDomains}), 0)`,
          })
          .from(backlinksDaily)
          .where(
            and(
              eq(backlinksDaily.propertyId, propertyId),
              gte(backlinksDaily.date, previousStartDate),
              lte(backlinksDaily.date, previousEndDate)
            )
          );
        if (blPrev) {
          backlinksPrevious = {
            totalBacklinks: Number(blPrev.totalBacklinks || 0),
            referringDomains: Number(blPrev.referringDomains || 0),
          };
        }
      }
    } catch (e) {
      console.error("Failed to fetch backlinks data:", e);
    }

    return {
      ga4: {
        users: Number(ga4Summary?.totalUsers || 0),
        sessions: Number(ga4Summary?.sessions || 0),
        conversions: Number(ga4Summary?.conversions || 0),
      },
      ga4Previous,
      gsc: {
        clicks: Number(gscSummary?.clicks || 0),
        impressions: Number(gscSummary?.impressions || 0),
        ctr: Number(gscSummary?.ctr || 0),
        avgPosition: Number(gscSummary?.avgPosition || 0),
      },
      gscPrevious,
      rankings: {
        totalKeywords: Number(rankingSummary?.totalKeywords || 0),
        top10Keywords: Number(rankingSummary?.top10Keywords || 0),
        improvedKeywords,
        declinedKeywords,
      },
      backlinks: {
        currentBacklinks: backlinksCurrent.totalBacklinks,
        previousBacklinks: backlinksPrevious.totalBacklinks,
        currentReferringDomains: backlinksCurrent.referringDomains,
        previousReferringDomains: backlinksPrevious.referringDomains,
      },
    };
  }

  async getDailyTrends(propertyId: string, startDate: Date, endDate: Date) {
    const ga4Rows = await db
      .select({
        date: sql<string>`${ga4DailyMetrics.date}::date::text`,
        users: sql<number>`COALESCE(SUM(${ga4DailyMetrics.totalUsers}), 0)`,
        sessions: sql<number>`COALESCE(SUM(${ga4DailyMetrics.sessions}), 0)`,
      })
      .from(ga4DailyMetrics)
      .where(
        and(
          eq(ga4DailyMetrics.propertyId, propertyId),
          gte(ga4DailyMetrics.date, startDate),
          lte(ga4DailyMetrics.date, endDate)
        )
      )
      .groupBy(sql`${ga4DailyMetrics.date}::date`)
      .orderBy(sql`${ga4DailyMetrics.date}::date`);

    const gscRows = await db
      .select({
        date: sql<string>`${gscDaily.date}::date::text`,
        clicks: sql<number>`COALESCE(SUM(${gscDaily.clicks}), 0)`,
        impressions: sql<number>`COALESCE(SUM(${gscDaily.impressions}), 0)`,
      })
      .from(gscDaily)
      .where(
        and(
          eq(gscDaily.propertyId, propertyId),
          gte(gscDaily.date, startDate),
          lte(gscDaily.date, endDate)
        )
      )
      .groupBy(sql`${gscDaily.date}::date`)
      .orderBy(sql`${gscDaily.date}::date`);

    return {
      ga4Daily: ga4Rows.map(r => ({ date: r.date, users: Number(r.users), sessions: Number(r.sessions) })),
      gscDaily: gscRows.map(r => ({ date: r.date, clicks: Number(r.clicks), impressions: Number(r.impressions) })),
    };
  }

  async getKeywordDistribution(propertyId: string, startDate: Date, endDate: Date) {
    const latestDate = await db
      .select({ maxDate: sql<Date>`MAX(${rankDaily.date})` })
      .from(rankDaily)
      .where(
        and(
          eq(rankDaily.propertyId, propertyId),
          gte(rankDaily.date, startDate),
          lte(rankDaily.date, endDate)
        )
      );

    const targetDate = latestDate[0]?.maxDate;
    if (!targetDate) {
      return { top3: 0, top10: 0, top20: 0, top50: 0, top100: 0, beyond: 0 };
    }

    const rows = await db
      .select({
        top3: sql<number>`COUNT(*) FILTER (WHERE ${rankDaily.position} <= 3)`,
        top10: sql<number>`COUNT(*) FILTER (WHERE ${rankDaily.position} BETWEEN 4 AND 10)`,
        top20: sql<number>`COUNT(*) FILTER (WHERE ${rankDaily.position} BETWEEN 11 AND 20)`,
        top50: sql<number>`COUNT(*) FILTER (WHERE ${rankDaily.position} BETWEEN 21 AND 50)`,
        top100: sql<number>`COUNT(*) FILTER (WHERE ${rankDaily.position} BETWEEN 51 AND 100)`,
        beyond: sql<number>`COUNT(*) FILTER (WHERE ${rankDaily.position} > 100)`,
      })
      .from(rankDaily)
      .where(
        and(
          eq(rankDaily.propertyId, propertyId),
          eq(rankDaily.date, targetDate)
        )
      );

    const r = rows[0];
    return {
      top3: Number(r?.top3 || 0),
      top10: Number(r?.top10 || 0),
      top20: Number(r?.top20 || 0),
      top50: Number(r?.top50 || 0),
      top100: Number(r?.top100 || 0),
      beyond: Number(r?.beyond || 0),
    };
  }

  async getGscTopPages(propertyId: string, startDate: Date, endDate: Date) {
    const rows = await db
      .select({
        page: gscDaily.page,
        clicks: sql<number>`COALESCE(SUM(${gscDaily.clicks}), 0)`,
        impressions: sql<number>`COALESCE(SUM(${gscDaily.impressions}), 0)`,
        ctr: sql<number>`CASE WHEN SUM(${gscDaily.impressions}) > 0 THEN ROUND((SUM(${gscDaily.clicks})::numeric / SUM(${gscDaily.impressions}) * 100), 2) ELSE 0 END`,
        position: sql<number>`ROUND(AVG(${gscDaily.avgPosition})::numeric, 1)`,
      })
      .from(gscDaily)
      .where(
        and(
          eq(gscDaily.propertyId, propertyId),
          gte(gscDaily.date, startDate),
          lte(gscDaily.date, endDate),
          sql`${gscDaily.page} IS NOT NULL AND ${gscDaily.page} != ''`
        )
      )
      .groupBy(gscDaily.page)
      .orderBy(sql`SUM(${gscDaily.impressions}) DESC`)
      .limit(10);

    return rows.map(r => ({
      page: r.page || "",
      clicks: Number(r.clicks),
      impressions: Number(r.impressions),
      ctr: Number(r.ctr),
      position: Number(r.position),
    }));
  }
}

export const storage = new DatabaseStorage();
