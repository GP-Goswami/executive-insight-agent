# Agent Layer — Progress & Handoff

> **Purpose of this file.** A self-contained summary of the AI-agent layer work
> done so far on the Executive Insight Agent project. Hand this to any model or
> developer to bring them up to speed without re-reading the whole codebase.
> Pair it with `CLAUDE.md` (master context) and `specs/` (per-agent specs).

_Last updated: 2026-05-21_

---

## TL;DR

The project is adding an AI-agent layer on top of the existing GA4 + GSC SEO
reporting app (React + Express + PostgreSQL + Drizzle ORM). Work so far laid the
**foundation**: the database tables the agents read/write, an abstract base class
all agents extend, and the scratchpad helpers agents use to communicate.

No agent business logic exists yet — the next step is implementing concrete
agents (A08 first) on top of this foundation.

**Hard rule throughout:** additive only. No existing tables, routes, types, or
data-pipeline files were modified. (See `CLAUDE.md` → "CRITICAL RULES".)

---

## What changed in this session

| # | File | Status | What |
|---|------|--------|------|
| 1 | `shared/schema.ts` | **modified (additive)** | Added 5 new tables + insert schemas + types; added `doublePrecision` to imports. No existing tables touched. |
| 2 | `server/agents/base-agent.ts` | **new** | Abstract `BaseAgent` class (run logging, token tracking, retry, scratchpad helper). |
| 3 | `server/orchestrator/scratchpad.ts` | **new** | `writeToScratchpad`, `readFromScratchpad`, `getAllScratchpadsForWeek`. |

> A raw SQL migration file (`server/db/migrations/0000_add_agent_tables.sql`) was
> created earlier, then **removed** — the project applies schema via
> `npm run db:push` from `shared/schema.ts`, not via generated migrations.
> `drizzle.config.ts` was deliberately left unchanged.

**Verification:** `npx tsc --noEmit` passes clean.

---

## 1. Database schema — 5 new tables

Defined in `shared/schema.ts` (Drizzle `pgTable` definitions, exact columns from
`CLAUDE.md` → "Database Schema"). Each table also exports the conventional
`insert<Name>Schema` (zod), `Insert<Name>` and `<Name>` types.

### `agent_runs` — one row per agent execution (traceability anchor)
| column | type | notes |
|---|---|---|
| id | varchar PK | `gen_random_uuid()` |
| tenant_id | varchar NOT NULL | |
| agent_id | text NOT NULL | e.g. `"A08"` |
| status | text NOT NULL | `pending` → `running` → `completed`/`failed` |
| started_at | timestamp | `defaultNow()` |
| completed_at | timestamp | |
| input_hash | text | for idempotency / dedupe |
| output | jsonb | |
| error | text | |
| tokens_in / tokens_out | integer | |

### `agent_scratchpad` — inter-agent communication bus
| column | type | notes |
|---|---|---|
| id | varchar PK | |
| tenant_id | varchar NOT NULL | |
| agent_id | text NOT NULL | |
| run_id | varchar | logically → `agent_runs.id` (no FK constraint) |
| findings | jsonb | the agent's structured output |
| created_at | timestamp | `defaultNow()` |
| model_used | text | |
| tokens_used | integer | |

### `recommendations` — A09 output
`id, tenant_id, run_id, priority (integer rank, 1=highest), statement, evidence (jsonb), effort, impact, owner_role, status (default "open"), analyst_edit`

### `anomalies` — A08 output (UI display)
`id, tenant_id, metric, severity, detected_at (defaultNow), value, baseline, delta, root_cause, status (default "open")`
- `value / baseline / delta` → **double precision** (metrics range from integer sessions to fractional CTR/% deltas).
- `severity` expects `P0 | P1 | P2`; `status` expects `open | acknowledged | resolved` (stored as plain `text`, not enums).

