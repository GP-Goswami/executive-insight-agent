# Executive Insight Agent

AI-powered SEO reporting platform built by AgentsArchitects.ai. Connects to Google Analytics 4 and Google Search Console, runs a pipeline of AI agents to detect anomalies, synthesise recommendations, compose reports, and draft client communications — all inside a React dashboard.

---

## Stack

| Layer    | Technology                          |
|----------|-------------------------------------|
| Frontend | React 18 + Vite + TypeScript        |
| Backend  | Express + TypeScript                |
| Database | PostgreSQL + Drizzle ORM            |
| Auth     | Google OAuth via Passport.js        |
| AI       | OpenAI (gpt-4.1-nano, gpt-4.1, o3) |
| Dev      | ngrok for local HTTPS tunnelling    |

---

## Setup

### 1. Prerequisites

- Node.js 20+
- PostgreSQL 15+ (or a Neon/Supabase connection string)
- A Google Cloud project with the Analytics Data API and Search Console API enabled
- An OpenAI API key

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env with your values
```

Required variables:

| Variable              | Description                            |
|-----------------------|----------------------------------------|
| `DATABASE_URL`        | PostgreSQL connection string           |
| `OPENAI_API_KEY`      | OpenAI API key                         |
| `GOOGLE_CLIENT_ID`    | Google OAuth client ID                 |
| `GOOGLE_CLIENT_SECRET`| Google OAuth client secret             |
| `SESSION_SECRET`      | Random 64-byte hex string              |

### 4. Push database schema

```bash
npm run db:push
```

### 5. Run locally

```bash
npm run dev
```

The server starts on `http://localhost:5000`. For Google OAuth to work, expose it via ngrok:

```bash
ngrok http 5000
# Update GOOGLE_CLIENT_ID redirect URI in Google Cloud Console to the ngrok URL
```

---

## Pages

| Route                          | Description                                      |
|--------------------------------|--------------------------------------------------|
| `/dashboard`                   | Workspace Home — health summary + quick links    |
| `/dashboard/overview`          | Executive Overview — full GA4 + GSC dashboard    |
| `/dashboard/traffic`           | GA4 traffic breakdown                            |
| `/dashboard/gsc`               | Google Search Console explorer                   |
| `/dashboard/rankings`          | Keyword rankings                                 |
| `/dashboard/backlinks`         | Backlink analysis                                |
| `/dashboard/ai-referrers`      | AI referrer traffic                              |
| `/dashboard/ai-mentions`       | Brand mention tracking                           |
| `/dashboard/report-preview`    | Full executive report (PDF download)             |
| `/dashboard/review-queue`      | Analyst review queue for AI-generated drafts     |
| `/dashboard/agent-console`     | Agent observability — runs, cost, errors         |
| `/dashboard/exports`           | Data exports                                     |
| `/dashboard/settings`          | Property and account settings                    |

---

## AI Agents

All agents live in `server/agents/`. They communicate via the `agent_scratchpad` table — never by calling each other directly.

| ID  | Name                        | Model          | Trigger        | Output                             |
|-----|-----------------------------|----------------|----------------|------------------------------------|
| A08 | Anomaly Detection           | gpt-4.1-nano / o3 | Daily 3 AM  | Anomaly rows in DB                 |
| A09 | Recommendation Synthesis    | gpt-4.1        | Weekly Mon 4 AM (after A08) | 3–7 prioritised recommendations |
| A10 | Report Composition          | gpt-4.1        | Weekly Mon 4 AM (after A09) | Report draft in DB               |
| A11 | Quality Review              | gpt-4.1        | On demand / after A10 | Pass/fail pre-flight check    |
| A12 | Client Communication        | gpt-4.1        | On demand      | Email draft (never auto-sent)      |

### Model routing

```
Triage / classify  → gpt-4.1-nano  (A08 first pass)
Root-cause reason  → o3            (A08 P0/P1 only)
Analysis tasks     → gpt-4.1       (A09, A11, A12)
Composition tasks  → gpt-4.1       (A10)
```

Override any model via environment variables (see `.env.example`).

### Scheduler

Agents run automatically via `node-cron`:

- **Daily 3:00 AM** — A08 Anomaly Detection across all active tenants
- **Monday 4:00 AM** — A09 Recommendation Synthesis → A10 Report Composition → status set to `qa_review`

