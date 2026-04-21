# Executive Insight Agent — Project Brief for Replit

> **Purpose of this document**: Give a Replit AI model a complete picture of the project's
> logic, architecture, data flows, and current state so it can fill in missing pieces,
> fix bugs, or extend functionality without needing any setup instructions.

---

## 1. What This Project Is

An **enterprise SEO analytics dashboard** that:

1. Pulls raw data from 4 external APIs (GA4, GSC, SEMrush, DataForSEO)
2. Normalizes and analyzes that data through a deterministic pipeline
3. Generates an AI executive summary (GPT-4o-mini) from the structured insights
4. Renders everything in a React dashboard with charts, tables, and a PDF export

The primary user is an **SEO agency or in-house team** presenting performance to executives or clients.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, TypeScript, TailwindCSS, Recharts, React Query |
| Backend | Node.js, Express, TypeScript (ESM), tsx for dev |
| Database | PostgreSQL via Drizzle ORM + `pg` pool |
| Auth | express-session, bcryptjs, connect-pg-simple |
| PDF | PDFKit |
| Email | Resend |
| AI | OpenAI SDK (gpt-4o-mini, gpt-4o) |
| External APIs | `googleapis` (GA4 + GSC), SEMrush REST API, DataForSEO REST API |

**Dev command**: `npm run dev` → runs `tsx server/index.ts`, serves Express + Vite on port 5000.

**Build**: Vite builds frontend to `dist/public`, esbuild bundles server to `dist/index.cjs`.

---

## 3. Top-Level Directory Structure

```
/
├── client/src/           ← React frontend
│   ├── App.tsx           ← Router + auth guards + DashboardLayout
│   ├── pages/dashboard/  ← All dashboard page components
│   ├── components/dashboard/ ← Reusable dashboard widgets
│   ├── hooks/            ← use-auth, use-domain
│   └── lib/              ← queryClient, utils
├── server/
│   ├── index.ts          ← Express app entry, HTTP server
│   ├── routes.ts         ← ALL API endpoints (~3100 lines)
│   ├── storage.ts        ← DatabaseStorage class (Drizzle queries)
│   ├── db.ts             ← Drizzle + pg pool setup
│   └── lib/              ← Business logic modules (see Section 5)
├── shared/
│   └── schema.ts         ← Drizzle table definitions + Zod types (source of truth)
└── .env                  ← Environment variables (never committed)
```

---

## 4. Database Schema (All Tables)

Defined in `shared/schema.ts` using Drizzle ORM with PostgreSQL.

### Core Multi-Tenant Tables

```
clients
  id (uuid PK), name, status, createdAt

properties
  id (uuid PK), clientId (FK→clients), name, ga4PropertyId, gscSiteUrl,
  semrushProjectId, timezone, createdAt
```

### Daily Metrics Tables (time-series, FK→properties)

```
ga4_daily_metrics
  id, date, propertyId, totalUsers, sessions, engagedSessions, conversions,
  source, medium, deviceCategory, country, landingPagePath

gsc_daily
  id, date, propertyId, clicks, impressions, ctr (decimal 5,4),
  avgPosition (decimal 5,2), query, page, country, device

rank_daily
  id, date, propertyId, keyword, location, device, position, url

backlinks_daily
  id, date, propertyId, totalBacklinks, referringDomains, newLinks,
  lostLinks, toxicScore

ai_referrer_daily
  id, date, propertyId, aiSource, totalUsers, sessions,
  topLandingPagesJson (jsonb), deviceCategory

ai_sources
  id, name, domain (unique), isActive
```

### API Cache Tables (raw API response cache, 24h TTL)

```
ga4_data        (property_id, endpoint, data_json, fetched_at)
gsc_data        (site_url, endpoint, data_json, fetched_at)
semrush_data    (domain, endpoint, data_json, fetched_at)
backlink_data   (domain, endpoint, data_json, fetched_at)
```

### Operational Tables

```
sync_runs        (provider, propertyId, startedAt, endedAt, status, rowsWritten, errorMessage)
kpi_daily_summary (derived KPI rollups per property per day)
share_links       (token, propertyId, filters jsonb, dateRange jsonb, expiresAt)
```

### AI Mentions Tables

