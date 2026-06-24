# CLAUDE.md — Executive Insight Agent + TopLine Agentic SEO
# Master context file — Claude Code reads this automatically every session

---

## 🔴 CRITICAL RULES — READ FIRST

1. **NEVER modify these files:**
   - `client/src/pages/dashboard/report-preview.tsx`
     (only if asked explicitly for that file)
   - `server/lib/pdf-generator.ts`
     (only if asked explicitly for that file)
   - Any existing GA4 / GSC API integration files
   - Any existing OAuth / auth files
   - Any `.env` files

2. **NEVER change:**
   - Existing data pipeline (GA4 + GSC fetch logic)
   - Existing PostgreSQL schema (add new tables only)
   - Existing API routes (add new routes only)
   - Existing TypeScript types (extend only, never remove)

3. **ALL new AI features go in NEW files:**
   - New agents → `server/agents/`
   - New API routes → `server/routes/agents/`
   - New React components → `client/src/components/agents/`
   - New DB tables → `server/db/migrations/` (additive only)

4. **Computed metrics rule:**
   - PDF generator ALWAYS receives pre-computed values
     from frontend via `computedMetrics` in download payload
   - NEVER recompute independently in PDF generator
   - This prevents dashboard ↔ PDF data mismatches

---

## 📁 Project Stack

```
Frontend:  React 18 + Vite + TypeScript
Backend:   Express + TypeScript
Database:  PostgreSQL + Drizzle ORM
Auth:      Google OAuth via Passport.js
Dev:       ngrok for local testing
IDE:       VS Code
```

---

## 📊 Current Data Sources (DO NOT TOUCH)

```
GA4  → Sessions, users, engagement, conversions, channel attribution
GSC  → Clicks, impressions, CTR, queries, indexation
Auth → Google OAuth service account (already configured)
```

**Data flow (existing — never change):**
```
GA4 API + GSC API
    ↓
server/lib/ (existing fetch functions)
    ↓
/api/report-data (existing endpoint)
    ↓
report-preview.tsx (existing frontend)
```

---

## 🤖 AI Features to Build — From PDF Spec AA-SEO-PPS-2026-002

Reference document: `AA-SEO-PPS-2026-002_TopLine_Agentic_SEO_AEO_OpenAI_removed.pdf`

### Features Already Built ✅
- Data Health Score
- Executive Verdict
- KPI Snapshot
- Site Health Score (5-pillar)
- Root Cause Analysis
- Brand vs Non-Brand Split
- CTR Opportunity Engine
- AI Search Visibility / AEO (placeholder)
- Competitive Share of Voice (stub — SEMrush ready)
- Forecast & Growth Projection
- 4-page PDF restructure

### Features To Build 🔲

#### PHASE 1 — Core AI Agents (High Priority)
```
[ ] A08 — Anomaly Detection Agent
    Spec: server/agents/anomaly-detection.ts
    Model: Claude Haiku (fast, cheap)
    Input: Existing GA4+GSC time-series data
    Output: Anomaly objects → scratchpad table
    Triggers: Daily cron job

[ ] A09 — Recommendation Synthesis Agent  
    Spec: server/agents/recommendation-synthesis.ts
    Model: Claude Opus (highest quality)
    Input: Scratchpad table + tenant goals
    Output: 3-7 prioritised recommendations
    Triggers: After all analysis agents complete

[ ] A02 — Keyword Intelligence Agent
    Spec: server/agents/keyword-intelligence.ts
    Model: Claude Sonnet
    Input: GSC query data (already available)
    Output: Ranking deltas, opportunities, cannibalization
    Triggers: Weekly
```

#### PHASE 2 — Report Composition
```
[ ] A10 — Report Composition Agent
    Spec: server/agents/report-composition.ts
    Model: Claude Opus
    Input: All agent scratchpads
    Output: Weekly report draft (PDF + dashboard)
    Triggers: After A09 completes

[ ] A11 — Quality Review Agent
    Spec: server/agents/quality-review.ts
    Model: Claude Sonnet
    Input: Draft report from A10
    Output: Pre-flight check results
    Triggers: After A10 completes

[ ] A12 — Client Communication Agent
    Spec: server/agents/client-communication.ts
    Model: Claude Sonnet
    Input: Approved report
    Output: Cover email draft
    Triggers: After analyst approves
```

#### PHASE 3 — Intelligence Agents
```
[ ] A03 — Technical SEO Audit Agent
    Needs: DataForSEO integration (future)

[ ] A04 — Content Performance Agent
    Input: GA4 page data (already available)
    Model: Claude Sonnet

[ ] A05 — Backlink Intelligence Agent
    Needs: Ahrefs/SEMrush (future)

[ ] A06 — Competitor Benchmarking Agent
    Needs: SEMrush (stub ready — auto-activates)

[ ] A07 — AEO/GEO Visibility Agent
    Needs: Gumshoe API (future)
```

