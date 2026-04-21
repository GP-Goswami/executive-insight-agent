# Executive Reporting Dashboard - Project Workflow

## Project Overview

An enterprise-grade SEO analytics dashboard that consolidates data from Google Analytics 4, Google Search Console, SEMrush, and DataForSEO into a unified reporting layer. The system transforms multi-source operational data into concise, role-based narratives for executives and clients, delivering clear, timely, and actionable insights.

---

## System Architecture

```
Frontend (React + Vite)
    |
    v
Express API Server (Node.js / TypeScript)
    |
    +---> Google Analytics 4 API
    +---> Google Search Console API
    +---> SEMrush API
    +---> DataForSEO API
    +---> OpenAI API (GPT-4o-mini)
    |
    v
PostgreSQL Database (Drizzle ORM)
```

---

## Authentication Flow

```
User visits /sign-in or /sign-up
    |
    v
POST /api/auth/login or /api/auth/register
    |
    v
Password verified with bcrypt --> Session created (PostgreSQL-backed)
    |
    v
Session cookie set (connect.sid, httpOnly, 7-day expiry)
    |
    v
Redirect to /dashboard
    |
    v
All /api/* routes protected by isAuthenticated middleware
```

- Session storage: PostgreSQL via `connect-pg-simple`
- Password recovery: Email-based reset flow using Resend
- Roles defined (Admin, Internal, Client) for future role-based access control

---

## Data Source Integrations

| Source | Module | Data Provided | Auth |
|--------|--------|---------------|------|
| Google Analytics 4 | `server/lib/google-apis.ts` | Users, Sessions, Conversions, AI Referrers, Top Pages | Service Account JSON |
| Google Search Console | `server/lib/google-apis.ts` | Clicks, Impressions, CTR, Avg Position, Top Queries, Top Pages | Service Account JSON |
| SEMrush | `server/lib/semrush.ts` | Organic Keywords, Traffic Cost, Keyword Rankings, Backlinks | API Key |
| DataForSEO | `server/lib/dataforseo.ts` | SERP Results, Search Volume, Backlinks (fallback) | Login + Password |
| OpenAI | `server/lib/ai-narrative.ts` | Executive Summaries, AI Mention Analysis | API Key |

---

## Core Analytics Pipeline

The reporting system follows a four-layer pipeline:

```
Layer 1: Data Aggregation
    Raw data from GA4, GSC, SEMrush, DataForSEO
    + Live API calls for real-time GSC metrics
    |
    v
Layer 2: Normalization Engine (server/lib/normalization-engine.ts)
    KPI standardization, trend calculation, data quality flags
    |
    v
Layer 3: Metrics + Insight Engine
    SEO Metrics (server/lib/seo-metrics.ts)
    Rule-Based Insights (server/lib/insight-engine.ts)
    |
    v
Layer 4: AI Narrative Generator (server/lib/ai-narrative.ts)
    Executive summary via GPT-4o-mini
    |
    v
Output: Report Preview + PDF Export
```

### Layer 1: Data Aggregation

- **Database aggregation**: `storage.getAggregatedSeoData()` pulls historical data from `ga4_daily_metrics`, `gsc_daily`, and `rank_daily` tables
- **Live GSC override**: Fetches real-time clicks/impressions/CTR/position from Google Search Console API, always preferring live data over database values
- **AI referrer detection**: Filters GA4 traffic sources against known AI patterns (ChatGPT, Gemini, Perplexity, Claude, Copilot, etc.)

### Layer 2: Normalization Engine

**Module**: `server/lib/normalization-engine.ts`
**Function**: `normalizeData(data: AggregatedDataset): NormalizedData`

- **Traffic**: currentUsers, previousUsers, sessions, growthRate, trend (up/down/flat with +/-2% thresholds)
- **Search**: clicks, impressions, ctr, avgPosition, ctrBenchmark (5%), ctrPerformance (good/average/poor)
- **Keywords**: total, top10, improved, declined, top10Ratio, netGrowth, trend (improving/declining/stable)
- **Data Quality Flags**: hasTraffic, hasSearch, hasKeywords (booleans for conditional rendering)
- **Safety**: `safeNum()` handles null/undefined/NaN, `safeDivide()` prevents division by zero

### Layer 3: Metrics + Insight Engine

**SEO Metrics** (`server/lib/seo-metrics.ts`):
- Traffic growth rate calculation
- Weighted CTR computation
- CTR gap analysis (vs 5% benchmark)
- Top-10 keyword percentage
- Page 2 opportunity detection
- Low-CTR high-impression opportunity flagging