```
ai_prompt_sets   (clientId, name, description)
ai_prompts       (promptSetId, promptText, geo, language, category, priority)
ai_brand_entities (clientId, brandName, domainsJson, synonymsJson, competitorsJson)
ai_prompt_runs   (promptId, model, runAt, status, latencyMs, tokens, costEstimate,
                  responseText, errorMessage)
ai_mentions      (runId, mentionFound, mentionCount, mentionPosition,
                  contextSnippet, competitorFoundJson, sentiment,
                  recommendationFlag, mentionScore)
```

### Auth Tables (from `shared/models/auth.ts`)

```
users            (id, email, password hash, role enum ADMIN/INTERNAL/CLIENT,
                  createdAt, resetToken, resetTokenExpiry)
sessions         (session store, managed by connect-pg-simple)
```

---

## 5. Backend Logic Modules (`server/lib/`)

### 5.1 `cache.ts` — Smart API Cache Layer

**Purpose**: Intercepts all external API calls and stores responses in the 4 cache tables. Returns cached data if age < TTL (default 24h). Forces re-fetch on cache miss or manual refresh.

**Key functions**:
```typescript
fetchWithCache(provider, identifier, endpoint, fetcher, forceRefresh?, ttlHours?)
// provider: "ga4" | "gsc" | "semrush" | "backlinks"
// identifier: propertyId / siteUrl / domain
// endpoint: short label e.g. "top-pages", "summary"
// fetcher: () => Promise<T> — the actual API call

clearProviderCache(provider)
// Wipes all rows from the appropriate cache table.
// Called by POST /api/sync/:provider

getCacheStatus()
// Returns { fetchedAt, count } for each of the 4 providers.
// Used by GET /api/sync/status to populate the Settings page sync indicators.
```

### 5.2 `google-apis.ts` — GA4 + GSC Clients

**Auth**: Uses `GOOGLE_SERVICE_ACCOUNT_JSON` env var (JSON string of service account key).

**GA4 functions**:
```typescript
getGA4Metrics(propertyId, startDate, endDate)
// Returns: { totalUsers, sessions, engagedSessions, screenPageViews, conversions }
// Calls: analyticsdata.runReport, dimensions=[date], metrics=[sessions, users, etc.]

getGA4DailyTraffic(propertyId, startDate, endDate)
// Returns: { date, users, sessions }[] — for trend charts

getGA4TopPages(propertyId, startDate, endDate)
// Returns: { page, sessions, users }[] — top landing pages

getGA4TrafficSources(propertyId, startDate, endDate)
// Returns: { source, medium, sessions, users }[]

getGA4AIReferrers(propertyId, startDate, endDate)
// Filters traffic sources against known AI patterns:
// chatgpt, gemini, perplexity, claude, copilot, you.com, phind, etc.
// Returns: { source, users, sessions, avgSessionDuration, bounceRate }[]
```

**GSC functions**:
```typescript
getGSCSummary(siteUrl, startDate, endDate)
// CRITICAL: Called WITHOUT dimensions. Returns true aggregate totals.
// Returns: { clicks, impressions, ctr, position }
// Used ONLY for KPI cards — never for table data.

getGSCTable(siteUrl, startDate, endDate, dimension, rowLimit)
// dimension: "query" | "page"
// Returns rows for the GSC explorer tables.
// NEVER used to calculate summary totals.

getGSCRankings(siteUrl, startDate, endDate)
// Returns: { query, clicks, impressions, ctr, position }[]

getGSCMonthlyAggregation(siteUrl)
// Returns last 16 months of GSC data for trend charts

getGSCSites()
// Lists all sites verified in GSC — used for health check
```

**Data isolation rule (critical)**:
- `getGSCSummary()` → KPI cards only (no dimensions → true totals)
- `getGSCTable()` → Explorer tables only (with dimensions → row-level data)
- These two sources must NEVER be mixed or used interchangeably.

### 5.3 `semrush.ts` — SEMrush API Client

**Auth**: `SEMRUSH_API_KEY` env var. Uses `hasSemrushApiKey()` guard.

**SemrushClient class methods**:
```typescript
getDomainOverview(domain)
// type=domain_ranks — returns organic traffic, keywords count, traffic value

getDomainOrganicKeywords(domain, limit?)
// type=domain_organic — returns keyword list with position, volume, CPC, URL

getDomainKeywordHistory(domain, keyword)
// type=domain_organic_search_keywords — position history for one keyword

getTopPages(domain, limit?)
// type=top_pages_organic — top performing pages

getBacklinksOverview(domain)
// type=backlinks_overview — total backlinks, referring domains

getPositionChanges(domain, type)
// type: "new" | "lost" | "improved" | "declined"
```