#### PHASE 4 — Dashboard UI
```
[ ] Review Queue page
    Path: client/src/pages/dashboard/review-queue.tsx

[ ] Agent Console page
    Path: client/src/pages/dashboard/agent-console.tsx

[ ] Workspace Home (multi-client)
    Path: client/src/pages/dashboard/workspace-home.tsx
```

---

## 🗄️ Database Schema — New Tables (Additive Only)

```sql
-- Add these NEW tables, never modify existing ones

agent_scratchpad (
  id, tenant_id, agent_id, run_id,
  findings JSONB, created_at, model_used, tokens_used
)

agent_runs (
  id, tenant_id, agent_id, status,
  started_at, completed_at, input_hash,
  output JSONB, error TEXT, tokens_in, tokens_out
)

recommendations (
  id, tenant_id, run_id, priority,
  statement, evidence JSONB, effort,
  impact, owner_role, status, analyst_edit
)

anomalies (
  id, tenant_id, metric, severity,
  detected_at, value, baseline, delta,
  root_cause TEXT, status
)

report_drafts (
  id, tenant_id, report_type, week_number,
  content JSONB, pdf_url, status,
  analyst_notes, created_at, approved_at
)
```

---

## 🔀 Agent Communication Pattern

```
Agents NEVER call each other directly.
Agents communicate via scratchpad table:

Agent writes → agent_scratchpad table
Next agent reads → from scratchpad
Orchestrator manages → sequence + timing

This makes system debuggable:
Every claim traceable to specific agent_run_id
```

---

## 💰 Model Routing (Claude Equivalent of PDF spec)

```
PDF spec used OpenAI — we use Claude:

Routing/classify  → gpt-4.1-nano   (A01, A08 triage)
Analysis tasks    → gpt-4.1        (A02–A07, A11, A12)
Strategy tasks    → gpt-4.1        (A09, A10 — upgrade to gpt-5.5 when available)
Reasoning         → o3             (A08 P0/P1 root-cause only)
```

---

## 🏗️ New File Structure (When Adding Agents)

```
server/
├── agents/
│   ├── base-agent.ts          ← Abstract base class
│   ├── anomaly-detection.ts   ← A08
│   ├── recommendation.ts      ← A09
│   ├── report-composition.ts  ← A10
│   └── ...
├── orchestrator/
│   ├── scheduler.ts           ← node-cron jobs
│   ├── supervisor.ts          ← Agent run manager
│   └── scratchpad.ts          ← DB read/write helpers
├── routes/
│   ├── agents/
│   │   ├── anomalies.ts       ← GET /api/agents/anomalies
│   │   ├── recommendations.ts ← GET /api/agents/recommendations
│   │   └── runs.ts            ← GET /api/agents/runs
│   └── ... (existing routes untouched)
└── ... (existing files untouched)

client/src/
├── components/
│   ├── agents/
│   │   ├── AnomalyCard.tsx
│   │   ├── RecommendationList.tsx
│   │   └── AgentRunStatus.tsx
│   └── ... (existing untouched)
├── pages/dashboard/
│   ├── report-preview.tsx     ← EXISTING — DO NOT TOUCH
│   ├── review-queue.tsx       ← NEW
│   ├── agent-console.tsx      ← NEW
│   └── workspace-home.tsx     ← NEW
```

---

## ⚠️ Known Bug Patterns — Avoid These

```
1. Wrong function name:
   ❌ computeDataHealth()
   ✅ computeDataHealthScore()

2. Wrong null check for unconfigured sources:
   ❌ { organicTraffic: null }
   ✅ null

3. Date range off-by-one:
   ❌ previousDays (missing +1)
   ✅ previousDays + 1

4. Wrong data path:
   ❌ report.previousPeriod?.gsc?.clicks
   ✅ report.previousPeriod?.gscClicks

5. Non-ASCII in PDF:
   Always use cleanText() helper for PDF content

6. Brand name in Competitive SOV:
   "www" label bug — use hardcoded brand name resolution
```

---

## 📋 How to Use This File

When implementing any feature:
1. Read relevant spec from `specs/` folder
2. Check "Features Already Built" list above
3. Follow "New File Structure" exactly
4. Never touch files in CRITICAL RULES section
5. Always pass computedMetrics to PDF generator
6. Test against existing GA4+GSC data — must not break

---

*Last updated: May 2026*
*Project: Executive Insight Agent — AgentsArchitects.ai*
*PDF Reference: AA-SEO-PPS-2026-002 v1.0*
