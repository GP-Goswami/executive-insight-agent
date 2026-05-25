// A08 — Anomaly Detection Agent.
// Spec: specs/A08-anomaly-detection.md
//
// Reads EXISTING GA4 + GSC daily data from the database (never re-fetches from
// the Google APIs), runs statistical detection (rolling z-score + week-over-week
// delta), classifies severity (P0/P1/P2), asks a model for root cause on P0/P1,
// and writes results to BOTH the anomalies table (UI) and agent_scratchpad
// (agent bus). Run logging, token tracking and retry come from BaseAgent.
//
// Models (per CLAUDE.md "Model Routing", overridable via env so the same code
// works whether AI_INTEGRATIONS_OPENAI_BASE_URL points at OpenAI or a gateway
// that proxies Claude):
//   classify  → A08_CLASSIFY_MODEL   (default gpt-4.1-nano)
//   root cause→ A08_ROOTCAUSE_MODEL  (default o3)

import OpenAI from "openai";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { ga4DailyMetrics, gscDaily, anomalies, properties, type InsertAnomaly } from "@shared/schema";
import { BaseAgent, type AgentResult } from "./base-agent";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const CLASSIFY_MODEL = process.env.A08_CLASSIFY_MODEL || "gpt-4.1-nano";
const ROOTCAUSE_MODEL = process.env.A08_ROOTCAUSE_MODEL || "o3";

// Detection tuning (from spec).
const LOOKBACK_DAYS = 60; // ~8 weeks of history (z-score window + WoW + context)
const ZSCORE_WINDOW = 14; // preferred z-score window (shrinks for short series)
const ZSCORE_THRESHOLD = 2.5;
const WOW_THRESHOLD_PCT = 20; // |WoW change| > 20% is notable
// Stored GA4/GSC history is often sparse (only a handful of distinct days), so
// require a modest minimum and adapt the windows below rather than demanding a
// full 14 days that real data may not have.
const MIN_DAYS = 8;

type Severity = "P0" | "P1" | "P2";

interface TimeSeriesPoint {
  date: string;
  value: number;
}

interface AnomalyResult {
  metric: string;
  severity: Severity;
  detected_at: string;
  value: number; // current (7-day avg)
  baseline: number; // expected (previous 7-day avg)
  delta: number; // % change vs baseline
  root_cause: string;
  status: "open" | "acknowledged" | "resolved";
  method: string; // which detector(s) fired
}

// Per-metric config. `unit: "places"` (avg position) is scored by absolute
// movement; everything else is scored by percentage drop.
interface MetricConfig {
  key: string;
  label: string;
  source: "ga4" | "gsc";
  field: string; // key into the per-day aggregate row
  unit?: "places";
  p0: number;
  p1: number;
  p2: number;
}

const METRICS: MetricConfig[] = [
  { key: "organic_sessions", label: "Organic Sessions", source: "ga4", field: "sessions", p0: 30, p1: 15, p2: 10 },
  { key: "users", label: "Users", source: "ga4", field: "users", p0: 30, p1: 15, p2: 10 },
  { key: "conversions", label: "Conversions", source: "ga4", field: "conversions", p0: 25, p1: 15, p2: 10 },
  { key: "engaged_sessions", label: "Engaged Sessions", source: "ga4", field: "engagedSessions", p0: 30, p1: 15, p2: 10 },
  { key: "clicks", label: "Clicks", source: "gsc", field: "clicks", p0: 40, p1: 20, p2: 10 },
  { key: "impressions", label: "Impressions", source: "gsc", field: "impressions", p0: 40, p1: 20, p2: 10 },
  { key: "ctr", label: "CTR", source: "gsc", field: "ctr", p0: 40, p1: 20, p2: 10 },
  { key: "avg_position", label: "Avg Position", source: "gsc", field: "avgPosition", unit: "places", p0: 10, p1: 5, p2: 2 },
];

export class AnomalyDetectionAgent extends BaseAgent {
  readonly agentId = "A08";
  readonly model = CLASSIFY_MODEL;

  /** Stable per-day input hash so reruns on the same day are identifiable. */
  protected async computeInputHash(tenantId: string): Promise<string | undefined> {
    return this.sha256({ tenantId, day: new Date().toISOString().slice(0, 10) });
  }

