# Spec: A09 — Recommendation Synthesis Agent
# Reference: PDF §9 — Recommendation Synthesis

---

## What This Agent Does

Saare upstream agents ke scratchpad padhta hai.
Observations deduplicate karta hai.
GPT-5.5 equivalent (Claude Opus) se prioritised
action list banata hai — with evidence + effort + impact.

---

## Trigger

```
Schedule: Weekly — runs after A02-A08 all complete
Cron:     0 4 * * 1  (Monday 4 AM — after all analysis)
Depends:  A08 anomaly scratchpad must exist for this week
Manual:   POST /api/agents/recommendations/run
```

---

## Input — What It Reads

```typescript
// Reads from agent_scratchpad table
// All agents for this tenant + this week

interface RecommendationInput {
  tenantId: string
  weekNumber: number
  
  // From scratchpad table:
  anomalies: A08Findings        // A08 output
  keywordInsights: A02Findings  // A02 output (when built)
  contentInsights: A04Findings  // A04 output (when built)
  
  // From existing GA4+GSC data:
  trafficSummary: TrafficData
  gscSummary: GSCData
  
  // Tenant strategic goals (config):
  tenantGoals: {
    primaryKPI: 'traffic' | 'conversions' | 'rankings'
    targetKeywords: string[]
    industry: string
  }
}
```

---

## Claude Opus Prompt Structure

```
System prompt:
"You are a senior SEO strategist analyzing data for
 {industry} client. Produce actionable recommendations
 based on evidence. Be specific, not generic.
 Always cite which data point supports each recommendation."

User prompt:
"This week's findings:

ANOMALIES DETECTED:
{A08 scratchpad findings}

KEYWORD MOVEMENT:
{A02 findings or GSC data}

TRAFFIC DATA:
{GA4 summary}

CLIENT GOALS: {tenantGoals}

Produce 3-5 recommendations in this exact JSON format:
{
  recommendations: [
    {
      priority: 1,
      statement: "one clear action sentence",
      evidence: "specific data point that supports this",
      effort: "low|medium|high",
      effort_hours: number,
      impact: "low|medium|high", 
      impact_description: "what will improve and by how much",
      owner_role: "technical|content|strategy",
      agent_run_ids: ["A08-xxx", "A02-xxx"]
    }
  ]
}

Return ONLY valid JSON. No preamble."
```

---

## Output — What It Writes

```typescript
// 1. agent_scratchpad table
interface A09Scratchpad {
  agent_id: 'A09'
  run_id: string
  tenant_id: string
  findings: {
    recommendations: Recommendation[]
    sources_read: string[]     // which agent scratchpads used
    deduplication_notes: string
  }
}

// 2. recommendations table (for UI + report)
interface Recommendation {
  id: string
  tenant_id: string
  run_id: string
  priority: number             // 1 = highest
  statement: string
  evidence: string
  effort: 'low' | 'medium' | 'high'
  effort_hours: number
  impact: 'low' | 'medium' | 'high'
  impact_description: string
  owner_role: string
  agent_run_ids: string[]      // traceable!
  status: 'pending_review' | 'approved' | 'edited' | 'vetoed'
  analyst_edit: string | null  // if analyst changed it
}
```

---

## New Files to Create

```
server/agents/recommendation-synthesis.ts
server/routes/agents/recommendations.ts
client/src/components/agents/RecommendationList.tsx
client/src/components/agents/RecommendationCard.tsx
```

---

## API Routes

```
GET  /api/agents/recommendations
     → Returns this week's recommendations
     Query: ?status=pending_review&week=21

PATCH /api/agents/recommendations/:id
      Body: { status: 'approved'|'vetoed', analystEdit?: string }
      → Analyst approve/veto/edit action

POST /api/agents/recommendations/run
     → Manual trigger
```

---

## UI — RecommendationList.tsx

```
Display in: report-preview.tsx
Position:   New section — "This Week's Actions"
Style:      Numbered priority cards

Card shows:
- Priority badge (#1, #2, #3...)
- Statement (bold, 1 sentence)
- Evidence (small text, italic)
- Effort chip + Impact chip
- Owner role badge
- Status: Pending / Approved / Vetoed
- [Edit] [Approve ✅] [Veto ❌] buttons

Important:
Approved recommendations flow into PDF report
Vetoed ones are hidden from client view
```

---

## Analyst Edit Flow

```
Analyst edits recommendation text
    ↓
PATCH /api/agents/recommendations/:id
  { status: 'edited', analystEdit: 'new text' }
    ↓
System stores both:
  original: A09's text
  analystEdit: analyst's version
    ↓
PDF uses analystEdit version if exists
Dashboard shows analystEdit with "(edited)" badge

This teaches the system:
Future A09 runs improve from analyst edits
```

---

## Integration with Existing Code

```typescript
// In report-preview.tsx — ADD only, never change existing

const { data: recommendations } = useQuery({
  queryKey: ['recommendations', tenantId, weekNumber],
  queryFn: () => fetch('/api/agents/recommendations').then(r => r.json())
})

// New section in JSX:
<RecommendationList
  recommendations={recommendations}
  onApprove={(id) => approveRecommendation(id)}
  onVeto={(id) => vetoRecommendation(id)}
  onEdit={(id, text) => editRecommendation(id, text)}
/>
```

---

## Token Budget

```
Claude Opus input:   ~8,000 tokens (all scratchpads)
Claude Opus output:  ~2,000 tokens (JSON recommendations)
Total per run:       ~10,000 tokens
Cost estimate:       ~$0.11 per weekly run
```

---

## Testing Checklist

```
[ ] A09 reads A08 scratchpad correctly
[ ] Recommendations JSON parsed without errors
[ ] 3-5 recommendations generated (not more, not less)
[ ] Each recommendation has all required fields
[ ] Approve/veto/edit flow works
[ ] PDF receives approved recommendations via computedMetrics
[ ] Existing dashboard sections unchanged
[ ] No regression in existing GA4/GSC data display
```