Manual trigger via API or the "Run Now" button in Agent Console.

---

## API Endpoints

All agent endpoints are mounted under `/api/agents`.

### Anomalies (A08)

| Method | Path                      | Description                     |
|--------|---------------------------|---------------------------------|
| GET    | `/api/agents/anomalies`   | List anomalies (`?tenantId=&severity=&status=`) |
| PATCH  | `/api/agents/anomalies/:id` | Update status (`open\|acknowledged\|resolved`) |
| POST   | `/api/agents/anomaly/run` | Trigger A08 for a tenant        |

### Recommendations (A09)

| Method | Path                               | Description                   |
|--------|------------------------------------|-------------------------------|
| GET    | `/api/agents/recommendations`      | List recommendations (`?tenantId=&status=`) |
| PATCH  | `/api/agents/recommendations/:id`  | Approve / veto / edit         |
| POST   | `/api/agents/recommendations/run`  | Trigger A09 for a tenant      |

### Report Drafts (A10)

| Method | Path                  | Description                              |
|--------|-----------------------|------------------------------------------|
| GET    | `/api/agents/reports` | List drafts (`?tenantId=&status=`)        |
| GET    | `/api/agents/reports/:id` | Single draft with full content       |
| PATCH  | `/api/agents/reports/:id` | Update status / analyst notes        |
| POST   | `/api/agents/report/run`  | Trigger A10 for a tenant             |

### Quality Review (A11)

| Method | Path                 | Description                              |
|--------|----------------------|------------------------------------------|
| POST   | `/api/agents/qa/run` | Run QA checks (sync, returns pass/fail)  |
| GET    | `/api/agents/qa/result` | Fetch stored QA result (`?reportDraftId=`) |

### Client Communication (A12)

| Method | Path                            | Description                         |
|--------|---------------------------------|-------------------------------------|
| POST   | `/api/agents/communication/run` | Generate email draft (never sends)  |
| GET    | `/api/agents/communication`     | List email drafts (`?tenantId=`)    |
| PATCH  | `/api/agents/communication/:id` | Update status / analyst edit        |

### Agent Runs & Cost

| Method | Path                           | Description                       |
|--------|--------------------------------|-----------------------------------|
| GET    | `/api/agents/runs`             | List runs (`?tenantId=&agentId=&status=&limit=`) |
| GET    | `/api/agents/runs/cost-summary`| Weekly cost by agent (`?tenantId=&days=7`) |

### Scheduler

| Method | Path                          | Description                              |
|--------|-------------------------------|------------------------------------------|
| GET    | `/api/agents/scheduler/status`| Next/last run times and error log        |
| POST   | `/api/agents/scheduler/trigger` | Manual trigger (`{ job: 'daily'\|'weekly', tenantId? }`) |

### Rate limiting

All `POST */run` endpoints are rate-limited to **10 runs per tenant per hour**. Exceeding the limit returns HTTP 429 with a `Retry-After` header.

---

## Database Schema

New tables added for the agent layer (additive only — existing tables are never modified):

| Table              | Purpose                                        |
|--------------------|------------------------------------------------|
| `agent_runs`       | Run log with status, tokens, duration, output  |
| `agent_scratchpad` | Inter-agent communication via JSONB findings   |
| `anomalies`        | A08 output — detected metric anomalies         |
| `recommendations`  | A09 output — prioritised action items          |
| `report_drafts`    | A10 output — weekly report drafts              |
| `email_drafts`     | A12 output — client communication drafts       |

---

## Key Rules (from CLAUDE.md)

- **Never recompute metrics in the PDF generator** — frontend passes `computedMetrics` in the download payload
- **Agents never call each other directly** — all communication via `agent_scratchpad`
- **A12 never auto-sends email** — analyst must explicitly approve in the Review Queue
- **Scheduler failure never crashes the server** — all errors are caught internally

---

## Development Scripts

```bash
npm run dev        # Start dev server (Express + Vite HMR)
npm run build      # Production build
npm run db:push    # Apply schema changes to DB (Drizzle push)
npm run db:studio  # Open Drizzle Studio (DB GUI)
```

---

*Project: Executive Insight Agent — AgentsArchitects.ai*
*Spec reference: AA-SEO-PPS-2026-002 v1.0*