### 5.4 `dataforseo.ts` — DataForSEO API Client

**Auth**: `DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD` env vars (Base64 Basic auth).

**Functions**:
```typescript
getDomainMetrics(domain)
// POST /v3/backlinks/summary/live
// Returns: { backlinks, referring_domains, dofollow, gov, edu }

getDomainRankings(domain, limit?)
// POST /v3/serp/google/organic/live/advanced with target=domain
// Returns: { keyword, position, url, searchVolume }[]

getDomainBacklinks(domain, limit?)
// POST /v3/backlinks/backlinks/live
// Returns: { url_from, domain_from, anchor, is_dofollow, first_seen }[]

getDomainTopPages(domain, limit?)
// POST /v3/backlinks/pages/live
// Returns: { url, backlinks, referring_domains }[]

getKeywordData(keyword, locationCode?)
// POST /v3/keywords_data/google_ads/search_volume/live
// Returns: { keyword, search_volume, cpc, competition }

getSerpResults(keyword, locationCode?)
// POST /v3/serp/google/organic/live/advanced
// Returns SERP items for keyword

getReferringDomains(domain, limit?)
// POST /v3/backlinks/referring_domains/live
// Returns: { domain_from, backlinks, is_dofollow, authority_score }[]
```

### 5.5 `analytics-orchestrator.ts` — Central Data Fetcher

Called by the main dashboard endpoints. Runs all source fetches in parallel using `Promise.allSettled()`. 

**Strict rules enforced in this module**:
- GSC summary (`getGSCSummary`) → KPIs only
- GSC table (`getGSCTable`) → display tables only
- GA4 → sessions, users, pageviews only
- CTR is re-validated: `Math.round((clicks / impressions) * 10000) / 100`
- On any API failure: returns structured error, never returns fake data

**Returns** `OrchestratedResponse`:
```typescript
{
  summary: { clicks, impressions, ctr, position, sessions, users, pageviews,
             source: { clicks: "GSC"|"error"|"unavailable",
                       traffic: "GA4"|"error"|"unavailable" },
             dataCoverage: "full" | "partial" },
  queries: GSCRow[],   // query dimension table
  pages: GSCRow[],     // page dimension table
  seo: { keywords, rankings, backlinks, topPages, source: "DataForSEO", estimated: true },
  meta: { validated, mismatchDetected, lastUpdated, errors[] }
}
```

### 5.6 `normalization-engine.ts` — Data Normalization (Pipeline Layer 2)

**Input**: `AggregatedDataset` from `storage.getAggregatedSeoData()`

**Output**: `NormalizedData` with typed trend signals

**Key computations**:
- Traffic growth rate: `(current - previous) / previous * 100`
- Traffic trend: `"up"` if >+2%, `"down"` if <-2%, `"flat"` otherwise
- CTR performance: `"good"` if ≥5%, `"average"` if ≥3%, `"poor"` otherwise
  - CTR benchmark hardcoded to 5%
- Keyword trend: `"improving"` if netGrowth>0, `"declining"` if <0, `"stable"` if 0
- Backlink trend: `"growing"` / `"declining"` / `"stable"` based on delta
- Data quality flags: `hasTraffic`, `hasSearch`, `hasKeywords`, `hasConversions`, `hasBacklinks`
  (booleans used for conditional rendering and insight generation)
- Safety: `safeNum(value)` returns 0 for null/NaN; `safeDivide(n,d)` returns 0 if d=0

### 5.7 `seo-metrics.ts` — Metric Computation (Pipeline Layer 3)

Operates on `AggregatedDataset`. Computes:
- Traffic growth rate
- Weighted CTR
- CTR gap vs benchmark
- Top-10 keyword percentage
- Page 2 opportunity detection (positions 11-20)
- Low-CTR high-impression opportunity flag (>5000 impressions + poor CTR)

### 5.8 `insight-engine.ts` — Rule-Based Insight Generator (Pipeline Layer 3)

**Input**: `NormalizedData`
**Output**: `Insight[]`

Each insight has:
```typescript
{ type: "positive" | "warning" | "neutral",
  category: "traffic" | "keywords" | "ctr" | "opportunity" | "correlation" |
            "data-quality" | "conversions" | "backlinks",
  message: string }
```

