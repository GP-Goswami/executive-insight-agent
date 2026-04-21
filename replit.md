# Executive Reporting Dashboard

## Overview

This is an enterprise-grade executive reporting dashboard that consolidates multi-source analytics data (GA4, Google Search Console, SEMrush, DataForSEO, backlink data) into a unified, role-based reporting layer. The application follows an "Ultra AI Dashboard" aesthetic with a dark mode enterprise theme featuring neon cyan/purple accents and glassy UI elements.

The core purpose is to transform operational data into concise, role-based narratives for executives and clients, with features including:
- Consolidated KPI dashboards with date range filtering
- AI traffic tracking (ChatGPT, Gemini, Perplexity referrers)
- Search Console and rankings exploration
- PDF exports and shareable report links
- Role-based access control (Admin, Internal, Client)

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight React router)
- **State Management**: TanStack React Query for server state
- **Styling**: Tailwind CSS with custom dark mode theme, CSS variables for theming
- **Component Library**: shadcn/ui (Radix UI primitives with custom styling)
- **Charts**: Recharts for data visualization
- **Build Tool**: Vite with React plugin

The frontend follows a page-based structure under `client/src/pages/` with reusable dashboard components in `client/src/components/dashboard/`. The design system enforces the "Ultra AI Dashboard" aesthetic with custom glow effects, gradient backgrounds, and glassy card components.

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript (ES modules)
- **API Pattern**: RESTful endpoints under `/api/` prefix
- **Authentication**: Custom email/password authentication with bcrypt password hashing
- **Session Storage**: PostgreSQL-backed sessions via connect-pg-simple

Routes are registered in `server/routes.ts` with authentication middleware. The storage layer (`server/storage.ts`) provides a data access abstraction over Drizzle ORM.

### Data Storage
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM with Zod schema validation
- **Schema Location**: `shared/schema.ts` for shared types, `shared/models/auth.ts` for auth tables
- **Migrations**: Drizzle Kit with migrations output to `./migrations`

Key database entities include:
- Clients and Properties (multi-tenant structure)
- Daily metrics tables: GA4, GSC, Rankings, Backlinks, AI Referrers
- KPI summary aggregations
- Share links for report distribution
- Sessions and Users for authentication

### Authentication Flow
- Custom email/password authentication with bcrypt password hashing
- Session-based auth with PostgreSQL session store
- User data stored in `users` table
- Protected routes use `isAuthenticated` middleware
- Sign In and Sign Up pages at `/sign-in` and `/sign-up`

### Build System
- Development: Vite dev server with HMR, proxied through Express
- Production: Vite builds static assets to `dist/public`, esbuild bundles server to `dist/index.cjs`
- TypeScript configured with path aliases (`@/` for client, `@shared/` for shared code)

## External Dependencies

### Database
- PostgreSQL (required, connection via `DATABASE_URL` environment variable)

### Authentication
- Custom session-based auth (`SESSION_SECRET` environment variable required in production)

### Frontend Libraries
- Radix UI primitives for accessible components
- Recharts for charting
- date-fns for date manipulation
- react-day-picker for calendar components
- embla-carousel-react for carousels
- vaul for drawer components

### Backend Libraries
- express-session with connect-pg-simple for session management
- bcryptjs for password hashing
- drizzle-orm with pg driver for database access

### Data Source Integrations
The application integrates with:
- Google Analytics 4 API (`GOOGLE_SERVICE_ACCOUNT_JSON`)
- Google Search Console API (`GOOGLE_SERVICE_ACCOUNT_JSON`)
- SEMrush API (`SEMRUSH_API_KEY`)
- DataForSEO API (`DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`)

These integrations are configured in the Settings page and provide real-time data when API credentials are available.

### API Data Flow Details
- **GA4**: Date-filtered via `runReport` dateRanges parameter. PropertyId resolved via session → in-memory cache → database lookup chain.
- **GSC**: Date-filtered with country/device dimension filters via `dimensionFilterGroups`.
- **SEMrush `domain_organic`**: Used to count total organic keywords (aggregated from individual keyword rows).
- **SEMrush `domain_rank`**: Snapshot API - returns organic traffic cost (used alongside domain_organic).
- **SEMrush `backlinks_overview`**: Currently broken (returns "query type not found").
- **DataForSEO `backlinks/summary/live`**: Primary source for backlinks/referring domains. Snapshot API.
- **Backlinks fallback chain**: DataForSEO → SEMrush → returns 0 (not null/"-").
- All metrics endpoints include `Cache-Control: no-store` headers and `_debug` objects showing data sources.
- Debug logging enabled via `DEBUG=true` environment variable.

### Data Normalization Engine
- **Module**: `server/lib/normalization-engine.ts` — Converts raw `AggregatedDataset` into structured, context-aware `NormalizedData`.
- **Function**: `normalizeData(data: AggregatedDataset): NormalizedData` — Deterministic, no AI.
- **Traffic Normalization**: currentUsers, previousUsers, currentSessions, growthRate, trend (`up`/`down`/`flat` with ±2% thresholds).
- **Search Normalization**: clicks, impressions, ctr, avgPosition, ctrBenchmark (5%), ctrPerformance (`good`/`average`/`poor`).
- **Keyword Normalization**: total, top10, improved, declined, top10Ratio, netGrowth, trend (`improving`/`declining`/`stable`).
- **Data Quality Flags**: `hasTraffic`, `hasSearch`, `hasKeywords` — booleans indicating data presence.
- **Safety**: All values use `safeNum` (null/undefined/NaN safe), `safeDivide` (no division by zero), `round2` (2 decimal places).

