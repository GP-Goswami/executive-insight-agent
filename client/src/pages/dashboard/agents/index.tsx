// Agent configuration registry — single source of truth for all 12 SEO agents.
// Imported by AgentPage.tsx (page layout) and app-sidebar.tsx (status dots).

export type AgentStatus = "active" | "coming_soon";

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  model: string;
  trigger: string;
  status: AgentStatus;
  apiEndpoint: string | null;
  requiredIntegrations: string[];
}

export type AgentId = keyof typeof AGENT_CONFIG;

export const AGENT_CONFIG = {
  A01: {
    id: "A01",
    name: "Data Ingestion Orchestrator",
    description:
      "Pulls fresh data from every connected source on schedule. Normalises to canonical schema and writes to the per-tenant data lake.",
    model: "gpt-4.1-nano",
    trigger: "Daily — 3:00 AM",
    status: "coming_soon" as AgentStatus,
    apiEndpoint: null,
    requiredIntegrations: ["SEMrush", "DataForSEO"],
  },
  A02: {
    id: "A02",
    name: "Keyword Intelligence Agent",
    description:
      "Tracks ranking deltas, SERP feature presence, opportunity gaps and cannibalization signals. Flags keyword movement above configurable threshold.",
    model: "gpt-4.1",
    trigger: "Weekly — Monday",
    status: "active" as AgentStatus,
    apiEndpoint: "/api/agents/keywords/run",
    requiredIntegrations: ["GSC"],
  },
  A03: {
    id: "A03",
    name: "Technical SEO Audit Agent",
    description:
      "Interprets crawl outputs, Core Web Vitals trends, indexation health, schema coverage and hreflang errors. Writes issue tickets prioritised by impact.",
    model: "gpt-4.1",
    trigger: "Weekly",
    status: "coming_soon" as AgentStatus,
    apiEndpoint: null,
    requiredIntegrations: ["DataForSEO"],
  },
  A04: {
    id: "A04",
    name: "Content Performance Agent",
    description:
      "Identifies top performers and decaying pages. Detects content gaps vs competitors and internal linking deficiencies. Proposes refresh candidates.",
    model: "gpt-4.1",
    trigger: "Weekly — Monday",
    status: "active" as AgentStatus,
    apiEndpoint: "/api/agents/content/run",
    requiredIntegrations: ["GA4"],
  },
  A05: {
    id: "A05",
    name: "Backlink Intelligence Agent",
    description:
      "Monitors new and lost links, link velocity, toxic link signals and anchor distribution. Proposes outreach targets for link building.",
    model: "gpt-4.1",
    trigger: "Weekly",
    status: "coming_soon" as AgentStatus,
    apiEndpoint: null,
    requiredIntegrations: ["Ahrefs", "SEMrush"],
  },
  A06: {
    id: "A06",
    name: "Competitor Analysis Agent",
    description:
      "Tracks share of voice against configured competitor set. Analyses ranking pair wins and losses, content overlap and backlink overlap.",
    model: "gpt-4.1",
    trigger: "Weekly",
    status: "coming_soon" as AgentStatus,
    apiEndpoint: null,
    requiredIntegrations: ["SEMrush"],
  },
  A07: {
    id: "A07",
    name: "AEO / GEO Visibility Agent",
    description:
      "Queries ChatGPT and Claude on tracked query sets. Measures brand citation share across AI engines and flags citation drift week over week.",
    model: "gpt-4.1-nano",
    trigger: "On demand",
    status: "active" as AgentStatus,
    apiEndpoint: "/api/agents/aeo/run",
    requiredIntegrations: ["OpenAI", "Claude"],
  },
  A08: {
    id: "A08",
    name: "Anomaly Detection Agent",
    description:
      "Runs daily statistical anomaly detection over all key time series. Classifies severity as P0, P1 or P2 and routes to triage queue.",
    model: "gpt-4.1-nano + o3",
    trigger: "Daily — 3:00 AM",
    status: "active" as AgentStatus,
    apiEndpoint: "/api/agents/anomaly/run",
    requiredIntegrations: ["GA4", "GSC"],
  },
  A09: {
    id: "A09",
    name: "Recommendation Synthesis Agent",
    description:
      "Reads all upstream agent scratchpads. Deduplicates and prioritises observations. Produces ranked action list with rationale and effort estimates.",
    model: "gpt-4.1",
    trigger: "Weekly — Monday",
    status: "active" as AgentStatus,
    apiEndpoint: "/api/agents/recommendations/run",
    requiredIntegrations: ["A08", "A02", "A04"],
  },
  A10: {
    id: "A10",
    name: "Report Composition Agent",
    description:
      "Drafts client-ready weekly and monthly reports in house style. Produces both branded PDF and dashboard-native versions with full audit trail.",
    model: "gpt-4.1",
    trigger: "Weekly — Monday",
    status: "active" as AgentStatus,
    apiEndpoint: "/api/agents/report/run",
    requiredIntegrations: ["A09"],
  },
  A11: {
    id: "A11",
    name: "Quality Review Agent",
    description:
      "Runs structured pre-flight check on every draft report. Verifies factual consistency, tone, completeness and brand style compliance.",
    model: "gpt-4.1",
    trigger: "After A10",
    status: "active" as AgentStatus,
    apiEndpoint: "/api/agents/qa/run",
    requiredIntegrations: ["A10"],
  },
  A12: {
    id: "A12",
    name: "Client Communication Agent",
    description:
      "Drafts cover email accompanying the approved report in analyst voice. Never sends without explicit analyst sign-off from review queue.",
    model: "gpt-4.1",
    trigger: "After approval",
    status: "active" as AgentStatus,
    apiEndpoint: "/api/agents/communication/run",
    requiredIntegrations: ["A10"],
  },
} as const satisfies Record<string, AgentConfig>;

export const AGENT_IDS = Object.keys(AGENT_CONFIG) as AgentId[];

// Short labels used in sidebar
export const AGENT_SHORT_NAMES: Record<string, string> = {
  A01: "Data Ingestion",
  A02: "Keyword Intel",
  A03: "Technical SEO",
  A04: "Content Perf.",
  A05: "Backlink Intel",
  A06: "Competitor",
  A07: "AEO / GEO",
  A08: "Anomaly Detect.",
  A09: "Recommendations",
  A10: "Report Composer",
  A11: "Quality Review",
  A12: "Communication",
};