**Rules fired**:
1. Traffic trend (up/down/flat) → traffic insight
2. CTR vs benchmark → ctr insight
3. High impressions + poor CTR → opportunity insight
4. Keyword trend → keywords insight
5. Top-10 keyword ratio → keywords insight
6. Conversion trend → conversions insight
7. Backlink delta → backlinks insight
8. Referring domain delta → backlinks insight
9. Traffic–keyword correlation → correlation insight
   - Both down → "ranking drops driving traffic reduction"
   - Both up → "SEO improvements translating to traffic"
   - Divergent → investigate non-organic or seasonal patterns
10. Avg position in 11–20 → page 2 opportunity
11. Missing data flags → data-quality warnings

### 5.9 `ai-narrative.ts` — AI Executive Summary (Pipeline Layer 4)

**Model**: `gpt-4o-mini`, temperature 0.3, max_tokens 500

**System prompt rules**:
- Single paragraph, 4–6 sentences
- No bullet points, no markdown, no hedging words (may/might/could/possibly/perhaps)
- No invented context (no seasonality, algorithm updates, competitor activity)
- Never repeat raw insight text — synthesize only
- Never introduce metrics not present in the insights

**Narrative arc enforced**:
1. Open with dominant signal (warnings > positives → lead with worst warning)
2. Supporting/contrasting context
3. Primary risk or opportunity
4. Forward-looking action (grounded in data only)

**Input to GPT**: Structured JSON of all insights, grouped by type and category.

### 5.10 `ai-mentions.ts` — Brand Visibility in AI Responses

**Flow**:
1. User creates an `ai_prompt_set` with brand entity + competitor names
2. User clicks "Run Now" → `runPromptSet(promptSetId)` is called
3. Each prompt is sent to GPT-4o
4. Response is analyzed for:
   - `mentionFound` (0/1), `mentionCount`, `mentionPosition`
   - `sentiment` (positive/neutral/negative)
   - `recommendationFlag` (0/1)
   - `competitorFoundJson` (list of competitors mentioned)
   - `mentionScore` (0–100, composite)
   - `contextSnippet` (surrounding text)
5. Results stored in `ai_prompt_runs` + `ai_mentions`

**Dashboard stats**: Coverage %, Avg Score, Total Mentions, Competitor Analysis from `getAiMentionsStats()`

### 5.11 `pdf-generator.ts` — PDF Report via PDFKit

Generates an A4 PDF with:
- Title block: domain name + date range
- 6 KPI cards: Users, Sessions, Clicks, Impressions, CTR, Avg Position
- Executive Summary section (blue accent bar, AI-generated text)
- Key Insights (split into Risks / Opportunities / Observations)
- What Changed (delta rows with arrows)
- Top Pages table (GSC → GA4 fallback)
- AI Traffic Sources table
- Trend chart (line chart using vector primitives, no canvas)
- Data Availability note

**Endpoint**: `POST /api/generate-pdf`

Returned as `application/pdf` binary.
Filename pattern: `{domain}-seo-report-{month}-{year}.pdf`

### 5.12 `auth.ts` — Authentication + Sessions

- `setupAuth(app)`: Configures express-session with PostgreSQL store (`connect-pg-simple`)
- `registerAuthRoutes(app)`: Registers POST /api/auth/login, /api/auth/register, /api/auth/logout, GET /api/auth/me
- `isAuthenticated` middleware: Guards all `/api/*` routes (checks `req.session.userId`)
- Passwords: bcryptjs with salt rounds 10
- Session cookie: `connect.sid`, httpOnly, 7-day expiry
- Password reset: email link via Resend, token stored in `users.resetToken`

**Roles**: `ADMIN` | `INTERNAL` | `CLIENT` (defined, not yet fully enforced in routes)

### 5.13 `storage.ts` — Database Access Layer

`DatabaseStorage` implements `IStorage` interface. All DB access goes through this class.

