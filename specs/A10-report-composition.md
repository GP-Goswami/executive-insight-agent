# Spec: A10 — Report Composition Agent
# Reference: PDF §10 — Report Composition Engine

---

## What This Agent Does

Saare agent scratchpads + existing GA4/GSC data ko combine karta hai.
Claude Opus se weekly report likhta hai — professional, branded.
PDF format + dashboard native view dono produce karta hai.

---

## Trigger

```
Schedule: Weekly — runs after A09 completes
Cron:     0 5 * * 1  (Monday 5 AM)
Depends:  A09 recommendations must exist
Manual:   POST /api/agents/report/run
```

---

## Input — What It Reads

```typescript
interface ReportInput {
  tenantId: string
  weekNumber: number
  
  // Existing data (DO NOT re-fetch — read from DB cache)
  trafficData: GA4Data           // Already in DB
  gscData: GSCData               // Already in DB
  
  // From scratchpads:
  anomalies: AnomalyResult[]     // A08 output
  recommendations: Recommendation[] // A09 output (approved only)
  
  // Computed metrics from frontend
  // (passed via computedMetrics — never recompute here)
  computedMetrics: {
    dataHealthScore: number
    siteHealthScore: number
    executiveVerdict: string
    brandVsNonBrand: BrandSplit
    ctrOpportunities: CTROpportunity[]
    forecastData: ForecastData
  }
  
  // Client config
  tenantConfig: {
    clientName: string
    industry: string
    brandName: string
    reportingPeriod: { start: Date; end: Date }
  }
}
```

---

## Claude Opus Prompt — Executive Summary

```
System:
"You are writing a professional SEO weekly report for
 {clientName}, a {industry} company.
 Write in clear, confident business language.
 Be specific with numbers. No generic advice.
 Format: exactly 4-5 bullet points."

User:
"Write executive summary bullets for this week:

Traffic: {sessions} sessions ({delta}% vs last week)
Top anomaly: {topAnomaly}
Key win: {topRecommendation}
AEO: {citationShare}% citation share
Health score: {siteHealthScore}/100

Return ONLY a JSON array of bullet strings.
Each bullet max 15 words. No preamble."
```

---

## Output Structure

```typescript
// 1. agent_scratchpad table
interface A10Scratchpad {
  agent_id: 'A10'
  run_id: string
  findings: {
    executiveSummary: string[]
    reportDraftId: string
  }
}

// 2. report_drafts table
interface ReportDraft {
  id: string
  tenant_id: string
  report_type: 'weekly' | 'monthly'
  week_number: number
  status: 'draft' | 'qa_review' | 'pending_analyst' | 'approved' | 'delivered'
  
  content: {
    executiveSummary: string[]      // A10 Claude Opus authored
    trafficSnapshot: TrafficSection // From existing GA4 data
    anomaliesSection: AnomalySection // From A08
    recommendationsSection: RecommendationSection // From A09 (approved)
    aeoSnapshot: AEOSection         // From existing AEO data
    dataHealthSection: DataHealthSection // From computedMetrics
  }
  
  pdf_url: string | null           // After PDF generation
  created_at: Date
  approved_at: Date | null
  analyst_notes: string | null
}
```

---

## Report Sections — Weekly (8-12 pages)

```
Section 1: Executive Summary
  Source: Claude Opus generated
  Content: 4-5 bullets covering week's highlights

Section 2: Traffic Snapshot  
  Source: Existing GA4 data (computedMetrics)
  Content: Sessions, users, engaged sessions, conversions + WoW deltas

Section 3: Anomalies This Week
  Source: A08 scratchpad
  Content: P0/P1 anomalies with root cause

Section 4: Site Health Score
  Source: computedMetrics.siteHealthScore
  Content: 5-pillar breakdown (existing implementation)

Section 5: Search Performance
  Source: Existing GSC data
  Content: Clicks, impressions, CTR, avg position + trends

Section 6: AEO Snapshot
  Source: Existing AEO data
  Content: Citation share visual (existing implementation)

Section 7: This Week's Actions
  Source: A09 approved recommendations
  Content: 3-5 prioritised actions with owner + effort + impact

Section 8: Appendix
  Content: Data freshness timestamps, agent run IDs
```

---

## PDF Generation

```typescript
// CRITICAL: Use computedMetrics passed from frontend
// NEVER recompute values here — use what frontend computed

// In existing pdf-generator.ts — ADD new sections only:

// New function to add (don't change existing):
export async function addAIGeneratedSections(
  doc: PDFDocument,
  reportDraft: ReportDraft,
  computedMetrics: ComputedMetrics  // Always from frontend
): Promise<void> {
  // Add executive summary section
  await addExecutiveSummarySection(doc, reportDraft.content.executiveSummary)
  
  // Add anomalies section
  await addAnomaliesSection(doc, reportDraft.content.anomaliesSection)
  
  // Add recommendations section  
  await addRecommendationsSection(doc, reportDraft.content.recommendationsSection)
  
  // All existing sections remain unchanged
}
```

---

## New Files to Create

```
server/agents/report-composition.ts
server/routes/agents/reports.ts
client/src/pages/dashboard/review-queue.tsx    ← New page
client/src/components/agents/ReportPreview.tsx ← For review queue
```

---

## Review Queue UI

```
New page: /dashboard/review-queue

Shows draft reports awaiting analyst approval:

┌─────────────────────────────────────────┐
│ REVIEW QUEUE                            │
│                                         │
│ 📄 Week 21 Report — Draft              │
│    Generated: 2hr ago by A10           │
│    A11 QA: ✅ Passed                   │
│                                         │
│ [Preview Full Report]                   │
│ [Edit Executive Summary]               │
│ [Approve & Send ✅]                    │
│ [Request Changes ✏️]                   │
└─────────────────────────────────────────┘
```

---

## API Routes

```
GET  /api/agents/reports
     → List draft reports for tenant
     Query: ?status=pending_analyst

GET  /api/agents/reports/:id
     → Get full report draft content

PATCH /api/agents/reports/:id
      Body: { status, analystNotes, editedContent? }

POST /api/agents/report/run
     → Manual trigger

GET  /api/agents/reports/:id/pdf
     → Generate + download PDF for draft
```

---

## Token Budget

```
Claude Opus (executive summary): ~3,000 tokens
Other sections (data formatting): minimal
Total per run: ~5,000 tokens
Cost estimate: ~$0.06 per weekly run
```

---

## Testing Checklist

```
[ ] Report draft created in DB after run
[ ] Executive summary has 4-5 bullets
[ ] All sections populated with correct data
[ ] computedMetrics values match dashboard values
[ ] PDF generation includes new AI sections
[ ] Existing PDF sections unchanged
[ ] Review queue page shows draft
[ ] Approve flow updates report status
[ ] No regression in report-preview.tsx
[ ] cleanText() used for all AI-generated text in PDF
```
