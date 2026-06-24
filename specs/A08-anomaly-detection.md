# Spec: A08 — Anomaly Detection Agent
# Reference: PDF §9 — Anomaly Detection & Recommendation Synthesis

---

## What This Agent Does

Har din GA4 + GSC time-series data monitor karta hai.
Statistical methods se outliers detect karta hai.
Severity classify karta hai aur triage queue mein bhejta hai.

---

## Trigger

```
Schedule: Daily — runs after A01 data ingestion completes
Cron:     0 3 * * *  (3 AM daily)
Manual:   POST /api/agents/anomaly/run
```

---

## Input — What It Reads

```typescript
// From existing /api/report-data endpoint
// DO NOT change this endpoint — read only

interface AnomalyInput {
  // GA4 data (already available)
  sessions: TimeSeriesPoint[]
  users: TimeSeriesPoint[]
  conversions: TimeSeriesPoint[]
  engagedSessions: TimeSeriesPoint[]
  channelData: ChannelBreakdown[]

  // GSC data (already available)
  clicks: TimeSeriesPoint[]
  impressions: TimeSeriesPoint[]
  ctr: TimeSeriesPoint[]
  avgPosition: TimeSeriesPoint[]
  
  // Tenant config
  tenantId: string
  dateRange: { start: Date; end: Date }
}

interface TimeSeriesPoint {
  date: string
  value: number
}
```

---

## Detection Methods (Two-Stage)

### Stage 1 — Statistical Detection (Claude Haiku)
Fast, cheap, runs on every metric:

```
Methods to implement:
1. Rolling z-score
   - Window: 14 days
   - Threshold: |z| > 2.5 = anomaly
   
2. Week-over-week delta
   - Threshold: > 20% change = flag
   
3. EWMA (Exponentially Weighted Moving Average)
   - Alpha: 0.3
   - Threshold: > 2 std deviations
```

### Stage 2 — Root Cause (Claude Sonnet)
Only for P0/P1 anomalies — explain WHY:

```
Prompt template:
"Given these metrics showed anomaly: {anomaly_data}
 Historical context: {last_30_days}
 Possible causes: algorithm update, technical issue,
 seasonal pattern, competitor action, content change.
 Classify root cause and explain in 2-3 sentences."
```

---

## Output — What It Writes

```typescript
// Writes to TWO tables:

// 1. agent_scratchpad table
interface ScratchpadEntry {
  agent_id: 'A08'
  run_id: string
  tenant_id: string
  findings: {
    anomalies: AnomalyResult[]
    summary: string
    metrics_checked: number
    anomalies_found: number
  }
}

// 2. anomalies table (for UI display)
interface AnomalyResult {
  metric: string        // 'organic_sessions' | 'clicks' | 'ctr' etc
  severity: 'P0' | 'P1' | 'P2'
  detected_at: Date
  value: number         // current value
  baseline: number      // expected value
  delta: number         // % change
  root_cause: string    // Claude-generated explanation
  status: 'open' | 'acknowledged' | 'resolved'
}
```

---

## Severity Classification

```
P0 — Alert immediately (client-impacting):
  - Sessions drop > 30% vs 7-day average
  - Clicks drop > 40% vs 7-day average
  - Conversions drop > 25%
  → Notify analyst immediately via dashboard alert

P1 — Investigate this week:
  - Sessions drop 15-30%
  - Position drop > 5 places on tracked keywords
  - CTR drop > 20%
  → Add to weekly review queue

P2 — Note in next report:
  - Any metric 10-15% off baseline
  - Gradual declining trends
  → Include in weekly report automatically
```

---

## New Files to Create

```
server/agents/anomaly-detection.ts     ← Main agent class
server/agents/base-agent.ts            ← Abstract base (if not exists)
server/orchestrator/scratchpad.ts      ← DB helpers (if not exists)
server/routes/agents/anomalies.ts      ← API route
client/src/components/agents/AnomalyCard.tsx  ← UI component
```

---

## API Route

```
GET  /api/agents/anomalies
     → Returns all open anomalies for tenant
     Query params: ?severity=P0&status=open

POST /api/agents/anomaly/run
     → Manually trigger anomaly detection run
     
PATCH /api/agents/anomalies/:id
      → Update status (acknowledge/resolve)
```

---

## UI Component — AnomalyCard.tsx

```
Display in: report-preview.tsx (existing page)
Position:   New section above Executive Verdict
Condition:  Only show if anomalies exist

Card shows:
- Severity badge (P0 = red, P1 = amber, P2 = gray)
- Metric name
- % delta with arrow
- Root cause explanation (1-2 sentences)
- Action button: Acknowledge / Investigate
```

---

## Integration with Existing Code

```typescript
// In report-preview.tsx — ADD these lines only
// Do NOT change existing code

// After existing data fetch:
const { data: anomalies } = useQuery({
  queryKey: ['anomalies', tenantId],
  queryFn: () => fetch('/api/agents/anomalies').then(r => r.json())
})

// In JSX — add new section, don't move existing sections:
{anomalies?.length > 0 && (
  <AnomalySection anomalies={anomalies} />
)}
```

---

## Token Budget

```
Stage 1 (Haiku):   ~500 tokens per metric, ~10 metrics = ~5,000 tokens
Stage 2 (Sonnet):  ~1,500 tokens per P0/P1 anomaly
Max per run:       ~15,000 tokens total
Cost estimate:     ~$0.04 per daily run
```

---

## Testing

```
Test with existing truefirms.co data:
1. Run agent manually via POST /api/agents/anomaly/run
2. Check anomalies table populated correctly
3. Check AnomalyCard renders in report-preview
4. Verify existing dashboard sections unchanged
5. Verify PDF download still works (computedMetrics unchanged)
```