### SEO Metrics Engine
- **Module**: `server/lib/seo-metrics.ts` — Pure computation module that takes normalized data and computes enterprise-level SEO metrics.
- **Function**: `computeSeoMetrics(normalized: NormalizedData): SeoMetrics` — Consumes `NormalizedData` (not raw `AggregatedDataset`). Deterministic, formula-based calculations with no AI.
- **Data Aggregation**: `storage.getAggregatedSeoData()` in `server/storage.ts` — Aggregates GA4, GSC, and Rankings data from the database with optional previous-period comparison.
- **Test Endpoint**: `GET /api/seo-metrics-test?propertyId=X&days=30` — Authenticated endpoint that aggregates data and returns both raw and computed metrics.
- **Computed Metrics**: Traffic growth rate, weighted CTR, CTR gap (uses normalized ctrBenchmark), top-10 keyword percentage, net keyword growth, page-2 opportunity detection, low-CTR opportunity flagging.
- **Safety**: All calculations derive from pre-normalized values. Outputs rounded to 2 decimal places.

### Insight Engine
- **Module**: `server/lib/insight-engine.ts` — Rule-based engine that converts normalized data into actionable insights.
- **Function**: `generateInsights(normalized: NormalizedData): Insight[]` — Operates exclusively on `NormalizedData`. No raw metric dependency.
- **Test Endpoint**: `GET /api/insights-test?propertyId=X&days=30` — Returns computed metrics and generated insights.
- **Insight Types**: positive, warning, neutral.
- **Insight Categories**: traffic, keywords, ctr, opportunity, correlation, data-quality.
- **Insight Coverage**:
  - **Trend**: Traffic trend (up/down/flat with growth %), keyword trend (improving/declining/stable with net growth)
  - **Benchmark**: CTR performance vs benchmark (good/average/poor with specific values)
  - **Correlation**: Traffic + keyword alignment/conflict detection (4 combinations)
  - **Opportunity**: Page 2 ranking opportunity, low-CTR high-impression opportunity with estimated click gain
  - **Data Quality**: Missing search, keyword, or traffic data alerts

### Analytics Pipeline Flow
`AggregatedDataset → normalizeData() → computeSeoMetrics() → generateInsights() → generateNarrative()`

### AI Narrative Generator
- **Module**: `server/lib/ai-narrative.ts` — Controlled AI layer that converts structured insights into executive summaries.
- **Function**: `generateNarrative(insights: Insight[]): Promise<string>` — Uses OpenAI (gpt-4o-mini, temperature 0.3) with strict prompting.
- **Test Endpoint**: `GET /api/ai-summary-test?propertyId=X&days=30` — Full pipeline: aggregation → metrics → insights → AI narrative.
- **Controls**: AI is strictly constrained to only use provided insights. No hallucination, no assumptions, no bullet points. Output is a 4–6 sentence executive paragraph.

### PDF Reporting System (Enterprise Grade)
- **Generator**: `server/lib/pdf-generator.ts` — Professional PDF using PDFKit with dark blue/slate palette. Structure: header with accent bar → 6 KPI cards (Users, Sessions, Clicks, Impressions, CTR, Avg Position) → executive summary (blue left accent bar) → key insights grouped as Risks/Opportunities/Observations → What Changed deltas → top pages table → trend analysis chart → data quality note. Page footer with domain and page numbers on every page.
- **Text Sanitizer**: `sanitize()` function strips non-ASCII characters (smart quotes → straight quotes, em dash → --, ellipsis → ..., bullets → -) for safe Helvetica rendering in PDFKit. Applied to all dynamic text: summary, domain, page paths, date ranges, insight messages.
- **Data Accuracy**: CTR and Avg Position show "N/A" with "Insufficient data" subtitle when impressions = 0. CTR vs Benchmark row omitted when search data is unavailable.
- **Blank Page Prevention**: `ensureSpace()` called before every section/row. No unconditional `addPage()` calls. Footer only stamped on pages with content via `bufferPages` mode.
- **Charts**: Line charts drawn via PDFKit vector primitives (moveTo/lineTo/stroke). Fallback: "Not enough data to display trend" when no chart data.
- **API Route**: `POST /api/generate-pdf` — Full pipeline: GA4 ID → aggregation + daily trends + keyword distribution + GSC top pages → normalize → metrics → insights → AI summary → PDF. Returns binary PDF.
- **Data Route**: `GET /api/report-data?propertyId=X&start=YYYY-MM-DD&end=YYYY-MM-DD` — Returns all report data as JSON including `dailyTrends`, `keywordDistribution`, `topPagesSource`, `aiReferrers`, `missingData`. Accepts `start`/`end` date params or `days` fallback.
- **Preview Page**: `/dashboard/report-preview` — Matches PDF structure exactly. Includes DateRangePicker with presets (7d/14d/28d/30d/90d/Last Month/Custom) and Apply button. AI Traffic Sources section shows AI referrers (ChatGPT, Gemini, Perplexity, etc.) with users/sessions. Regenerate + Download PDF buttons. Chart fallback message when no data. Professional muted styling matching PDF palette.
- **Live GSC Data**: Both report-data and PDF endpoints fetch GSC summary metrics (clicks, impressions, CTR, avg position) directly from the Google Search Console API, always preferring live data over database aggregates. Top pages also fetched live from GSC.
- **Storage Methods**: `getDailyTrends()`, `getKeywordDistribution()`, `getGscTopPages()` added to `IStorage` and `DatabaseStorage`.
- **Filename Format**: `{domain}-seo-report-{month}-{year}.pdf`.
