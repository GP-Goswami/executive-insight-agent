  # Executive Reporting Dashboard — Project Documentation
  
  ## 1. Overview
  
  The Executive Reporting Dashboard is an enterprise-grade SEO analytics platform that consolidates data from multiple sources — Google Analytics 4, Google Search Console, SEMrush, and DataForSEO — into a unified reporting layer. It transforms raw operational data into concise, role-based executive narratives and actionable insights.
  
  ### Key Features
  
  - Consolidated KPI dashboards with date range filtering
  - AI traffic tracking (ChatGPT, Gemini, Perplexity referrers)
  - Google Search Console and rankings exploration
  - Backlinks monitoring and analysis
  - AI Mentions analysis (brand visibility in LLM responses)
  - PDF exports and shareable report links
  - Role-based access control (Admin, Internal, Client)
  - Enterprise SEO Metrics Engine with rule-based insights
  - AI-powered executive summary generation
  
  ---
  
  ## 2. System Architecture
  
  ### 2.1 Frontend
  
  | Component         | Technology                                      |
  | ----------------- | ----------------------------------------------- |
  | Framework         | React 18 with TypeScript                        |
  | Routing           | Wouter (lightweight React router)               |
  | State Management  | TanStack React Query v5                         |
  | Styling           | Tailwind CSS with custom dark mode theme        |
  | Component Library | shadcn/ui (Radix UI primitives)                 |
  | Charts            | Recharts                                        |
  | Build Tool        | Vite with React plugin                          |
  
  **Design System**: "Ultra AI Dashboard" aesthetic — dark mode enterprise theme with neon cyan/purple accents, custom glow effects, gradient backgrounds, and glassy card components.
  
  ### 2.2 Backend
  
  | Component         | Technology                                      |
  | ----------------- | ----------------------------------------------- |
  | Runtime           | Node.js with Express                            |
  | Language          | TypeScript (ES modules)                         |
  | API Pattern       | RESTful endpoints under `/api/` prefix          |
  | Authentication    | Custom email/password with bcrypt               |
  | Session Storage   | PostgreSQL-backed via connect-pg-simple          |
  | Database          | PostgreSQL                                      |
  | ORM               | Drizzle ORM with Zod schema validation          |
  
  ### 2.3 Build System
  
  - **Development**: Vite dev server with HMR, proxied through Express
  - **Production**: Vite builds static assets to `dist/public`, esbuild bundles server to `dist/index.cjs`
  - **Path Aliases**: `@/` for client code, `@shared/` for shared code
  
  ---
  
  ## 3. Project Structure
  
  ```
  ├── client/
  │   └── src/
  │       ├── components/
  │       │   └── dashboard/
  │       │       ├── data-table.tsx
  │       │       ├── date-range-picker.tsx
  │       │       ├── domain-selector.tsx
  │       │       ├── filter-panel.tsx
  │       │       ├── kpi-card.tsx
  │       │       ├── metric-chart.tsx
  │       │       └── status-badge.tsx
  │       └── pages/
  │           ├── auth/
  │           │   ├── sign-in.tsx
  │           │   ├── sign-up.tsx
  │           │   ├── forgot-password.tsx
  │           │   └── reset-password.tsx
  │           ├── dashboard/
  │           │   ├── executive-overview.tsx
  │           │   ├── rankings.tsx
  │           │   ├── gsc-explorer.tsx
  │           │   ├── backlinks.tsx
  │           │   ├── ai-referrers.tsx
  │           │   ├── ai-mentions.tsx
  │           │   ├── exports.tsx
  │           │   └── settings.tsx
  │           ├── landing.tsx
  │           └── not-found.tsx
  ├── server/
  │   ├── routes.ts                  # All API route definitions
  │   ├── storage.ts                 # Data access layer (IStorage interface)
  │   ├── db.ts                      # Database connection
  │   └── lib/
  │       ├── auth.ts                # Authentication logic
  │       ├── google-apis.ts         # GA4 and GSC API integration
  │       ├── semrush.ts             # SEMrush API integration
  │       ├── dataforseo.ts          # DataForSEO API integration
  │       ├── ai-mentions.ts         # AI Mentions analysis (OpenAI)
  │       ├── seo-metrics.ts         # SEO Metrics computation engine
  │       ├── insight-engine.ts      # Rule-based insight generator
  │       ├── ai-narrative.ts        # AI executive summary generator
  │       ├── email.ts               # Email service (Resend)
  │       └── debug.ts               # Debug logging utility
  ├── shared/
  │   ├── schema.ts                  # Database schema and types
  │   └── models/
  │       └── auth.ts                # Auth-related table definitions
  └── migrations/                    # Drizzle Kit migrations
  ```
  
  ---
  
  ## 4. Database Schema
  
  ### Core Tables
  
  | Table              | Purpose                                              |
  | ------------------ | ---------------------------------------------------- |
  | `users`            | User accounts with roles (ADMIN, INTERNAL, CLIENT)   |
  | `sessions`         | Persistent Express sessions                          |
  | `clients`          | Top-level organizational units                       |
  | `properties`       | Websites/domains linked to a client                  |
  
  ### Metrics Tables (Daily Time Series)
  
  | Table               | Key Fields                                                  |
  | ------------------- | ----------------------------------------------------------- |
  | `ga4_daily_metrics`  | date, property_id, total_users, sessions, conversions       |
  | `gsc_daily`          | date, property_id, clicks, impressions, ctr, avg_position   |
  | `rank_daily`         | date, property_id, keyword, position, url                   |
  | `backlinks_daily`    | date, property_id, total_backlinks, referring_domains       |
  | `ai_referrer_daily`  | date, property_id, total_users, source                      |
  | `kpi_daily_summary`  | Aggregated daily KPI snapshots with deltas                  |
  
  ### AI Mentions Tables
  
  | Table              | Purpose                                              |
  | ------------------ | ---------------------------------------------------- |
  | `ai_prompt_sets`   | Groups of prompts for LLM tracking                   |
  | `ai_prompts`       | Individual prompts to run                            |
  | `ai_brand_entities`| Brand names and synonyms for detection               |
  | `ai_prompt_runs`   | Execution logs                                       |
  | `ai_mentions`      | Results and sentiment analysis                       |
  
  ### Infrastructure Tables
  
  | Table              | Purpose                                              |
  | ------------------ | ---------------------------------------------------- |
  | `sync_runs`        | Background data synchronization logs                 |
  | `share_links`      | Tokens for publicly shared dashboard views           |
  
  ---
  
  ## 5. Authentication
  
  - Custom email/password authentication with bcrypt password hashing
  - Session-based auth persisted in PostgreSQL via `connect-pg-simple`
  - Protected routes use `isAuthenticated` middleware
  - User roles: ADMIN, INTERNAL, CLIENT
  - Pages: `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`
  
  ---
  
  ## 6. External Integrations
  
  ### Data Sources
  
  | Service         | Environment Variable(s)             | Purpose                              |
  | --------------- | ----------------------------------- | ------------------------------------ |
  | Google Analytics 4 | `GOOGLE_SERVICE_ACCOUNT_JSON`    | Traffic, sessions, conversions       |
  | Google Search Console | `GOOGLE_SERVICE_ACCOUNT_JSON` | Clicks, impressions, CTR, rankings   |
  | SEMrush         | `SEMRUSH_API_KEY`                   | Organic keywords, traffic cost       |
  | DataForSEO      | `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` | SERP rankings, backlinks      |
  | OpenAI          | `AI_INTEGRATIONS_OPENAI_API_KEY`    | AI Mentions, executive summaries     |
  | Resend          | `RESEND_API_KEY`                    | Password reset emails                |
  
  ### Data Flow
  
  - **GA4**: Date-filtered via `runReport`. PropertyId resolved via session, in-memory cache, then database.
  - **GSC**: Date-filtered with country/device dimension filters.
  - **SEMrush**: `domain_organic` for keyword counts, `domain_rank` for traffic cost.
  - **DataForSEO**: Primary source for backlinks/referring domains.
  - **Backlinks fallback chain**: DataForSEO → SEMrush → returns 0.
  
  ---
  
  ## 7. API Endpoints
  
  ### Authentication
  
  | Method | Endpoint                    | Auth | Description                    |
  | ------ | --------------------------- | ---- | ------------------------------ |
  | POST   | `/api/auth/register`        | No   | Create new account             |
  | POST   | `/api/auth/login`           | No   | Log in                         |
  | POST   | `/api/auth/logout`          | Yes  | Log out                        |
  | GET    | `/api/auth/user`            | Yes  | Get current user               |
  | POST   | `/api/auth/forgot-password` | No   | Request password reset         |
  | POST   | `/api/auth/reset-password`  | No   | Reset password with token      |
  
  ### Core Data
  
  | Method | Endpoint                         | Auth | Description                         |
  | ------ | -------------------------------- | ---- | ----------------------------------- |
  | GET    | `/api/clients`                   | Yes  | List all clients                    |
  | GET    | `/api/clients/:id`               | Yes  | Get single client                   |
  | GET    | `/api/properties`                | Yes  | List properties for a client        |
  | GET    | `/api/metrics/overview`          | Yes  | Aggregated KPI summary              |
  | GET    | `/api/metrics/traffic-trend`     | Yes  | Historical GA4 traffic data         |
  | GET    | `/api/metrics/top-pages`         | Yes  | Top landing pages from GA4          |
  | GET    | `/api/metrics/gsc/queries`       | Yes  | GSC search query data               |
  | GET    | `/api/metrics/gsc/pages`         | Yes  | GSC page performance data           |
  | GET    | `/api/metrics/gsc/rankings`      | Yes  | GSC keyword rankings                |
  | GET    | `/api/metrics/gsc/monthly`       | Yes  | GSC monthly aggregation             |
  | GET    | `/api/metrics/rankings`          | Yes  | Keyword ranking history             |
  | GET    | `/api/metrics/backlinks`         | Yes  | Backlink growth and profile         |
  | GET    | `/api/metrics/ai-referrers`      | Yes  | Traffic from AI platforms            |
  | GET    | `/api/dashboard`                 | Yes  | Combined dashboard data             |
  
  ### AI Mentions
  
  | Method | Endpoint                                 | Auth | Description                    |
  | ------ | ---------------------------------------- | ---- | ------------------------------ |
  | GET    | `/api/ai-mentions/prompt-sets`           | Yes  | List prompt groups             |
  | POST   | `/api/ai-mentions/prompt-sets`           | Yes  | Create prompt group            |
  | PUT    | `/api/ai-mentions/prompt-sets/:id`       | Yes  | Update prompt group            |
  | DELETE | `/api/ai-mentions/prompt-sets/:id`       | Yes  | Delete prompt group            |
  | GET    | `/api/ai-mentions/prompts`               | Yes  | List prompts                   |
  | POST   | `/api/ai-mentions/prompts`               | Yes  | Create prompt                  |
  | PUT    | `/api/ai-mentions/prompts/:id`           | Yes  | Update prompt                  |
  | DELETE | `/api/ai-mentions/prompts/:id`           | Yes  | Delete prompt                  |
  | GET    | `/api/ai-mentions/brand-entities`        | Yes  | List brand entities            |
  | POST   | `/api/ai-mentions/brand-entities`        | Yes  | Create brand entity            |
  | PUT    | `/api/ai-mentions/brand-entities/:id`    | Yes  | Update brand entity            |
  | DELETE | `/api/ai-mentions/brand-entities/:id`    | Yes  | Delete brand entity            |
  | POST   | `/api/ai-mentions/run`                   | Yes  | Trigger LLM analysis run       |
  | GET    | `/api/ai-mentions/results/:promptSetId`  | Yes  | Fetch analysis results         |
  | GET    | `/api/ai-mentions/stats/:promptSetId`    | Yes  | Get statistics for a prompt set|
  
  ### SEO Analytics Pipeline
  
  | Method | Endpoint                   | Auth | Description                                        |
  | ------ | -------------------------- | ---- | -------------------------------------------------- |
  | GET    | `/api/seo-metrics-test`    | Yes  | Raw + computed SEO metrics                         |
  | GET    | `/api/insights-test`       | Yes  | Computed metrics + rule-based insights             |
  | GET    | `/api/ai-summary-test`     | Yes  | Full pipeline: metrics → insights → AI narrative   |
  
  ### External API Proxies
  
  | Method | Endpoint                         | Auth | Description                    |
  | ------ | -------------------------------- | ---- | ------------------------------ |
  | GET    | `/api/semrush/domain-overview`   | Yes  | Proxy to SEMrush               |
  | GET    | `/api/dataforseo/keywords`       | Yes  | DataForSEO keyword data        |
  | GET    | `/api/dataforseo/domain-metrics` | Yes  | DataForSEO domain metrics      |
  | GET    | `/api/dataforseo/backlinks`      | Yes  | DataForSEO backlinks           |
  | GET    | `/api/dataforseo/serp`           | Yes  | DataForSEO SERP results        |
  
  ### System
  
  | Method | Endpoint                  | Auth | Description                          |
  | ------ | ------------------------- | ---- | ------------------------------------ |
  | GET    | `/api/health`             | No   | API credential connectivity check    |
  | GET    | `/api/check-all-apis`     | No   | All external API status              |
  | GET    | `/api/diagnostics`        | Yes  | System diagnostics                   |
  | GET    | `/api/google/status`      | Yes  | Google API status                    |
  | GET    | `/api/semrush/status`     | Yes  | SEMrush API status                   |
  | GET    | `/api/dataforseo/status`  | Yes  | DataForSEO API status                |
  | GET    | `/api/share/:token`       | No   | Public shared report view            |
  | POST   | `/api/share-links`        | Yes  | Create a share link                  |
  | GET    | `/api/share-links`        | Yes  | List share links                     |
  | GET    | `/api/sync/status`        | Yes  | Data sync status                     |
  
  ---
  
  ## 8. SEO Analytics Pipeline
  
  The project implements a three-layer analytics pipeline that transforms raw data into executive-ready summaries:
  
  ```
  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
  │  Data Aggregation │───▶│  Metrics Engine   │───▶│  Insight Engine   │───▶│  AI Narrative     │
  │                    │    │                    │    │                    │    │                    │
  │  GA4 + GSC +       │    │  computeSeoMetrics │    │  generateInsights  │    │  generateNarrative │
  │  Rankings          │    │  (deterministic)   │    │  (rule-based)      │    │  (OpenAI, strict)  │
  └──────────────────┘    └──────────────────┘    └──────────────────┘    └──────────────────┘
  ```
  
  ### Layer 1: Data Aggregation (`server/storage.ts`)
  
  The `getAggregatedSeoData()` method queries the database to produce:
  
  - **GA4 Data**: Summed users and sessions for current and previous periods
  - **GSC Data**: Summed clicks/impressions, weighted CTR, averaged position
  - **Rankings Data**: Distinct keyword counts, top-10 counts, improved/declined keyword movements
  
  ### Layer 2: SEO Metrics Engine (`server/lib/seo-metrics.ts`)
  
  The `computeSeoMetrics()` function applies deterministic formulas:
  
  | Metric               | Formula                                            |
  | -------------------- | -------------------------------------------------- |
  | Growth Rate          | `(current - previous) / previous * 100`            |
  | CTR Gap              | `expectedCTR (5%) - actual CTR`                    |
  | Top 10 %             | `(top10Keywords / totalKeywords) * 100`            |
  | Net Keyword Growth   | `improved - declined`                              |
  | Page 2 Opportunity   | `avgPosition between 11–20`                        |
  | Low CTR Opportunity  | `impressions > 5000 AND ctr < 5%`                  |
  
  Safety: All calculations use `safeNumber()` (handles null/undefined/NaN) and `safeDivide()` (prevents divide-by-zero).
  
  ### Layer 3: Insight Engine (`server/lib/insight-engine.ts`)
  
  The `generateInsights()` function applies deterministic rules to convert metrics into structured insights:
  
  | Rule                  | Condition                        | Type     | Category    |
  | --------------------- | -------------------------------- | -------- | ----------- |
  | Traffic Growth        | `growthRate > 0`                 | positive | traffic     |
  | Traffic Decline       | `growthRate < 0`                 | warning  | traffic     |
  | Traffic Stable        | `growthRate == 0`                | neutral  | traffic     |
  | Low CTR Opportunity   | `lowCtrOpportunity == true`      | warning  | ctr         |
  | Strong CTR            | `ctr >= 5`                       | positive | ctr         |
  | Low Visibility        | `ctr < 3` (with data present)    | warning  | ctr         |
  | Keyword Growth        | `netGrowth > 0`                  | positive | keywords    |
  | Keyword Decline       | `netGrowth < 0`                  | warning  | keywords    |
  | Strong Top 10         | `top10Percentage > 30`           | positive | keywords    |
  | Limited Top 10        | `top10Percentage <= 30`          | neutral  | keywords    |
  | Page 2 Opportunity    | `page2KeywordsEstimate == true`  | neutral  | opportunity |
  
  ### Layer 4: AI Narrative (`server/lib/ai-narrative.ts`)
  
  The `generateNarrative()` function uses OpenAI (gpt-4o-mini, temperature 0.3) to produce a 4–6 sentence executive paragraph. The AI is strictly constrained to only use provided insights — no hallucination, no assumptions, no bullet points.
  
  ---
  
  ## 9. Dashboard Pages
  
  | Page                | Route                      | Description                                    |
  | ------------------- | -------------------------- | ---------------------------------------------- |
  | Landing             | `/`                        | Public landing page                            |
  | Sign In             | `/sign-in`                 | Email/password login                           |
  | Sign Up             | `/sign-up`                 | Account registration                           |
  | Forgot Password     | `/forgot-password`         | Password reset request                         |
  | Reset Password      | `/reset-password`          | Password reset with token                      |
  | Executive Overview  | `/dashboard`               | Main KPI dashboard with charts                 |
  | Rankings            | `/dashboard/rankings`      | Keyword ranking analysis                       |
  | GSC Explorer        | `/dashboard/gsc-explorer`  | Search Console query and page analysis         |
  | Backlinks           | `/dashboard/backlinks`     | Backlink profile and growth                    |
  | AI Referrers        | `/dashboard/ai-referrers`  | AI platform traffic tracking                   |
  | AI Mentions         | `/dashboard/ai-mentions`   | Brand mention analysis in LLM responses        |
  | Exports             | `/dashboard/exports`       | PDF and report exports                         |
  | Settings            | `/dashboard/settings`      | API configuration and account settings         |
  
  ---
  
  ## 10. Environment Variables
  
  | Variable                          | Required | Description                               |
  | --------------------------------- | -------- | ----------------------------------------- |
  | `DATABASE_URL`                    | Yes      | PostgreSQL connection string              |
  | `SESSION_SECRET`                  | Prod     | Express session secret                    |
  | `GOOGLE_SERVICE_ACCOUNT_JSON`     | No       | Google APIs service account credentials   |
  | `SEMRUSH_API_KEY`                 | No       | SEMrush API key                           |
  | `DATAFORSEO_LOGIN`                | No       | DataForSEO login                          |
  | `DATAFORSEO_PASSWORD`             | No       | DataForSEO password                       |
  | `AI_INTEGRATIONS_OPENAI_API_KEY`  | No       | OpenAI API key (via Replit integration)   |
  | `AI_INTEGRATIONS_OPENAI_BASE_URL` | No       | OpenAI base URL (via Replit integration)  |
  | `RESEND_API_KEY`                  | No       | Resend email service key                  |
  | `DEBUG`                           | No       | Enable debug logging (`true`/`false`)     |
  
  ---
  
  ## 11. Running the Project
  
  ```bash
  # Development (starts Express + Vite dev server)
  npm run dev
  
  # Production build
  npm run build
  
  # Start production server
  npm start
  ```
  
  The development server runs on port 5000 and serves both the API and the frontend with hot module replacement.
  
  ---
  
  ## 12. Tech Stack Summary
  
  **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, Recharts, TanStack Query, Wouter
  
  **Backend**: Node.js, Express, TypeScript, Drizzle ORM, PostgreSQL, OpenAI SDK
  
  **Integrations**: Google Analytics 4, Google Search Console, SEMrush, DataForSEO, OpenAI, Resend
  
  **Infrastructure**: PostgreSQL session store, Drizzle Kit migrations, path aliases via TypeScript/Vite config
  