  async run(tenantId: string): Promise<AgentResult> {
    // The GA4/GSC daily tables are keyed by the internal property UUID, NOT by
    // the GA4 property id or an arbitrary tenant id. Resolve whatever was passed
    // (internal id → GA4 property id → richest property) to that UUID first,
    // mirroring how /api/report-data maps its `propertyId` param.
    const resolved = await this.resolvePropertyId(tenantId);
    if (!resolved) {
      this.log(`no property/data found for tenantId "${tenantId}"`);
      const empty: Record<string, unknown> = {
        anomalies: [],
        summary: `No property or GA4/GSC data found for tenant "${tenantId}".`,
        metrics_checked: 0,
        anomalies_found: 0,
      };
      await this.writeScratchpad(empty);
      return this.result(empty);
    }
    this.log(`tenant "${tenantId}" → property ${resolved.propertyId} (${resolved.via})`);
    const series = await this.loadSeries(resolved.propertyId);

    const results: AnomalyResult[] = [];
    let metricsChecked = 0;

    for (const cfg of METRICS) {
      const points = series[cfg.key] ?? [];
      if (points.length < MIN_DAYS) continue; // not enough history to compare
      metricsChecked++;
      const detected = detectAnomaly(cfg, points);
      if (detected) results.push(detected);
    }

    // Root cause: model explanation for P0/P1, deterministic fallback otherwise.
    for (const r of results) {
      if (r.severity === "P0" || r.severity === "P1") {
        r.root_cause = await this.explainRootCause(r, (series[r.metric] ?? []).slice(-30));
      } else {
        r.root_cause = fallbackRootCause(r);
      }
    }

    const summary = await this.summarize(results, metricsChecked);

    await this.persistAnomalies(tenantId, results);

    const findings: Record<string, unknown> = {
      anomalies: results,
      summary,
      metrics_checked: metricsChecked,
      anomalies_found: results.length,
    };
    await this.writeScratchpad(findings);

    this.log(`checked ${metricsChecked} metrics, found ${results.length} anomalies`);
    return this.result(findings);
  }

  /**
   * Resolve whatever identifier was passed to the internal property UUID that
   * the daily metric tables are keyed by. Tries, in order: an exact internal id,
   * the GA4 property id (the value /api/report-data receives), then a fallback
   * to the property that actually holds the most GA4 daily data (so placeholder
   * tenant ids like "1" still run against real data).
   */
  private async resolvePropertyId(tenantId: string): Promise<{ propertyId: string; via: string } | null> {
    const [direct] = await db.select({ id: properties.id }).from(properties).where(eq(properties.id, tenantId)).limit(1);
    if (direct) return { propertyId: direct.id, via: "internal property id" };

    const [byGa4] = await db
      .select({ id: properties.id })
      .from(properties)
      .where(eq(properties.ga4PropertyId, tenantId))
      .limit(1);
    if (byGa4) return { propertyId: byGa4.id, via: "GA4 property id" };

    const [richest] = await db
      .select({ propertyId: ga4DailyMetrics.propertyId, n: sql<number>`COUNT(*)` })
      .from(ga4DailyMetrics)
      .groupBy(ga4DailyMetrics.propertyId)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(1);
    if (richest?.propertyId) return { propertyId: richest.propertyId, via: "fallback: property with most GA4 data" };

    return null;
  }