**Insight Engine** (`server/lib/insight-engine.ts`):
- Rule-based, deterministic (no AI)
- Generates structured insights: type (positive/warning/neutral), category (traffic/keywords/ctr/opportunity/correlation/data-quality)
- Detects: trend direction, benchmark performance, traffic-keyword correlation/conflict, ranking opportunities, data quality gaps

### Layer 4: AI Narrative Generator

**Module**: `server/lib/ai-narrative.ts`
- Model: GPT-4o-mini, temperature 0.3
- Strict system prompt: no speculation, no hedging, no bullet points
- Output: 4-6 sentence executive paragraph
- Arc: Dominant Signal -> Supporting Context -> Key Risk/Opportunity -> Forward Implication

---

## Dashboard Pages

### Analytics Section

| Page | Route | Purpose |
|------|-------|---------|
| Executive Overview | `/dashboard` | High-level KPI dashboard with date range filtering. Shows organic traffic, keywords, backlinks, referring domains, sessions, cost value, and top landing pages. |
| AI Referrers | `/dashboard/ai-referrers` | Tracks traffic from AI platforms (ChatGPT, Gemini, Perplexity, Copilot, Claude). Shows users, sessions, duration, bounce rate per source. |
| AI Mentions | `/dashboard/ai-mentions` | Measures brand visibility in AI responses. Prompt set management, brand entity configuration, coverage percentage, mention scores. |
| Search Console | `/dashboard/gsc` | Detailed GSC data explorer. Tabs for Queries and Pages. Filtering by query, page, country, device. |
| Rankings | `/dashboard/rankings` | Keyword position tracking. Toggle between GSC (live) and SEMrush (comprehensive) data. Shows position changes, search volume. |
| Backlinks | `/dashboard/backlinks` | Link profile monitoring. Total backlinks, referring domains, anchor text, link types. Uses SEMrush/DataForSEO. |

### System Section

| Page | Route | Purpose |
|------|-------|---------|
| Report Preview | `/dashboard/report-preview` | Full report preview matching PDF structure. Date range picker (7d/14d/28d/30d/90d/Last Month/Custom). Includes KPIs, executive summary, insights, top pages, AI traffic sources, trend charts. Regenerate and Download PDF buttons. |
| Exports | `/dashboard/exports` | Historical report retrieval and download. |
| Settings | `/dashboard/settings` | Domain configuration, GA4 Property ID, GSC Site URL, API status checks, manual data sync triggers, user profile management. |

---

## Report Generation Workflow

### Report Preview (Web)

```
User navigates to /dashboard/report-preview
    |
    v
Selects date range via DateRangePicker (presets or custom)
    |
    v
Clicks "Apply"
    |
    v
GET /api/report-data?propertyId=X&start=YYYY-MM-DD&end=YYYY-MM-DD
    |
    v
Server runs full pipeline:
    1. Aggregate data from database
    2. Fetch live GSC metrics from API (override DB values)
    3. Fetch live GSC top pages from API
    4. Fetch AI referrer data from GA4 API
    5. Normalize -> Compute metrics -> Generate insights
    6. Generate AI executive summary via OpenAI
    |
    v
Returns JSON with: metrics, insights, summary, topPages, aiReferrers, dailyTrends, missingData
    |
    v
Frontend renders full report with interactive charts
```

### PDF Export

```
User clicks "Download PDF" on report preview
    |
    v
POST /api/generate-pdf (same date range as preview)
    |
    v
Server runs same pipeline as report preview
    |
    v
PDFKit generates professional A4 PDF:
    - Title block with domain and date range
    - 6 KPI cards (Users, Sessions, Clicks, Impressions, CTR, Avg Position)
    - Executive Summary (blue accent bar)
    - Key Insights (Risks / Opportunities / Observations)
    - What Changed (delta rows)
    - Top Pages table (GSC or GA4 fallback)
    - AI Traffic Sources table
    - Trend Analysis chart (line chart via vector primitives)
    - Data Availability note
    |
    v
Returns binary PDF for download
Filename: {domain}-seo-report-{month}-{year}.pdf
```

---

## AI Mentions Workflow

