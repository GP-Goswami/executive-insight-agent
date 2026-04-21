# 🚀 Executive Insight Agent — Setup & Connection Guide

> **Reference**: Based on `PROJECT_DOCUMENTATION.md` and full codebase analysis.  
> **Purpose**: Step-by-step instructions to get the project running locally, including all API connections.

---

## 📋 Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Project Installation](#2-project-installation)
3. [Database Setup (PostgreSQL)](#3-database-setup-postgresql)
4. [Environment Variables (.env)](#4-environment-variables-env)
5. [Google APIs Connection](#5-google-apis-connection)
6. [SEMrush API Connection](#6-semrush-api-connection)
7. [DataForSEO API Connection](#7-dataforseo-api-connection)
8. [OpenAI API Connection](#8-openai-api-connection)
9. [Resend Email API Connection](#9-resend-email-api-connection)
10. [Running the Project](#10-running-the-project)
11. [API Health Check](#11-api-health-check)
12. [Troubleshooting Common Issues](#12-troubleshooting-common-issues)

---

## 1. Prerequisites

Before starting, make sure you have the following installed on your system:

| Tool | Version | Download |
|------|---------|----------|
| **Node.js** | v18 or higher | https://nodejs.org |
| **npm** | v8 or higher | Comes with Node.js |
| **PostgreSQL** | v14 or higher | https://www.postgresql.org/download/ |
| **Git** | Any | https://git-scm.com |

Verify your installations:

```bash
node -v       # Should be v18+
npm -v        # Should be v8+
psql --version  # Should be 14+
```

---

## 2. Project Installation

### Step 1: Clone or navigate to the project

```bash
cd c:\Users\DELL\Downloads\nightvision\Executive-Insight-Agent
```

### Step 2: Install all dependencies

```bash
npm install
```

This installs:
- **Frontend**: React 18, Vite, Tailwind CSS, shadcn/ui, Recharts, TanStack Query
- **Backend**: Express, Drizzle ORM, bcryptjs, pg (PostgreSQL driver)
- **Integrations**: googleapis, openai, resend, p-limit, p-retry

---

## 3. Database Setup (PostgreSQL)

The project uses **PostgreSQL** as its primary database, backed by **Drizzle ORM**.

### Step 1: Create the database

Open **pgAdmin** or run `psql` in your terminal:

```sql
-- Connect to PostgreSQL as superuser
psql -U postgres

-- Create the database
CREATE DATABASE executive_reporting;

-- Create the user (optional, if you want a dedicated user)
CREATE USER reporting_user WITH PASSWORD 'yourpassword';
GRANT ALL PRIVILEGES ON DATABASE executive_reporting TO reporting_user;

-- Exit
\q
```

### Step 2: Set up your DATABASE_URL

Your connection string format:

```
# Local PostgreSQL (no SSL)
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/executive_reporting?sslmode=disable

# Remote PostgreSQL (e.g., Neon, Supabase — with SSL)
DATABASE_URL=postgresql://username:password@host:5432/dbname?sslmode=require
```

> **Current local config in .env:**
> ```
> DATABASE_URL=postgresql://postgres:Gautam_2906@localhost:5432/postgres?sslmode=disable
> ```

### Step 3: Push schema to database

After setting `DATABASE_URL` in `.env`, run:

```bash
npm run db:push
```

This creates all the required tables via **Drizzle Kit**:

| Table | Purpose |
|-------|---------|
| `users` | User accounts (Admin, Internal, Client roles) |
| `sessions` | Express session persistence |
| `clients` | Organization-level clients |
| `properties` | Websites/domains per client |
| `ga4_daily_metrics` | Google Analytics daily data |
| `gsc_daily` | Search Console daily data |
| `rank_daily` | Keyword ranking history |
| `backlinks_daily` | Backlink metrics |
| `ai_referrer_daily` | AI platform traffic |
| `kpi_daily_summary` | Aggregated KPI snapshots |
| `ai_prompt_sets` | AI mention prompt groups |
| `ai_prompts` | Individual LLM prompts |
| `ai_brand_entities` | Brand names for detection |
| `ai_prompt_runs` | LLM execution logs |
| `ai_mentions` | AI mention results |
| `sync_runs` | Data sync logs |
| `share_links` | Public shareable report tokens |

---

## 4. Environment Variables (.env)

Create or update your `.env` file in the project root. Here is the **complete template**:

```env
# =========================================
# DATABASE (REQUIRED)
# =========================================
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/your_db?sslmode=disable

# =========================================
# SESSION SECRET (REQUIRED IN PRODUCTION)
# =========================================
SESSION_SECRET=your_long_random_session_secret_here

# =========================================
# SERVER PORT
# =========================================
PORT=5000

# =========================================
# GOOGLE APIs (GA4 + Search Console)
# Paste the entire service account JSON as a single line
# =========================================
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"...@...iam.gserviceaccount.com","client_id":"...","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs","client_x509_cert_url":"...","universe_domain":"googleapis.com"}

# =========================================
# SEMrush API
# =========================================
SEMRUSH_API_KEY=your_semrush_api_key_here

# =========================================
# DataForSEO API
# =========================================
DATAFORSEO_LOGIN=your_email@example.com
DATAFORSEO_PASSWORD=your_dataforseo_api_password

# =========================================
# OpenAI API (for AI Mentions & Narratives)
# =========================================
AI_INTEGRATIONS_OPENAI_API_KEY=sk-proj-...your_openai_key...

# Optional: only needed if using a custom OpenAI proxy
# AI_INTEGRATIONS_OPENAI_BASE_URL=http://localhost:1106/modelfarm/openai

# =========================================
# Resend Email API (for password resets)
# =========================================
RESEND_API_KEY=re_...your_resend_key...

# =========================================
# DEBUG LOGGING (optional)
# =========================================
DEBUG=true
```

> ⚠️ **Important**: Never commit your `.env` file to Git. It is already in `.gitignore`.

---

## 5. Google APIs Connection

The project uses a **Google Service Account** for both GA4 (Google Analytics 4) and Google Search Console.

### Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (e.g., `executive-reporting-seo`)
3. Note your **Project ID**

### Step 2: Enable Required APIs

In your Google Cloud Project, enable:

- **Google Analytics Data API** — for GA4 traffic data
- **Google Search Console API** — for search clicks/impressions/rankings

Navigate to: `APIs & Services → Library` → Search and enable each API.

### Step 3: Create a Service Account

1. Go to `IAM & Admin → Service Accounts`
2. Click **Create Service Account**
3. Name it (e.g., `seo-reporting-agent`)
4. Click **Create and Continue**
5. Skip role assignment → Click **Done**
6. Click on the created service account
7. Go to **Keys** tab → **Add Key** → **Create new key** → **JSON**
8. Download the JSON file

### Step 4: Set GOOGLE_SERVICE_ACCOUNT_JSON

Take the downloaded JSON file and paste its **entire contents as a single line** into your `.env`:

```env
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"..."}
```

> **Tip**: Remove all newlines from the JSON. The `\n` in `private_key` should remain as `\n` (escaped), not actual newlines.

### Step 5: Grant Access in GA4

1. Go to [Google Analytics](https://analytics.google.com/)
2. Select your GA4 Property → **Admin** → **Property Access Management**
3. Click **+** → **Add users**
4. Enter the service account email (e.g., `seo-reporting-agent@your-project.iam.gserviceaccount.com`)
5. Set role to **Viewer**

### Step 6: Grant Access in Google Search Console

1. Go to [Google Search Console](https://search.google.com/search-console/)
2. Select your site property
3. Go to **Settings → Users and Permissions**
4. Click **Add User**
5. Enter the service account email
6. Set permission to **Full**

### How the Code Uses It

File: `server/lib/google-apis.ts`

```typescript
// Reads GOOGLE_SERVICE_ACCOUNT_JSON env var
function getCredentials() {
  const credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  return JSON.parse(credentialsJson); // Parsed into credentials object
}

// Auth scopes used:
scopes: [
  "https://www.googleapis.com/auth/webmasters.readonly",  // GSC
  "https://www.googleapis.com/auth/analytics.readonly",   // GA4
]
```

### GA4 Property ID

When making API calls, you need your **GA4 Property ID** (numeric, e.g., `123456789`).

Find it at: `GA4 → Admin → Property → Property Details → Property ID`

---

## 6. SEMrush API Connection

SEMrush is used for:
- **Organic keyword counts** (`domain_organic`)
- **Organic traffic cost** (`domain_rank`)

### Step 1: Get your API Key

1. Log in to [SEMrush](https://www.semrush.com/)
2. Go to `Profile → Subscription info → API Units`
3. Copy your API Key

### Step 2: Add to .env

```env
SEMRUSH_API_KEY=your_semrush_api_key_here
```

### API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `domain_organic` | Count organic keywords |
| `domain_rank` | Get organic traffic cost |

> **Note**: `backlinks_overview` is currently broken in SEMrush (returns "query type not found"). DataForSEO is the primary backlink source.

---

## 7. DataForSEO API Connection

DataForSEO is the **primary source for backlinks and referring domains**.  
It is also used for SERP rankings and keyword data.

### Step 1: Create an Account

1. Go to [DataForSEO](https://dataforseo.com/)
2. Register and get your Login (email) and Password (API password)

### Step 2: Add to .env

```env
DATAFORSEO_LOGIN=your_email@example.com
DATAFORSEO_PASSWORD=your_api_password
```

### Fallback Chain for Backlinks

```
DataForSEO backlinks → SEMrush backlinks → Returns 0
```

### API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `backlinks/summary/live` | Backlinks & referring domains |
| `serp` | SERP rankings |
| `keywords_data` | Keyword data |

---

## 8. OpenAI API Connection

OpenAI powers two features:
1. **AI Mentions Analysis** — Runs prompts against LLMs to detect brand mentions
2. **Executive AI Narrative** — Generates 4–6 sentence executive summaries

### Step 1: Get your API Key

1. Go to [OpenAI Platform](https://platform.openai.com/)
2. Navigate to `API Keys` → **Create new secret key**

### Step 2: Add to .env

```env
AI_INTEGRATIONS_OPENAI_API_KEY=sk-proj-...your_key...
```

### Model Used

```typescript
// server/lib/ai-narrative.ts
model: "gpt-4o-mini"
temperature: 0.3  // Low temperature for consistent, factual output
```

> **Cost Note**: Uses `gpt-4o-mini` (very affordable). AI Mentions can generate more calls depending on your prompt sets.

---

## 9. Resend Email API Connection

Resend is used for **password reset emails**.

### Step 1: Create a Resend Account

1. Go to [Resend](https://resend.com/)
2. Create an account and verify your sending domain
3. Go to `API Keys` → **Create API Key**

### Step 2: Add to .env

```env
RESEND_API_KEY=re_...your_key...
```

> **Note**: This is optional. The app works without it — password resets just won't send emails.

---

## 10. Running the Project

### Development Mode (Recommended)

Starts Express server + Vite dev server with **Hot Module Replacement**:

```bash
npm run dev
```

- App runs at: **http://localhost:5000**
- Both API (`/api/*`) and frontend served from the same port
- Auto-reloads on code changes

### Production Mode

```bash
# Build the production bundle
npm run build

# Start production server
npm start
```

### Database Schema Push

Whenever you update `shared/schema.ts`:

```bash
npm run db:push
```

### TypeScript Check

```bash
npm run check
```

---

## 11. API Health Check

After starting the server, check API connectivity:

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /api/health` | No | Quick API credential check |
| `GET /api/check-all-apis` | No | Status of all external APIs |
| `GET /api/google/status` | Yes | Google APIs (GA4 + GSC) status |
| `GET /api/semrush/status` | Yes | SEMrush API status |
| `GET /api/dataforseo/status` | Yes | DataForSEO API status |
| `GET /api/diagnostics` | Yes | Full system diagnostics |

Open in browser (no auth):
```
http://localhost:5000/api/health
http://localhost:5000/api/check-all-apis
```

---

## 12. Troubleshooting Common Issues

### ❌ `DATABASE_URL must be set`

**Cause**: `.env` file not loaded or `DATABASE_URL` missing.

**Fix**:
1. Make sure `.env` is in the project root
2. Check `DATABASE_URL` has no typos
3. Ensure `dotenv` is loaded (it's imported in `drizzle.config.ts`)

---

### ❌ `ECONNREFUSED 127.0.0.1:5432`

**Cause**: PostgreSQL is not running locally.

**Fix**:
```bash
# Windows — Start PostgreSQL service
net start postgresql-x64-14  # (adjust version)

# Or open Services → Find PostgreSQL → Start
```

---

### ❌ `SSL: connection requires SSL`

**Cause**: Using a remote database (e.g., Neon) without SSL mode.

**Fix**: Add `?sslmode=require` to your `DATABASE_URL`:
```env
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require
```

Or for local PostgreSQL:
```env
DATABASE_URL=postgresql://postgres:pass@localhost:5432/db?sslmode=disable
```

---

### ❌ `Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON`

**Cause**: The JSON in `.env` has actual newlines or is malformed.

**Fix**: Make sure:
1. The entire JSON is on **one line** in `.env`
2. `private_key` uses literal `\n` (escaped), not actual line breaks
3. No surrounding quotes around the JSON value (invalid: `GOOGLE_SERVICE_ACCOUNT_JSON="{"type":...}"`)

---

### ❌ `GSC_PERMISSION_DENIED (403)`

**Cause**: Service account email not added to Google Search Console.

**Fix**:
1. Get service account email from the JSON (`client_email` field)
2. Add it to Search Console → Settings → Users and Permissions
3. Grant **Full** permission

---

### ❌ `No GA4 data found for property`

**Cause**: Wrong property ID, or service account not added to GA4.

**Fix**:
1. Find your numeric Property ID in GA4 → Admin → Property Details
2. Add the service account email as **Viewer** in GA4 property settings
3. Ensure you're using the numeric ID (not the measurement ID `G-XXXXXXXX`)

---

### ❌ `ERR_MODULE_NOT_FOUND` or TypeScript import errors

**Fix**:
```bash
npm install
```

Or if that fails:
```bash
rm -rf node_modules
npm install
```

---

## 📁 Key Files Reference

| File | Purpose |
|------|---------|
| `.env` | All environment variables and API keys |
| `server/db.ts` | PostgreSQL connection setup via Drizzle ORM |
| `server/index.ts` | Express server entrypoint |
| `server/routes.ts` | All API route definitions |
| `server/storage.ts` | Data access layer (IStorage interface) |
| `server/lib/google-apis.ts` | GA4 and GSC API integration |
| `server/lib/semrush.ts` | SEMrush API integration |
| `server/lib/dataforseo.ts` | DataForSEO API integration |
| `server/lib/ai-narrative.ts` | OpenAI executive summary generator |
| `server/lib/ai-mentions.ts` | AI Mentions analysis |
| `server/lib/seo-metrics.ts` | SEO Metrics computation engine |
| `server/lib/insight-engine.ts` | Rule-based insight generator |
| `shared/schema.ts` | All database table definitions |
| `drizzle.config.ts` | Drizzle Kit configuration for migrations |
| `package.json` | Scripts and dependencies |

---

## 🧪 Quick Test After Setup

1. Start the server:
   ```bash
   npm run dev
   ```

2. Open: `http://localhost:5000`

3. Register an account at: `http://localhost:5000/sign-up`

4. Check API status: `http://localhost:5000/api/check-all-apis`

5. Navigate to **Settings** page to verify each API connection shows ✅ Connected

6. Add a **Client** → Add a **Property** (with GA4 Property ID and GSC site URL)

7. Go to **Executive Overview** dashboard to see live data

---

*Generated from project analysis — April 2026*