  /**
   * Load per-day aggregated series for every metric from the existing tables.
   * No now-relative date filter: stored data can lag (and gsc_daily may be
   * empty), so we read all per-day rows for the property and keep the most
   * recent LOOKBACK_DAYS days that actually exist.
   */
  private async loadSeries(propertyId: string): Promise<Record<string, TimeSeriesPoint[]>> {
    const ga4Rows = await db
      .select({
        date: sql<string>`${ga4DailyMetrics.date}::date::text`,
        sessions: sql<number>`COALESCE(SUM(${ga4DailyMetrics.sessions}), 0)`,
        users: sql<number>`COALESCE(SUM(${ga4DailyMetrics.totalUsers}), 0)`,
        conversions: sql<number>`COALESCE(SUM(${ga4DailyMetrics.conversions}), 0)`,
        engagedSessions: sql<number>`COALESCE(SUM(${ga4DailyMetrics.engagedSessions}), 0)`,
      })
      .from(ga4DailyMetrics)
      .where(eq(ga4DailyMetrics.propertyId, propertyId))
      .groupBy(sql`${ga4DailyMetrics.date}::date`)
      .orderBy(sql`${ga4DailyMetrics.date}::date`);

    const gscRows = await db
      .select({
        date: sql<string>`${gscDaily.date}::date::text`,
        clicks: sql<number>`COALESCE(SUM(${gscDaily.clicks}), 0)`,
        impressions: sql<number>`COALESCE(SUM(${gscDaily.impressions}), 0)`,
        ctr: sql<number>`CASE WHEN SUM(${gscDaily.impressions}) > 0 THEN SUM(${gscDaily.clicks})::numeric / SUM(${gscDaily.impressions}) * 100 ELSE 0 END`,
        avgPosition: sql<number>`COALESCE(AVG(${gscDaily.avgPosition}), 0)`,
      })
      .from(gscDaily)
      .where(eq(gscDaily.propertyId, propertyId))
      .groupBy(sql`${gscDaily.date}::date`)
      .orderBy(sql`${gscDaily.date}::date`);

    this.log(`loaded ${ga4Rows.length} GA4 days, ${gscRows.length} GSC days for property ${propertyId}`);
    if (gscRows.length === 0) {
      this.log("gsc_daily has no rows for this property — GSC daily metrics will be skipped (this table is not populated by the existing pipeline)");
    }

    const series: Record<string, TimeSeriesPoint[]> = {};
    for (const cfg of METRICS) {
      const rows = cfg.source === "ga4" ? ga4Rows : gscRows;
      series[cfg.key] = rows
        .map((row) => ({
          date: row.date,
          value: Number((row as Record<string, unknown>)[cfg.field] ?? 0),
        }))
        .slice(-LOOKBACK_DAYS);
    }
    return series;
  }

  /** Insert detected anomalies into the anomalies table (open). */
  private async persistAnomalies(tenantId: string, results: AnomalyResult[]): Promise<void> {
    if (results.length === 0) return;
    const rows: InsertAnomaly[] = results.map((r) => ({
      tenantId,
      metric: r.metric,
      severity: r.severity,
      value: r.value,
      baseline: r.baseline,
      delta: r.delta,
      rootCause: r.root_cause,
      status: "open",
    }));
    await db.insert(anomalies).values(rows);
  }

  /** Stage 2 — model-generated root cause for P0/P1 anomalies. */
  private async explainRootCause(r: AnomalyResult, last30: TimeSeriesPoint[]): Promise<string> {
    const system =
      "You are an SEO anomaly analyst. Classify the most likely root cause " +
      "(algorithm update, technical issue, seasonal pattern, competitor action, " +
      "or content change) and explain in 2-3 concise sentences. Be specific, no hedging.";
    const user =
      `Metric "${r.metric}" showed an anomaly. Current=${r.value}, baseline=${r.baseline}, ` +
      `change=${r.delta}%, severity=${r.severity}, detector=${r.method}.\n` +
      `Historical context (last 30 days): ${JSON.stringify(last30)}\n` +
      `Classify the root cause and explain in 2-3 sentences.`;
    try {
      const text = await this.chat(ROOTCAUSE_MODEL, system, user);
      return text || fallbackRootCause(r);
    } catch (err) {
      this.logError(`root-cause model failed for ${r.metric}: ${err instanceof Error ? err.message : String(err)}`);
      return fallbackRootCause(r);
    }
  }

  /** Short triage summary across all anomalies (cheap model). */
  private async summarize(results: AnomalyResult[], metricsChecked: number): Promise<string> {
    if (results.length === 0) {
      return `No anomalies detected across ${metricsChecked} metrics.`;
    }
    const system = "You are an SEO anomaly triage assistant. Summarize the findings in 1-2 plain sentences for an analyst.";
    const user =
      `Checked ${metricsChecked} metrics and found ${results.length} anomalies: ` +
      JSON.stringify(results.map((r) => ({ metric: r.metric, severity: r.severity, delta: r.delta }))) +
      `\nWrite a 1-2 sentence summary, leading with the most severe.`;
    try {
      const text = await this.chat(CLASSIFY_MODEL, system, user, { temperature: 0.2, maxTokens: 200 });
      return text || defaultSummary(results, metricsChecked);
    } catch (err) {
      this.logError(`summary model failed: ${err instanceof Error ? err.message : String(err)}`);
      return defaultSummary(results, metricsChecked);
    }
  }

