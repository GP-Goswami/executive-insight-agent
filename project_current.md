# Executive Insight Agent — Project Current State

**Branch:** `gautam_seo`
**Last updated:** 2026-04-27
**Stack:** React 18 + Vite / Express / PostgreSQL / Drizzle ORM

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture](#architecture)
3. [Directory Structure](#directory-structure)
4. [Database Tables](#database-tables)
5. [API Routes](#api-routes)
6. [Frontend Pages & Hooks](#frontend-pages--hooks)
7. [Environment Variables](#environment-variables)
8. [External Integrations](#external-integrations)
9. [Authentication System](#authentication-system)
10. [Google OAuth Flow](#google-oauth-flow)
11. [Key Design Decisions](#key-design-decisions)
12. [Known Constraints](#known-constraints)

---

## Project Overview

An executive SEO reporting dashboard that aggregates data from Google Analytics 4, Google Search Console, Semrush, and DataForSEO. Users authenticate via email/password or Google OAuth. After connecting their Google account, GA4 properties and GSC sites are auto-discovered — no manual service account setup required.

---

## Architecture

```
Browser (React + Vite)
    ↓ TanStack React Query
Express API Server (Node + TypeScript)
    ├── Auth: custom sessions (express-session + PostgreSQL)
    ├── Google APIs: service account OR per-user OAuth2 tokens
    ├── Semrush API
    ├── DataForSEO API
    ├── OpenAI API (AI mentions + narratives)
    └── Cache layer: 24-hour API response cache
PostgreSQL (Drizzle ORM)
```

---

## Directory Structure

```
Executive-Insight-Agent/
├── client/src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── components/
│   │   ├── app-sidebar.tsx
│   │   ├── theme-provider.tsx
│   │   ├── theme-toggle.tsx
│   │   ├── dashboard/
│   │   │   ├── data-table.tsx
│   │   │   ├── date-range-picker.tsx        ← max date = yesterday
│   │   │   ├── domain-selector.tsx
│   │   │   ├── filter-panel.tsx
│   │   │   ├── ga4-module.tsx
│   │   │   ├── gsc-module.tsx
│   │   │   ├── kpi-card.tsx
│   │   │   ├── metric-chart.tsx
│   │   │   ├── source-toggle.tsx
│   │   │   └── status-badge.tsx
│   │   └── ui/                              ← 59 Radix UI components
│   ├── hooks/
│   │   ├── use-auth.ts
│   │   ├── use-domain.tsx                   ← localStorage: domain, ga4PropertyId, gscSiteUrl
│   │   ├── use-mobile.tsx
│   │   └── use-toast.ts
│   ├── lib/
│   │   ├── auth-utils.ts
│   │   ├── queryClient.ts
│   │   └── utils.ts
│   └── pages/
│       ├── landing.tsx
│       ├── not-found.tsx
│       ├── auth/
│       │   ├── sign-in.tsx                  ← "Sign in with Google" button
│       │   ├── sign-up.tsx                  ← "Sign up with Google" button
│       │   ├── forgot-password.tsx
│       │   └── reset-password.tsx
│       └── dashboard/
│           ├── executive-overview.tsx
│           ├── traffic.tsx
│           ├── ga4-traffic.tsx
│           ├── gsc-explorer.tsx
│           ├── rankings.tsx                 ← bar chart + all-metric deltas + filter
│           ├── backlinks.tsx
│           ├── ai-referrers.tsx
│           ├── ai-mentions.tsx
│           ├── exports.tsx
│           ├── report-preview.tsx
│           └── settings.tsx                 ← Google account connect + property selector
├── server/
│   ├── index.ts
│   ├── routes.ts                            ← all API endpoints
│   ├── db.ts                                ← Drizzle + auto-migrate google_oauth_tokens
│   ├── storage.ts
│   ├── static.ts
│   ├── vite.ts
│   └── lib/
│       ├── auth.ts                          ← sessions, bcrypt, password reset
│       ├── google-oauth.ts                  ← OAuth2 flow, token storage, property discovery
│       ├── google-apis.ts                   ← GA4 + GSC API clients (service account)
│       ├── semrush.ts
│       ├── dataforseo.ts
│       ├── analytics-orchestrator.ts
│       ├── ai-mentions.ts
│       ├── ai-narrative.ts
│       ├── insight-engine.ts
│       ├── seo-metrics.ts
│       ├── seo-report-generator.ts
│       ├── pdf-generator.ts                 ← PDFKit — no Conversions column
│       ├── normalization-engine.ts
│       ├── cache.ts                         ← 24-hour response cache
│       ├── email.ts                         ← Resend API
│       └── debug.ts
├── shared/
│   ├── schema.ts                            ← re-exports all tables
│   └── models/
│       ├── auth.ts                          ← users, sessions, passwordResetTokens, googleOAuthTokens
│       └── chat.ts
├── .env
├── drizzle.config.ts
└── project_current.md                       ← this file
```

---

## Database Tables

### Auth Tables (`shared/models/auth.ts`)

| Table | Key Columns |
|-------|-------------|
| `users` | id (UUID PK), email (unique), password (nullable), firstName, lastName, profileImageUrl |
| `sessions` | sid PK, sess (JSONB), expire |
| `passwordResetTokens` | id, userId FK, token, expiresAt, usedAt |
| `googleOAuthTokens` | id, userId FK (unique), googleEmail, accessToken, refreshToken, expiresAt, scopes |

> `googleOAuthTokens` is created via `CREATE TABLE IF NOT EXISTS` in `server/db.ts` on startup — no manual migration required.

### Business Tables (`shared/schema.ts`)

| Table | Purpose |
|-------|---------|
| `clients` | Client organizations |
| `properties` | GA4/GSC properties per client |
| `ga4DailyMetrics` | Daily GA4 aggregations |
| `gscDaily` | Daily GSC aggregations |
| `rankDaily` | Daily keyword rankings |
| `backlinksDaily` | Daily backlink metrics |
| `aiReferrerDaily` | Daily AI referrer traffic |
| `aiSources` | Dictionary of AI sources |
| `syncRuns` | Provider sync run history |
| `kpiDailySummary` | Derived daily KPI summary |
| `aiPromptSets` | Brand mention prompt sets |
| `aiPrompts` | Individual prompts |
| `aiBrandEntities` | Brand entity definitions |
| `aiPromptRuns` | Prompt execution records |
| `aiMentions` | Mention analysis results |
| `ga4Data` | GA4 API response cache |
| `gscData` | GSC API response cache |
| `semrushData` | Semrush API response cache |
| `backlinkData` | Backlink API response cache |
| `shareLinks` | Public report share tokens |
| `conversations` | Chat conversation records |
| `messages` | Chat messages |

---

## API Routes

### Authentication
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | — | Register with email/password |
| POST | `/api/auth/login` | — | Login with email/password |
| POST | `/api/auth/logout` | ✓ | Destroy session |
| GET | `/api/auth/user` | ✓ | Current user info |
| POST | `/api/auth/forgot-password` | — | Send reset email |
| POST | `/api/auth/reset-password` | — | Reset via token |

### Google OAuth
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/auth/google/login` | — | Start OAuth (login/signup flow) — creates or finds user |
| GET | `/api/auth/google/connect` | ✓ | Start OAuth (connect to existing account) |
| GET | `/api/auth/google/callback` | — | Shared callback — handles both flows via session `oauthFlow` |
| GET | `/api/google/account` | ✓ | Connected email + GA4 properties + GSC sites |
| DELETE | `/api/google/disconnect` | ✓ | Remove stored OAuth tokens |

### Metrics — GA4
| Method | Path | Key Params |
|--------|------|-----------|
| GET | `/api/metrics/overview` | propertyId, domain, start, end |
| GET | `/api/metrics/ga4/traffic` | propertyId, start, end |
| GET | `/api/metrics/ga4/top-pages-extended` | propertyId, start, end, limit |
| GET | `/api/metrics/traffic-trend` | propertyId, start, end |
| GET | `/api/metrics/top-pages` | propertyId, start, end |

### Metrics — GSC
| Method | Path | Key Params |
|--------|------|-----------|
| GET | `/api/metrics/gsc/summary` | siteUrl, start, end |
| GET | `/api/metrics/gsc/top-keywords` | siteUrl, start, end |
| GET | `/api/metrics/gsc/queries` | siteUrl, start, end |
| GET | `/api/metrics/gsc/pages` | siteUrl, start, end |
| GET | `/api/metrics/gsc/rankings` | siteUrl, start, end |
| GET | `/api/metrics/gsc/monthly` | siteUrl, year |

### Other Metrics
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/metrics/rankings` | Keyword rankings |
| GET | `/api/metrics/backlinks` | Backlink metrics |
| GET | `/api/metrics/ai-referrers` | Traffic from AI sources |
| GET | `/api/backlinks` | Full backlinks list |
| GET | `/api/backlinks-summary` | Backlinks summary |

### Status & Config
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/google/status` | Service account credentials status |
| GET | `/api/semrush/status` | Semrush API status |
| GET | `/api/dataforseo/status` | DataForSEO API status |
| GET | `/api/gsc/sites` | List GSC sites accessible via service account |
| GET | `/api/health` | Health check |
| GET | `/api/diagnostics` | Full diagnostics |

### Sync / Cache
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sync/status` | Cache status for all providers |
| POST | `/api/sync/:provider` | Clear provider cache (ga4, gsc, semrush, dataforseo) |
| POST | `/api/sync/all` | Clear all caches |

### Reporting
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/report-data` | Assembled report payload |
| POST | `/api/generate-pdf` | Generate & download PDF report |
| GET | `/api/share-links` | List share links |
| POST | `/api/share-links` | Create share link |
| GET | `/api/share/:token` | Access shared report |

### AI Mentions
| Method | Path | Description |
|--------|------|-------------|
| GET/POST/PUT/DELETE | `/api/ai-mentions/prompt-sets` | Manage prompt sets |
| GET/POST/PUT/DELETE | `/api/ai-mentions/prompts` | Manage prompts |
| GET/POST/PUT/DELETE | `/api/ai-mentions/brand-entities` | Manage brand entities |
| POST | `/api/ai-mentions/run` | Execute prompt runs |
| GET | `/api/ai-mentions/results/:id` | Mention results |
| GET | `/api/ai-mentions/stats/:id` | Mention statistics |

---

## Frontend Pages & Hooks

### Dashboard Pages

| Page | Route | Data Sources | Date Range |
|------|-------|-------------|-----------|
| Executive Overview | `/dashboard` | GA4 + GSC + DataForSEO | default: last 30d → yesterday |
| Traffic | `/traffic` | GA4 | default: last 30d → yesterday |
| GA4 Traffic | `/ga4-traffic` | GA4 | default: last 30d → yesterday |
| GSC Explorer | `/gsc-explorer` | GSC | default: last 30d → yesterday |
| Rankings | `/rankings` | GSC + DataForSEO | default: last 30d → yesterday |
| Backlinks | `/backlinks` | DataForSEO | default: last 30d → yesterday |
| AI Referrers | `/ai-referrers` | GA4 | default: last 30d → yesterday |
| AI Mentions | `/ai-mentions` | OpenAI | — |
| Report Preview | `/report-preview` | All sources | default: last 30d → yesterday |
| Exports | `/exports` | All sources | default: last 30d → yesterday |
| Settings | `/settings` | — | — |

> All date pickers restrict selection to **yesterday** as the maximum date (today's data is still processing in GSC/GA4). Default end date is always `subDays(new Date(), 1)`.

### Executive Overview — Top Pages columns

`Page | Pageviews | Users | Avg. Time on Page | Sessions | Engagement Rate`

> Note: GA4 does not have an `entrances` metric (UA concept). Replaced with `sessions`.

### Rankings Page Features

- GSC keyword table with position, clicks, impressions, CTR
- All 4 metrics show change vs. previous period (clicksDelta, impressionsDelta, ctrDelta, change)
- Working client-side filter: keyword text search + position range (1-10, 11-20, 21-50, 51+)
- Bar chart: top 10 keywords by clicks + impressions

### Settings Page — Google Account Section

- "Sign in with Google" button → `/api/auth/google/connect`
- On connection: shows connected email + clickable list of GA4 properties + GSC sites
- Clicking a property/site auto-fills the `ga4PropertyId` / `gscSiteUrl` in localStorage
- Disconnect button

### Key Hooks

| Hook | Purpose | Storage |
|------|---------|---------|
| `use-auth.ts` | User auth state, logout | Server session |
| `use-domain.tsx` | Domain, GA4 property ID, GSC site URL | localStorage |
| `use-toast.ts` | Toast notifications | In-memory |
| `use-mobile.tsx` | Viewport detection | — |

---

## Environment Variables

| Key | Purpose |
|-----|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Express session signing secret |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Service account JSON for GA4/GSC (server-to-server auth) |
| `GOOGLE_CLOUD_JSON` | OAuth2 web client credentials JSON (from Cloud Console download) — **authoritative** |
| `GOOGLE_CLIENT_ID` | OAuth2 client ID (synced from `GOOGLE_CLOUD_JSON`) |
| `GOOGLE_CLIENT_SECRET` | OAuth2 client secret (synced from `GOOGLE_CLOUD_JSON`) |
| `GOOGLE_REDIRECT_URI` | OAuth2 callback URL — `http://localhost:5000/api/auth/google/callback` |
| `SEMRUSH_API_KEY` | Semrush API key |
| `DATAFORSEO_LOGIN` | DataForSEO username |
| `DATAFORSEO_PASSWORD` | DataForSEO password |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | OpenAI API key (AI mentions) |
| `RESEND_API_KEY` | Resend email API key |
| `PORT` | Server port (default 5000) |

> `GOOGLE_CLOUD_JSON` takes precedence over individual `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` in `server/lib/google-oauth.ts`.

---

## External Integrations

### Google Analytics 4 (GA4)
- **Auth**: Service account JSON via `GOOGLE_SERVICE_ACCOUNT_JSON`
- **Client**: `@googleapis/analyticsdata` v1beta
- **Key functions** (`server/lib/google-apis.ts`):
  - `getGA4Summary` — sessions, users, pageviews
  - `getGA4TrafficMetrics` — organic traffic breakdown
  - `getGA4TopPagesExtended` — top pages with sessions, engagement time, engagement rate
  - `getGA4DailyTraffic` — day-by-day traffic for trend charts

### Google Search Console (GSC)
- **Auth**: Service account JSON via `GOOGLE_SERVICE_ACCOUNT_JSON`
- **Client**: `@googleapis/searchconsole` v1
- **Key functions** (`server/lib/google-apis.ts`):
  - `getGSCSummary` — clicks, impressions, CTR, position
  - `getGSCTopKeywords` — top queries with `dataState: "all"` (includes last 3 days)
  - `getGSCTable` — full GSC table with `dataState: "all"`
  - `getGSCRankings` — keyword rankings with previous-period deltas (all 4 metrics)

### Semrush
- Rankings, domain overview, backlinks

### DataForSEO
- Backlinks, SERP data, keyword data, referring domains

### OpenAI
- AI brand mention tracking and narrative generation

### Resend
- Password reset emails

---

## Authentication System

### Email / Password
- Bcrypt (10 rounds) password hashing
- express-session stored in PostgreSQL (`sessions` table)
- 7-day cookie, httpOnly, sameSite=lax
- Password reset via 32-byte random token (1-hour expiry), email via Resend

### Google OAuth2
See [Google OAuth Flow](#google-oauth-flow) below.

---

## Google OAuth Flow

### Login / Sign-up Flow (unauthenticated)

```
User clicks "Sign in with Google"
    ↓
GET /api/auth/google/login
    → stores nonce in session, oauthFlow = "login"
    → redirects to Google consent screen
        (scopes: analytics.readonly, webmasters.readonly, userinfo.email, userinfo.profile)
    ↓
Google redirects to GET /api/auth/google/callback?code=...&state=NONCE
    → validates state === session.oauthNonce
    → exchanges code for tokens
    → fetches Google user info (email, name, picture)
    → finds existing user by email OR creates new user
    → saves tokens to google_oauth_tokens table
    → sets req.session.userId
    → redirects to /dashboard
```

### Connect Flow (authenticated, Settings page)

```
Logged-in user clicks "Sign in with Google" in Settings
    ↓
GET /api/auth/google/connect  (requires isAuthenticated)
    → stores nonce in session, oauthFlow = "connect"
    → redirects to Google consent screen
    ↓
GET /api/auth/google/callback
    → validates nonce
    → saves/updates tokens in google_oauth_tokens (upsert by userId)
    → redirects to /settings?google=connected
```

### Post-Connection: Property Discovery

After connecting, `GET /api/google/account` returns:
- `googleEmail` — connected Google account
- `ga4Properties[]` — `{ id, displayName, accountDisplayName }` from Analytics Admin API
- `gscSites[]` — `{ siteUrl, permissionLevel }` from Search Console API

Token auto-refresh: `client.on("tokens", ...)` updates `google_oauth_tokens` table when Google refreshes access tokens.

### Credential Priority (`server/lib/google-oauth.ts`)
1. `GOOGLE_CLOUD_JSON` — parses `web.client_id`, `web.client_secret`, `web.redirect_uris[0]`
2. Fallback: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` env vars

### Required Google Cloud Console Setup
- Authorized redirect URI: `http://localhost:5000/api/auth/google/callback`
- APIs enabled: Google Analytics Data API, Google Analytics Admin API, Google Search Console API, Google OAuth2 API

---

## Key Design Decisions

### GSC Data State
All GSC queries use `dataState: "all"` (not `"final"`) to include the most recent 2-3 days of data, matching what users see in the GSC dashboard.

### Date Range Defaults
All pages default to `from: subDays(new Date(), 29), to: subDays(new Date(), 1)`. Today is excluded because GSC and GA4 data for the current day is still processing.

### Property Configuration
GA4 property ID and GSC site URL are stored in **browser localStorage** (not per-user in the database). This means settings are browser-specific. The Settings page provides both manual input fields and auto-discovery via Google OAuth.

### GSC Rankings — Delta Calculation
Previous period is fetched separately (same duration, shifted back). Deltas:
- `change = previousPosition - currentPosition` (positive = improved)
- `clicksDelta = currentClicks - previousClicks`
- `impressionsDelta = currentImpressions - previousImpressions`
- `ctrDelta = currentCTR - previousCTR`

### Removed Features
- **Conversions column**: Removed from executive overview, PDF report, and report preview (GA4 conversions setup varies per property and is unreliable without explicit goal configuration)
- **"Report at a Glance" chart**: Removed from report preview (data availability issues)
- **"Keyword Position Distribution" pie chart**: Removed from report preview (no position data available)

### GA4 `entrances` Metric
`entrances` does not exist in GA4 Data API (it was a Universal Analytics concept). The executive overview top pages table uses `sessions` instead.

---

## Known Constraints

| Constraint | Detail |
|-----------|--------|
| Google OAuth redirect URI | Must be registered in Google Cloud Console. Currently: `http://localhost:5000/api/auth/google/callback` |
| Service account access | For GA4/GSC data via service account, the service account email (`seo-reporting-agent@truefirms-428811.iam.gserviceaccount.com`) must be added to each property as a viewer |
| localStorage settings | Domain, GA4 property ID, and GSC site URL are per-browser. Clearing localStorage resets them |
| PDF generation | PDFKit runs server-side. Large reports may be slow |
| DataForSEO | Some endpoints have rate limits and return cached/estimated data |
| GSC data lag | GSC data is typically 2-3 days behind real-time. Using `dataState: "all"` mitigates this but data for the last 2-3 days may be incomplete |
| AI mentions | Requires OpenAI API key. Prompt runs are billed per token |