```
User creates Prompt Set with brand entity + competitor names
    |
    v
User clicks "Run Now"
    |
    v
System sends prompts to OpenAI (GPT-4o)
    |
    v
AI analyzes each response for brand mentions:
    - Position in response
    - Sentiment analysis
    - Recommendation presence
    - Competitor co-occurrence
    |
    v
Calculates Mention Score (0-100)
    |
    v
Stores results with context snippets
    |
    v
Dashboard shows: Coverage %, Avg Score, Total Mentions, Competitor Analysis
```

---

## Data Sync Workflow

```
User navigates to Settings -> Data Sources
    |
    v
Clicks "Sync" for desired provider (GA4, GSC, SEMrush)
    |
    v
Server fetches data from external API for configured date range
    |
    v
Data persisted to daily metrics tables:
    - ga4_daily_metrics (users, sessions, pageviews, landing pages)
    - gsc_daily (clicks, impressions, ctr, position, queries)
    - rank_daily (keyword positions from SEMrush)
    - ai_referrer_daily (AI traffic by source)
    - backlink_daily (backlinks, referring domains)
    |
    v
Sync status updated with timestamp
    |
    v
Sidebar sync indicators update (green = synced, red = failed)
```

---

## Data Fallback Chain

| Metric | Primary Source | Fallback |
|--------|---------------|----------|
| Clicks/Impressions/CTR/Position | Live GSC API | Database (gsc_daily) |
| Top Pages | Live GSC API (page dimension) | GA4 session data |
| Backlinks | DataForSEO | SEMrush -> Returns 0 |
| Keywords | SEMrush domain_organic | GSC query data |
| AI Referrers | Live GA4 API | Database (ai_referrer_daily) |

---

## Key Technical Files

### Backend
| File | Purpose |
|------|---------|
| `server/routes.ts` | All API endpoint definitions |
| `server/storage.ts` | Database access layer (IStorage interface + DatabaseStorage) |
| `server/lib/google-apis.ts` | GA4 + GSC API clients |
| `server/lib/semrush.ts` | SEMrush API client |
| `server/lib/dataforseo.ts` | DataForSEO API client |
| `server/lib/normalization-engine.ts` | Data normalization (Layer 2) |
| `server/lib/seo-metrics.ts` | Metric computation (Layer 3) |
| `server/lib/insight-engine.ts` | Rule-based insights (Layer 3) |
| `server/lib/ai-narrative.ts` | AI summary generation (Layer 4) |
| `server/lib/ai-mentions.ts` | AI brand mention tracking |
| `server/lib/pdf-generator.ts` | PDF report generation |
| `server/lib/auth.ts` | Authentication + session management |

### Frontend
| File | Purpose |
|------|---------|
| `client/src/App.tsx` | Root routing + auth guards |
| `client/src/components/app-sidebar.tsx` | Navigation sidebar |
| `client/src/pages/dashboard/executive-overview.tsx` | Main dashboard |
| `client/src/pages/dashboard/report-preview.tsx` | Report preview + date picker |
| `client/src/pages/dashboard/ai-referrers.tsx` | AI traffic explorer |
| `client/src/pages/dashboard/ai-mentions.tsx` | AI mention tracking |
| `client/src/pages/dashboard/gsc.tsx` | Search Console explorer |
| `client/src/pages/dashboard/rankings.tsx` | Rankings explorer |
| `client/src/pages/dashboard/backlinks.tsx` | Backlinks explorer |
| `client/src/pages/dashboard/settings.tsx` | Configuration page |
| `client/src/components/dashboard/date-range-picker.tsx` | Date range picker component |
| `client/src/hooks/use-domain.ts` | Domain context hook |

### Shared
| File | Purpose |
|------|---------|
| `shared/schema.ts` | Database schema + Zod types |
| `shared/models/auth.ts` | Auth-related table definitions |

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Express session encryption key |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Google APIs (GA4 + GSC) credentials |
| `SEMRUSH_API_KEY` | SEMrush API access |
| `DATAFORSEO_LOGIN` | DataForSEO username |
| `DATAFORSEO_PASSWORD` | DataForSEO password |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | OpenAI API key (narratives + mentions) |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | OpenAI API endpoint |
| `RESEND_API_KEY` | Email delivery (password reset) |
| `DEBUG` | Enable detailed API logging |

---

## Development

- **Start**: `npm run dev` (Express + Vite dev server on port 5000)
- **Build**: Vite builds frontend to `dist/public`, esbuild bundles server to `dist/index.cjs`
- **Database**: Drizzle Kit migrations in `./migrations`
- **Theme**: Dark mode enterprise theme with neon cyan/purple accents