### `report_drafts` — A10 output
`id, tenant_id, report_type, week_number (integer), content (jsonb), pdf_url, status (default "draft"), analyst_notes, created_at, approved_at`

### Schema decisions (important)
- **`tenant_id` is a plain `varchar` with no foreign key** — there is no `tenants` table yet to reference.
- **`run_id` is unconstrained** (no FK) — kept faithful to the column-only spec and avoids insert-ordering coupling. It logically references `agent_runs.id`.
- **Statuses/severities are `text`**, not `pgEnum` — matches the many existing text status columns and keeps the spec's column-only shape.
- **`recommendations.priority` is `integer`** (rank). ⚠️ If categorical priority (`"P0"`/`"high"`) is intended, change to `text`.

### ⚠️ Action required
The tables are **defined** but not yet applied to the database. Run:
```bash
npm run db:push   # drizzle-kit push — creates the 5 tables, additive
```
When pushing, the plan should be **CREATE TABLE only**. Decline any prompt that
proposes renaming/altering an existing table.

---

## 2. `server/agents/base-agent.ts` — abstract base class

All agents (A01–A12) extend `BaseAgent`. Subclasses implement `run()`; the base
provides the cross-cutting machinery.

```ts
export interface AgentResult {
  agentId: string;
  runId: string;
  tenantId: string;
  status: "completed" | "failed";
  findings: Record<string, unknown> | null;
  tokensIn: number;
  tokensOut: number;
  model: string;
  error?: string;
}

export abstract class BaseAgent {
  abstract readonly agentId: string;   // e.g. "A08"
  abstract readonly model: string;     // per CLAUDE.md model routing, e.g. "gpt-4.1-nano"

  // Subclass implements this:
  abstract run(tenantId: string): Promise<AgentResult>;

  // Public entry point — wraps run() with logging + retry. Never throws.
  execute(tenantId: string): Promise<AgentResult>;

  // Built-in helpers available to subclasses (protected):
  protected trackTokens(input: number, output: number): void;
  protected writeScratchpad(findings: Record<string, unknown>): Promise<void>;
  protected result(findings: Record<string, unknown>): AgentResult;
  protected computeInputHash(tenantId: string): Promise<string | undefined>; // override to set agent_runs.input_hash
  protected sha256(data: unknown): string;
  // (internal: startRun / completeRun / failRun / withRetry / log / logError)
}
```

**What `execute()` does:**
1. Inserts an `agent_runs` row (`status: "running"`, optional `input_hash`).
2. Runs `this.run(tenantId)` under retry (**up to 3 retries**, exponential
   backoff via `p-retry`, `factor: 2`, 1s–15s).
3. On success → updates the run to `completed` with `output` + token totals.
4. On failure → updates to `failed` with `error` + token totals, and **returns**
   a `status: "failed"` `AgentResult` (does not throw).

**Token tracking:** call `this.trackTokens(inputTokens, outputTokens)` after each
model call; totals are persisted automatically to `agent_runs` and to the
scratchpad entry.

---

## 3. `server/orchestrator/scratchpad.ts` — communication helpers

```ts
// Write findings (meta optional → fills model_used / tokens_used columns)
writeToScratchpad(
  agentId: string,
  tenantId: string,
  runId: string | null,
  findings: Record<string, unknown>,
  meta?: { modelUsed?: string; tokensUsed?: number },
): Promise<AgentScratchpad>;

// Read one agent's entries for an ISO week (newest first)
readFromScratchpad(agentId: string, tenantId: string, weekNumber: number): Promise<AgentScratchpad[]>;

// Read every agent's entries for a tenant in an ISO week (for synthesis/composition)
getAllScratchpadsForWeek(tenantId: string, weekNumber: number): Promise<AgentScratchpad[]>;
```