**Key aggregation methods**:
```typescript
getAggregatedSeoData(propertyId, startDate, endDate, previousStartDate?, previousEndDate?)
// Returns aggregated totals for current + previous period:
// { ga4: {users,sessions,conversions}, ga4Previous, gsc: {clicks,impressions,ctr,avgPosition},
//   rankings: {totalKeywords,top10Keywords,improvedKeywords,declinedKeywords},
//   backlinks: {currentBacklinks,previousBacklinks,currentReferringDomains,previousReferringDomains} }
// Keyword movement is computed via raw SQL CTE comparing avg positions

getDailyTrends(propertyId, startDate, endDate)
// Returns { ga4Daily: {date,users,sessions}[], gscDaily: {date,clicks,impressions}[] }
// Used for trend line charts

getGscTopPages(propertyId, startDate, endDate)
// Aggregates gsc_daily by page, returns top 10 by impressions DESC

getKeywordDistribution(propertyId, startDate, endDate)
// Returns { top3, top10, top20, top50, top100, beyond } counts
// Uses latest date within the range as snapshot

getOverviewMetrics(propertyId, startDate, endDate)
// Quick overview query for header KPIs
```

---

## 6. API Endpoints (server/routes.ts)

### Auth
| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | Create user account |
| POST | `/api/auth/login` | Log in, set session |
| POST | `/api/auth/logout` | Destroy session |
| GET | `/api/auth/me` | Current user info |
| POST | `/api/auth/forgot-password` | Send reset email |
| POST | `/api/auth/reset-password` | Apply new password |

### Sync & Cache
| Method | Path | Description |
|---|---|---|
| GET | `/api/sync/status` | Cache age + count for all 4 providers |
| POST | `/api/sync/:provider` | Clear cache for provider (ga4/gsc/semrush/dataforseo) |
| POST | `/api/sync/all` | Clear all caches |

### Dashboard Data
| Method | Path | Key Params | Returns |
|---|---|---|---|
| GET | `/api/metrics/executive-overview` | propertyId, domain, startDate, endDate | Full orchestrated summary: clicks, impressions, CTR, position, sessions, users, queries[], pages[], seo{} |
| GET | `/api/metrics/gsc-explorer` | siteUrl, startDate, endDate | GSC queries + pages tables |
| GET | `/api/metrics/ga4-overview` | propertyId, startDate, endDate | GA4 users, sessions, daily trends |
| GET | `/api/metrics/ai-referrers` | propertyId, startDate, endDate | AI traffic sources list |
| GET | `/api/metrics/rankings` | propertyId, domain, startDate, endDate | Keyword positions (GSC or SEMrush toggle) |
| GET | `/api/metrics/backlinks` | domain | Backlink profile (DataForSEO primary, SEMrush fallback) |

### Report
| Method | Path | Description |
|---|---|---|
| GET | `/api/report-data` | Full pipeline: aggregate→normalize→insights→narrative. Returns JSON for report preview page. |
| POST | `/api/generate-pdf` | Same pipeline, outputs binary PDF |

### AI Mentions
| Method | Path | Description |
|---|---|---|
| GET | `/api/ai-mentions/prompt-sets` | List all prompt sets |
| POST | `/api/ai-mentions/prompt-sets` | Create prompt set |
| GET | `/api/ai-mentions/prompt-sets/:id/prompts` | Get prompts in set |
| POST | `/api/ai-mentions/prompts` | Add prompt to set |
| POST | `/api/ai-mentions/run/:promptSetId` | Execute the prompt set |
| GET | `/api/ai-mentions/results/:promptSetId` | Get run results |
| GET | `/api/ai-mentions/stats/:clientId` | Aggregated stats |
| GET/POST/DELETE | `/api/ai-mentions/brand-entities` | Manage brand entities |

### Settings & Properties
| Method | Path | Description |
|---|---|---|
| GET | `/api/properties` | List all properties |
| POST | `/api/properties` | Create property |
| PATCH | `/api/properties/:id` | Update GA4 ID, GSC URL, name |
| GET | `/api/clients` | List / create clients |
| GET | `/api/health` | Full API health check (all 6 services) |
| GET | `/api/check-all-apis` | Batch API status (used by Settings page) |

### Utility / Debug
| Method | Path | Description |
|---|---|---|
| GET | `/api/semrush-backlinks` | Direct SEMrush backlinks overview fetch |
| GET | `/api/backlinks-summary` | DataForSEO backlinks summary fetch |
| GET | `/api/backlinks` | DataForSEO backlinks list fetch |
| GET | `/api/verify-dataforseo` | Test SERP ranking for a keyword |

---

## 7. Frontend — Page-by-Page Logic

