// Scratchpad DB helpers — the agent communication bus.
//
// Agents never call each other directly; they write findings to the
// agent_scratchpad table and downstream agents read them back. Every entry is
// tied to an agent_runs row via run_id so each claim is traceable.
//
// NOTE on weekNumber: the agent_scratchpad table (per CLAUDE.md "Database
// Schema") has no week_number column. We derive the week from created_at using
// Postgres EXTRACT(WEEK ...) / EXTRACT(ISOYEAR ...) (ISO-8601 week, matched
// against the current ISO year). If a different bucketing is needed, add a
// week_number column to the table and filter on it instead.

import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { agentScratchpad, type AgentScratchpad } from "@shared/schema";

/** Optional metadata stored alongside a scratchpad entry. */
export interface ScratchpadMeta {
  modelUsed?: string;
  tokensUsed?: number;
}

/**
 * Write an agent's findings to the scratchpad.
 *
 * Core signature is (agentId, tenantId, runId, findings); `meta` is an optional
 * trailing arg that populates the model_used / tokens_used columns.
 */
export async function writeToScratchpad(
  agentId: string,
  tenantId: string,
  runId: string | null,
  findings: Record<string, unknown>,
  meta?: ScratchpadMeta,
): Promise<AgentScratchpad> {
  const [row] = await db
    .insert(agentScratchpad)
    .values({
      agentId,
      tenantId,
      runId: runId ?? null,
      findings,
      modelUsed: meta?.modelUsed ?? null,
      tokensUsed: meta?.tokensUsed ?? null,
    })
    .returning();
  return row;
}

/**
 * Read one agent's scratchpad entries for a given ISO week (most recent first).
 */
export async function readFromScratchpad(
  agentId: string,
  tenantId: string,
  weekNumber: number,
): Promise<AgentScratchpad[]> {
  return await db
    .select()
    .from(agentScratchpad)
    .where(
      and(
        eq(agentScratchpad.agentId, agentId),
        eq(agentScratchpad.tenantId, tenantId),
        inIsoWeek(weekNumber),
      ),
    )
    .orderBy(desc(agentScratchpad.createdAt));
}

/**
 * Read every agent's scratchpad entries for a tenant in a given ISO week.
 * Used by synthesis / composition agents that aggregate across the whole run.
 */
export async function getAllScratchpadsForWeek(
  tenantId: string,
  weekNumber: number,
): Promise<AgentScratchpad[]> {
  return await db
    .select()
    .from(agentScratchpad)
    .where(and(eq(agentScratchpad.tenantId, tenantId), inIsoWeek(weekNumber)))
    .orderBy(desc(agentScratchpad.createdAt));
}

/** Matches rows whose created_at falls in the given ISO week of the current ISO year. */
function inIsoWeek(weekNumber: number): SQL {
  return sql`EXTRACT(WEEK FROM ${agentScratchpad.createdAt}) = ${weekNumber}
    AND EXTRACT(ISOYEAR FROM ${agentScratchpad.createdAt}) = EXTRACT(ISOYEAR FROM NOW())`;
}
