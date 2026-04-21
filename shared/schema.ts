import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, decimal, jsonb, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Re-export auth models
export * from "./models/auth";

// Enums
export const userRoleEnum = pgEnum("user_role", ["ADMIN", "INTERNAL", "CLIENT"]);
export const syncStatusEnum = pgEnum("sync_status", ["ok", "stale", "failed", "pending"]);
export const deviceCategoryEnum = pgEnum("device_category", ["desktop", "mobile", "tablet"]);

// Clients table
export const clients = pgTable("clients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const clientsRelations = relations(clients, ({ many }) => ({
  properties: many(properties),
}));

export const insertClientSchema = createInsertSchema(clients).omit({ id: true, createdAt: true });
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clients.$inferSelect;

// Properties table
export const properties = pgTable("properties", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().references(() => clients.id),
  name: text("name").notNull(),
  ga4PropertyId: text("ga4_property_id"),
  gscSiteUrl: text("gsc_site_url"),
  semrushProjectId: text("semrush_project_id"),
  timezone: text("timezone").default("UTC"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const propertiesRelations = relations(properties, ({ one }) => ({
  client: one(clients, {
    fields: [properties.clientId],
    references: [clients.id],
  }),
}));

export const insertPropertySchema = createInsertSchema(properties).omit({ id: true, createdAt: true });
export type InsertProperty = z.infer<typeof insertPropertySchema>;
export type Property = typeof properties.$inferSelect;

// GA4 Daily Metrics
export const ga4DailyMetrics = pgTable("ga4_daily_metrics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: timestamp("date").notNull(),
  propertyId: varchar("property_id").notNull().references(() => properties.id),
  totalUsers: integer("total_users").default(0),
  sessions: integer("sessions").default(0),
  engagedSessions: integer("engaged_sessions").default(0),
  conversions: integer("conversions").default(0),
  source: text("source"),
  medium: text("medium"),
  deviceCategory: text("device_category"),
  country: text("country"),
  landingPagePath: text("landing_page_path"),
}, (table) => [
  index("ga4_date_property_idx").on(table.date, table.propertyId),
]);

export const insertGa4MetricsSchema = createInsertSchema(ga4DailyMetrics).omit({ id: true });
export type InsertGa4Metrics = z.infer<typeof insertGa4MetricsSchema>;
export type Ga4Metrics = typeof ga4DailyMetrics.$inferSelect;

// GSC Daily Metrics
export const gscDaily = pgTable("gsc_daily", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: timestamp("date").notNull(),
  propertyId: varchar("property_id").notNull().references(() => properties.id),
  clicks: integer("clicks").default(0),
  impressions: integer("impressions").default(0),
  ctr: decimal("ctr", { precision: 5, scale: 4 }).default("0"),
  avgPosition: decimal("avg_position", { precision: 5, scale: 2 }).default("0"),
  query: text("query"),
  page: text("page"),
  country: text("country"),
  device: text("device"),
}, (table) => [
  index("gsc_date_property_idx").on(table.date, table.propertyId),
]);

export const insertGscSchema = createInsertSchema(gscDaily).omit({ id: true });
export type InsertGscMetrics = z.infer<typeof insertGscSchema>;
export type GscMetrics = typeof gscDaily.$inferSelect;

// Rankings Daily
export const rankDaily = pgTable("rank_daily", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: timestamp("date").notNull(),
  propertyId: varchar("property_id").notNull().references(() => properties.id),
  keyword: text("keyword").notNull(),
  location: text("location"),
  device: text("device"),
  position: integer("position"),
  url: text("url"),
}, (table) => [
  index("rank_date_property_idx").on(table.date, table.propertyId),
]);

export const insertRankSchema = createInsertSchema(rankDaily).omit({ id: true });
export type InsertRankMetrics = z.infer<typeof insertRankSchema>;
export type RankMetrics = typeof rankDaily.$inferSelect;

// Backlinks Daily
export const backlinksDaily = pgTable("backlinks_daily", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: timestamp("date").notNull(),
  propertyId: varchar("property_id").notNull().references(() => properties.id),
  totalBacklinks: integer("total_backlinks").default(0),
  referringDomains: integer("referring_domains").default(0),
  newLinks: integer("new_links").default(0),
  lostLinks: integer("lost_links").default(0),
  toxicScore: integer("toxic_score"),
}, (table) => [
  index("backlinks_date_property_idx").on(table.date, table.propertyId),
]);