  /**
   * Single chat call. Token usage is tracked on the run. Reasoning models (o3)
   * reject custom temperature / max_tokens, so those are only sent when opts
   * are provided (we omit them for the default root-cause model).
   */
  private async chat(
    model: string,
    system: string,
    user: string,
    opts?: { temperature?: number; maxTokens?: number },
  ): Promise<string> {
    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    };
    if (opts?.temperature !== undefined) params.temperature = opts.temperature;
    if (opts?.maxTokens !== undefined) params.max_completion_tokens = opts.maxTokens;

    const resp = await openai.chat.completions.create(params);
    this.trackTokens(resp.usage?.prompt_tokens ?? 0, resp.usage?.completion_tokens ?? 0);
    return resp.choices[0]?.message?.content?.trim() ?? "";
  }
}

/** Convenience entry for routes / cron: runs with full logging + retry. */
export function runAnomalyDetection(tenantId: string): Promise<AgentResult> {
  return new AnomalyDetectionAgent().execute(tenantId);
}

// ── Pure detection helpers (no IO — easy to reason about / test) ──────────────

function detectAnomaly(cfg: MetricConfig, points: TimeSeriesPoint[]): AnomalyResult | null {
  const values = points.map((p) => p.value);
  const n = values.length;

  // Week-over-week: most recent half-window vs the half-window before it.
  // Uses 7+7 when enough data exists, otherwise shrinks to fit short series.
  const w = Math.min(7, Math.floor(n / 2));
  const current = mean(values.slice(n - w));
  const prev = mean(values.slice(n - 2 * w, n - w));
  const deltaPct = prev !== 0 ? ((current - prev) / prev) * 100 : 0;
  const placesDelta = current - prev; // for avg position (lower is better)

  // Rolling z-score on the latest day vs the trailing window before it.
  const zWindow = Math.min(ZSCORE_WINDOW, n - 1);
  const window = values.slice(n - 1 - zWindow, n - 1);
  const m = mean(window);
  const sd = stddev(window, m);
  const latest = values[n - 1];
  const z = sd > 0 ? (latest - m) / sd : 0;
  const zFlag = Math.abs(z) > ZSCORE_THRESHOLD;

  const severity = classifySeverity(cfg, deltaPct, placesDelta);
  const wowFlag = Math.abs(deltaPct) > WOW_THRESHOLD_PCT;

  if (!severity && !zFlag) return null; // nothing notable

  const methods: string[] = [];
  if (wowFlag || severity) methods.push(`wow ${deltaPct >= 0 ? "+" : ""}${round(deltaPct)}%`);
  if (zFlag) methods.push(`z=${round(z)}`);

  return {
    metric: cfg.key,
    severity: severity ?? "P2", // z-score fired but below drop thresholds → informational
    detected_at: new Date().toISOString(),
    value: round(current),
    baseline: round(prev),
    delta: round(deltaPct),
    root_cause: "", // filled in later
    status: "open",
    method: methods.join(", ") || "threshold",
  };
}

/** Returns severity if the movement is in the harmful direction, else null. */
function classifySeverity(cfg: MetricConfig, deltaPct: number, placesDelta: number): Severity | null {
  if (cfg.unit === "places") {
    // Avg position: a rise (positive movement) is worse.
    const rise = placesDelta;
    if (rise >= cfg.p0) return "P0";
    if (rise >= cfg.p1) return "P1";
    if (rise >= cfg.p2) return "P2";
    return null;
  }
  // Count/rate metrics: a drop (negative deltaPct) is worse.
  const dropPct = -deltaPct;
  if (dropPct >= cfg.p0) return "P0";
  if (dropPct >= cfg.p1) return "P1";
  if (dropPct >= cfg.p2) return "P2";
  return null;
}

function fallbackRootCause(r: AnomalyResult): string {
  return (
    `Automated detection flagged ${r.metric.replace(/_/g, " ")} (${r.severity}) at a ${r.delta}% ` +
    `change vs the 7-day baseline (${r.method}). Manual review recommended.`
  );
}

function defaultSummary(results: AnomalyResult[], metricsChecked: number): string {
  const counts = { P0: 0, P1: 0, P2: 0 } as Record<Severity, number>;
  for (const r of results) counts[r.severity]++;
  return `Detected ${results.length} anomalies across ${metricsChecked} metrics (P0:${counts.P0}, P1:${counts.P1}, P2:${counts.P2}).`;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function stddev(arr: number[], m: number): number {
  if (arr.length === 0) return 0;
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length);
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}