### ⚠️ `weekNumber` is derived, not stored
`agent_scratchpad` has **no `week_number` column**. The read helpers filter
`created_at` using Postgres `EXTRACT(WEEK FROM ...)` matched against
`EXTRACT(ISOYEAR FROM NOW())` — i.e. **ISO-8601 week of the _current_ ISO year**.
If cross-year history or a fixed week bucket is needed, add a `week_number`
column to the table and filter on it instead.

---

## Agent communication pattern (how the pieces fit)

```
Agents never call each other directly. They communicate via the scratchpad:

  Agent.run()  --writeScratchpad-->  agent_scratchpad table
                                          |
  Next agent  <--readFromScratchpad-------+
  Orchestrator manages sequence + timing (server/orchestrator/, not built yet)

Every claim is traceable to a specific agent_runs.id  →  debuggable by design.
```

---

## Model routing (GPT — updated in CLAUDE.md)

The project switched from Claude to OpenAI/GPT models. Each agent sets its
`model` field per this table:

| Tier | Model | Agents |
|---|---|---|
| Routing / classify | `gpt-4.1-nano` | A01, A08 triage |
| Analysis | `gpt-4.1` | A02–A07, A11, A12 |
| Strategy | `gpt-4.1` | A09, A10 (upgrade to `gpt-5.5` when available) |
| Reasoning | `o3` | A08 P0/P1 root-cause only |

**OpenAI client pattern** used elsewhere in the repo (reuse this in concrete agents):
```ts
import OpenAI from "openai";
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});
```

---

## How to write a new agent (example: A08)

```ts
// server/agents/anomaly-detection.ts
import { BaseAgent, type AgentResult } from "./base-agent";

export class AnomalyDetectionAgent extends BaseAgent {
  readonly agentId = "A08";
  readonly model = "gpt-4.1-nano";          // routing/classify tier

  async run(tenantId: string): Promise<AgentResult> {
    // 1. read existing GA4+GSC time-series (via /api/report-data or storage)
    // 2. statistical detection (z-score / WoW delta / EWMA) — see specs/A08
    // 3. for P0/P1, call model for root cause; this.trackTokens(in, out)
    const findings = { anomalies: [], summary: "", metrics_checked: 0, anomalies_found: 0 };
    await this.writeScratchpad(findings);   // also writes to anomalies table in the agent
    return this.result(findings);
  }
}

// run it:  await new AnomalyDetectionAgent().execute(tenantId);
```

---

## Pending / next steps

- [ ] **Run `npm run db:push`** to create the 5 tables (not yet applied).
- [ ] Decide `recommendations.priority` type (integer rank vs text category).
- [ ] Implement **A08 Anomaly Detection** agent (`server/agents/anomaly-detection.ts`) — spec in `specs/A08-anomaly-detection.md`.
- [ ] Build orchestrator pieces: `server/orchestrator/scheduler.ts` (node-cron), `supervisor.ts` (run manager).
- [ ] Add API routes under `server/routes/agents/` (anomalies, recommendations, runs) — additive, existing routes untouched.
- [ ] Add UI components under `client/src/components/agents/` (e.g. `AnomalyCard.tsx`).
- [ ] Decide whether scratchpad week filtering needs a real `week_number` column.

---

## Conventions to follow (so new code matches the repo)

- **DB access:** `import { db } from "../db"` (or `./db`), schema from `@shared/schema`, operators from `drizzle-orm` (`eq, and, gte, lte, desc, sql`).
- **Drizzle ops:** `.insert(t).values({...}).returning()`, `.update(t).set({...}).where(eq(...))`, `.select().from(t).where(and(...)).orderBy(desc(...))`.
- **Retry:** `p-retry` (`pRetry`, `AbortError`) — already a dependency.
- **Logging:** `console.log` / `console.error`, tagged (base agent uses `[agent:<id>]`).
- **Additive only:** new agents → `server/agents/`, new routes → `server/routes/agents/`, new components → `client/src/components/agents/`, new tables → `shared/schema.ts`. Never modify `report-preview.tsx`, `pdf-generator.ts`, GA4/GSC/OAuth files.