export const insertBacklinksSchema = createInsertSchema(backlinksDaily).omit({ id: true });
export type InsertBacklinksMetrics = z.infer<typeof insertBacklinksSchema>;
export type BacklinksMetrics = typeof backlinksDaily.$inferSelect;

// AI Referrer Daily
export const aiReferrerDaily = pgTable("ai_referrer_daily", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: timestamp("date").notNull(),
  propertyId: varchar("property_id").notNull().references(() => properties.id),
  aiSource: text("ai_source").notNull(),
  totalUsers: integer("total_users").default(0),
  sessions: integer("sessions").default(0),
  topLandingPagesJson: jsonb("top_landing_pages_json"),
  deviceCategory: text("device_category"),
}, (table) => [
  index("ai_referrer_date_property_idx").on(table.date, table.propertyId),
]);

export const insertAiReferrerSchema = createInsertSchema(aiReferrerDaily).omit({ id: true });
export type InsertAiReferrerMetrics = z.infer<typeof insertAiReferrerSchema>;
export type AiReferrerMetrics = typeof aiReferrerDaily.$inferSelect;

// AI Sources Dictionary
export const aiSources = pgTable("ai_sources", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  domain: text("domain").notNull().unique(),
  isActive: integer("is_active").default(1),
});

export const insertAiSourceSchema = createInsertSchema(aiSources).omit({ id: true });
export type InsertAiSource = z.infer<typeof insertAiSourceSchema>;
export type AiSource = typeof aiSources.$inferSelect;

// Sync Runs
export const syncRuns = pgTable("sync_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  provider: text("provider").notNull(),
  propertyId: varchar("property_id").references(() => properties.id),
  startedAt: timestamp("started_at").defaultNow(),
  endedAt: timestamp("ended_at"),
  status: text("status").default("pending"),
  rowsWritten: integer("rows_written").default(0),
  errorMessage: text("error_message"),
});

export const insertSyncRunSchema = createInsertSchema(syncRuns).omit({ id: true });
export type InsertSyncRun = z.infer<typeof insertSyncRunSchema>;
export type SyncRun = typeof syncRuns.$inferSelect;

// KPI Summary (derived)
export const kpiDailySummary = pgTable("kpi_daily_summary", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: timestamp("date").notNull(),
  propertyId: varchar("property_id").notNull().references(() => properties.id),
  totalUsers: integer("total_users").default(0),
  sessions: integer("sessions").default(0),
  conversions: integer("conversions").default(0),
  clicks: integer("clicks").default(0),
  avgPosition: decimal("avg_position", { precision: 5, scale: 2 }),
  totalBacklinks: integer("total_backlinks").default(0),
  aiUsers: integer("ai_users").default(0),
  trafficDelta: decimal("traffic_delta", { precision: 5, scale: 2 }),
  rankingDelta: decimal("ranking_delta", { precision: 5, scale: 2 }),
  backlinkDelta: decimal("backlink_delta", { precision: 5, scale: 2 }),
  conversionDelta: decimal("conversion_delta", { precision: 5, scale: 2 }),
});

export const insertKpiSummarySchema = createInsertSchema(kpiDailySummary).omit({ id: true });
export type InsertKpiSummary = z.infer<typeof insertKpiSummarySchema>;
export type KpiSummary = typeof kpiDailySummary.$inferSelect;