### Auth Guard Logic (`App.tsx`)
- `useAuth()` hook calls `GET /api/auth/me` via React Query
- Unauthenticated user on `/dashboard/*` → redirect to `/`
- Authenticated user on `/` → redirect to `/dashboard`
- All dashboard routes wrapped in `DashboardLayout` (sidebar + header)

### `DashboardLayout`
- Left sidebar: `AppSidebar` with navigation links + sync status indicators
- Header: `DomainSelector` dropdown + `ThemeToggle`
- `DomainProvider` context: holds selected domain string + GA4 property ID throughout session

### Executive Overview (`/dashboard`)
Calls `GET /api/metrics/executive-overview` with current date range.
Renders:
- 6 KPI cards with delta badges: Organic Users, Sessions, Clicks, Impressions, CTR, Avg Position
- Sparkline chart for 30-day trend
- Top Pages table
- AI Referrers summary table
- GSC module (separate component, own data fetch)
- GA4 module (separate component, own data fetch)

### AI Referrers (`/dashboard/ai-referrers`)
Calls `GET /api/metrics/ai-referrers`.
Filters GA4 traffic sources by known AI domains:
`chatgpt.com`, `chat.openai.com`, `gemini.google.com`, `perplexity.ai`,
`claude.ai`, `copilot.microsoft.com`, `you.com`, `phind.com`, `bing.com/chat`
Displays per-source: Users, Sessions, Avg Duration, Bounce Rate.

### AI Mentions (`/dashboard/ai-mentions`)
Full CRUD for prompt sets. Runs prompts via `POST /api/ai-mentions/run/:id`.
Shows: Coverage %, Avg Mention Score, Total Mentions, per-prompt results with sentiment badges.

### GSC Explorer (`/dashboard/gsc`)
Tabs: Queries | Pages.
Filters: query text, page URL, country, device.
Columns: Query/Page, Clicks, Impressions, CTR, Avg Position.
Data from `GET /api/metrics/gsc-explorer`.

### Rankings (`/dashboard/rankings`)
Toggle: **GSC** (live position data from GSC API) vs **SEMrush** (comprehensive keyword data).
Shows: Keyword, Position, Previous Position, Change, Search Volume, URL.

### Backlinks (`/dashboard/backlinks`)
Shows: Total Backlinks, Referring Domains, New/Lost Links, Anchor Text distribution, Link Types.
Primary: DataForSEO. Fallback: SEMrush.

### Report Preview (`/dashboard/report-preview`)
Date range picker with presets: 7d, 14d, 28d, 30d, 90d, Last Month, Custom.
On Apply → `GET /api/report-data?propertyId=X&start=YYYY-MM-DD&end=YYYY-MM-DD`.
Renders full report layout: KPIs, AI summary paragraph, insights (categorized), top pages, AI traffic table, daily trend chart.
"Download PDF" → `POST /api/generate-pdf` → binary download.

### Settings (`/dashboard/settings`)
- Domain config: update GA4 Property ID, GSC Site URL
- API Status panel: shows working/error/not-configured for each API
- Manual sync buttons: per-provider "Sync Now" → `POST /api/sync/:provider`
- User profile: change email/password

---

## 8. Data Flow — Full Report Pipeline

```
GET /api/report-data
  │
  ├─ storage.getAggregatedSeoData(propertyId, start, end, prevStart, prevEnd)
  │     └─ SQL aggregates from: ga4_daily_metrics, gsc_daily, rank_daily, backlinks_daily
  │
  ├─ getGSCSummary(gscSiteUrl, start, end)          [LIVE — override DB totals]
  │     └─ GSC API, no dimensions, true aggregate clicks/impressions/ctr/position
  │
  ├─ getGSCTable(gscSiteUrl, start, end, "page", 25000)  [LIVE — top pages]
  │     └─ GSC API, page dimension
  │
  ├─ getGA4AIReferrers(propertyId, start, end)       [LIVE — AI traffic sources]
  │     └─ GA4 API filtered by AI source patterns
  │
  ├─ normalizeData(aggregatedDataset)
  │     └─ → NormalizedData: traffic, search, keywords, conversions, backlinks, quality flags
  │
  ├─ generateInsights(normalizedData)
  │     └─ → Insight[]: deterministic rule-based array, categorized and typed
  │
  ├─ generateNarrative(insights)
  │     └─ → string: 4-6 sentence executive paragraph from GPT-4o-mini
  │
  └─ return JSON:
        {
          metrics: { ... normalized KPIs ... },
          insights: Insight[],
          summary: "AI-generated paragraph",
          topPages: GSCPage[],
          aiReferrers: AIReferrer[],
          dailyTrends: { ga4Daily[], gscDaily[] },
          missingData: string[]       // which data sources had no data
        }
```