// Share Links
export const shareLinks = pgTable("share_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  token: text("token").notNull().unique(),
  propertyId: varchar("property_id").notNull().references(() => properties.id),
  createdBy: varchar("created_by"),
  filters: jsonb("filters"),
  dateRange: jsonb("date_range"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertShareLinkSchema = createInsertSchema(shareLinks).omit({ id: true, createdAt: true });
export type InsertShareLink = z.infer<typeof insertShareLinkSchema>;
export type ShareLink = typeof shareLinks.$inferSelect;

// AI Mentions - Prompt Sets
export const aiPromptSets = pgTable("ai_prompt_sets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").references(() => clients.id),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAiPromptSetSchema = createInsertSchema(aiPromptSets).omit({ id: true, createdAt: true });
export type InsertAiPromptSet = z.infer<typeof insertAiPromptSetSchema>;
export type AiPromptSet = typeof aiPromptSets.$inferSelect;

// AI Mentions - Prompts
export const aiPrompts = pgTable("ai_prompts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  promptSetId: varchar("prompt_set_id").notNull().references(() => aiPromptSets.id),
  promptText: text("prompt_text").notNull(),
  geo: text("geo").default("US"),
  language: text("language").default("en"),
  category: text("category"),
  priority: integer("priority").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAiPromptSchema = createInsertSchema(aiPrompts).omit({ id: true, createdAt: true });
export type InsertAiPrompt = z.infer<typeof insertAiPromptSchema>;
export type AiPrompt = typeof aiPrompts.$inferSelect;

// AI Mentions - Brand Entities
export const aiBrandEntities = pgTable("ai_brand_entities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").references(() => clients.id),
  brandName: text("brand_name").notNull(),
  domainsJson: jsonb("domains_json").$type<string[]>(),
  synonymsJson: jsonb("synonyms_json").$type<string[]>(),
  competitorsJson: jsonb("competitors_json").$type<string[]>(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAiBrandEntitySchema = createInsertSchema(aiBrandEntities).omit({ id: true, createdAt: true });
export type InsertAiBrandEntity = z.infer<typeof insertAiBrandEntitySchema>;
export type AiBrandEntity = typeof aiBrandEntities.$inferSelect;

// AI Mentions - Prompt Runs
export const aiPromptRunStatusEnum = pgEnum("ai_prompt_run_status", ["pending", "running", "completed", "failed"]);

export const aiPromptRuns = pgTable("ai_prompt_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  promptId: varchar("prompt_id").notNull().references(() => aiPrompts.id),
  model: text("model").notNull().default("gpt-4o"),
  runAt: timestamp("run_at").defaultNow(),
  status: text("status").default("pending"),
  latencyMs: integer("latency_ms"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  costEstimate: decimal("cost_estimate", { precision: 10, scale: 6 }),
  responseText: text("response_text"),
  errorMessage: text("error_message"),
});

export const insertAiPromptRunSchema = createInsertSchema(aiPromptRuns).omit({ id: true, runAt: true });
export type InsertAiPromptRun = z.infer<typeof insertAiPromptRunSchema>;
export type AiPromptRun = typeof aiPromptRuns.$inferSelect;

// AI Mentions - Mention Analysis Results
export const aiMentions = pgTable("ai_mentions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id").notNull().references(() => aiPromptRuns.id),
  mentionFound: integer("mention_found").default(0),
  mentionCount: integer("mention_count").default(0),
  mentionPosition: text("mention_position"),
  contextSnippet: text("context_snippet"),
  competitorFoundJson: jsonb("competitor_found_json").$type<string[]>(),
  sentiment: text("sentiment"),
  recommendationFlag: integer("recommendation_flag").default(0),
  mentionScore: integer("mention_score").default(0),
});

export const insertAiMentionSchema = createInsertSchema(aiMentions).omit({ id: true });
export type InsertAiMention = z.infer<typeof insertAiMentionSchema>;
export type AiMention = typeof aiMentions.$inferSelect;

// ─── API CACHING TABLES ───────────────────────────────────────────────────────
// These tables store raw API responses so external APIs are only called once
// per identifier+endpoint combination. Data expires after 24 hours by default.

export const ga4Data = pgTable("ga4_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  propertyId: varchar("property_id").notNull(),
  endpoint: text("endpoint").notNull(),
  dataJson: jsonb("data_json").notNull(),
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
}, (t) => [index("ga4_cache_idx").on(t.propertyId, t.endpoint)]);

export const gscData = pgTable("gsc_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  siteUrl: varchar("site_url").notNull(),
  endpoint: text("endpoint").notNull(),
  dataJson: jsonb("data_json").notNull(),
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
}, (t) => [index("gsc_cache_idx").on(t.siteUrl, t.endpoint)]);

export const semrushData = pgTable("semrush_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  domain: varchar("domain").notNull(),
  endpoint: text("endpoint").notNull(),
  dataJson: jsonb("data_json").notNull(),
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
}, (t) => [index("semrush_cache_idx").on(t.domain, t.endpoint)]);

export const backlinkData = pgTable("backlink_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  domain: varchar("domain").notNull(),
  endpoint: text("endpoint").notNull(),
  dataJson: jsonb("data_json").notNull(),
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
}, (t) => [index("backlink_cache_idx").on(t.domain, t.endpoint)]);

// Chat Integrations
export const conversations = pgTable("conversations", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const messages = pgTable("messages", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  conversationId: integer("conversation_id").notNull().references(() => conversations.id),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});