---

## 9. Data Fallback Chain

| Metric | Primary | Fallback |
|---|---|---|
| Clicks / Impressions / CTR / Position (KPIs) | Live GSC API (`getGSCSummary`) | DB `gsc_daily` aggregates |
| Top Pages | Live GSC API (`getGSCTable`, page dimension) | GA4 session data |
| Backlinks / Referring Domains | DataForSEO | SEMrush → returns 0 |
| Keywords (comprehensive) | SEMrush `domain_organic` | GSC query data |
| AI Referrers | Live GA4 API | DB `ai_referrer_daily` |

---

## 10. Environment Variables Required

```env
DATABASE_URL=                        # PostgreSQL connection string
SESSION_SECRET=                      # Express session encryption key (random string)
GOOGLE_SERVICE_ACCOUNT_JSON=         # Full JSON of Google service account (GA4 + GSC)
SEMRUSH_API_KEY=                     # SEMrush API key
DATAFORSEO_LOGIN=                    # DataForSEO account email
DATAFORSEO_PASSWORD=                 # DataForSEO account password
AI_INTEGRATIONS_OPENAI_API_KEY=      # OpenAI API key
AI_INTEGRATIONS_OPENAI_BASE_URL=     # OpenAI base URL (default: https://api.openai.com/v1)
RESEND_API_KEY=                      # Resend email API key (for password reset)
DEBUG=true                           # Optional: enables verbose API logging
```

---

## 11. Key Conventions & Rules (Do Not Break)

1. **GSC summary vs table are STRICTLY separate**.
   - `getGSCSummary()` → KPI numbers only (no dimensions)
   - `getGSCTable()` → display rows only (never sum these for KPIs)

2. **Never return fake/estimated data for primary KPIs**. If an API fails, the response includes
   the error message in `meta.errors[]` and returns zeros. The UI renders a "data unavailable" state.

3. **All external API calls go through `fetchWithCache()`** — never call external APIs directly
   in route handlers. This ensures consistent caching and manual refresh behavior.

4. **AI narrative must be grounded only in insight data**. The system prompt bans speculation,
   hedging, and invented context. Do not relax these constraints.

5. **Drizzle ORM is the only way to query the DB from `storage.ts`**. Raw SQL is only used
   where Drizzle's query builder is insufficient (e.g., CTEs for keyword movement).

6. **The `properties` table is the central join point**. GA4 Property ID and GSC Site URL
   are stored per property. The middleware in `routes.ts` auto-creates a property record
   when a new `propertyId` + `domain` combo is seen in any `/api/metrics/*` request.

7. **All dashboard routes require authentication** via `isAuthenticated` middleware,
   except `/api/health` and a few diagnostic endpoints.

---

## 12. Known Architecture Gaps / Areas to Fill

- **GSC module** in `executive-overview.tsx` has a dedicated `gsc-module.tsx` component
  that does its own data fetch + OAuth token handling. This module is in progress.
  
- **GA4 module** in `executive-overview.tsx` has a dedicated `ga4-module.tsx` component.
  
- **Source toggle** (`source-toggle.tsx`) controls whether Rankings page shows GSC or SEMrush data.

- **`gsc-explorer.tsx`** is the full GSC data explorer (note: filename is `gsc-explorer.tsx`,
  not `gsc.tsx` — the route is `/dashboard/gsc` but the page file is `gsc-explorer.tsx`).

- The **Traffic page** (`/dashboard/traffic`) exists as `traffic.tsx` but may be incomplete.

- **Exports page** (`/dashboard/exports`) lists previously generated PDF reports — the storage
  logic for saving and retrieving generated report files may need to be wired up.

- **Multi-tenant RBAC** is defined (roles: ADMIN/INTERNAL/CLIENT) but route-level enforcement
  is not yet implemented beyond the `isAuthenticated` check.

- **`kpi_daily_summary` table** is defined in schema but not actively populated. It is meant
  to store derived daily KPI rollups for faster querying — the population logic is a gap.

- **`share_links` table** is schema-ready for shareable report links but the frontend UI
  and the token-based public endpoint are not yet implemented.
