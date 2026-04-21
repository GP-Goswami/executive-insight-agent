import OpenAI from "openai";
import type { Insight } from "./insight-engine";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const SYSTEM_PROMPT = `You are a senior SEO strategist writing executive-level
performance summaries for a client reporting platform. Your role is to
synthesize structured insights into a confident, boardroom-ready narrative.

STRICT OUTPUT RULES:
- Output exactly ONE paragraph, 4-6 sentences long
- No bullet points, headers, lists, or line breaks within the paragraph
- No markdown formatting of any kind
- Never perform arithmetic or derive figures not explicitly present in the provided insights JSON. If a number does not appear in the insights data, do not include it.

CONTENT RULES:
- Base your summary EXCLUSIVELY on the structured insights provided
- Never invent context: no seasonality, algorithm updates, competitor
  activity, or market forces unless explicitly stated in the insights
- Never use hedging language. Banned words: may, might, could, possibly,
  perhaps, seems, appears, likely
- Never repeat insight text verbatim — synthesize, do not transcribe
- Never introduce metrics or figures not present in the insights

NARRATIVE STRUCTURE — follow this arc exactly:
1. Open with the dominant signal — if warnings outnumber positives, lead
   with the most critical warning. If positives dominate, lead with the
   strongest win. State what happened, not why.
2. Layer in supporting or contrasting signals to complete the picture
3. Surface the primary risk or opportunity that needs attention
4. Close with a forward-looking action — grounded only in what the data
   shows, never speculative

TONE:
- Authoritative, direct, precise — written for C-suite or senior client
- Confident declarative sentences, minimal passive voice
- Professional but not robotic`;

function buildUserPrompt(insights: Insight[]): string {
  const positive = insights.filter(i => i.type === "positive");
  const warning = insights.filter(i => i.type === "warning");
  const neutral = insights.filter(i => i.type === "neutral");

  const byCategory = insights.reduce((acc, insight) => {
    if (!acc[insight.category]) acc[insight.category] = [];
    acc[insight.category].push(insight);
    return acc;
  }, {} as Record<string, Insight[]>);

  const dominantSignal = warning.length > positive.length
    ? "WARNING — more risks than positives this period"
    : positive.length > warning.length
    ? "POSITIVE — more wins than risks this period"
    : "MIXED — risks and positives are balanced";

  return `Generate an executive SEO performance summary from the insights below.

DOMINANT SIGNAL: ${dominantSignal}

WARNING SIGNALS (${warning.length}) — highest priority, lead with these if present:
${warning.length > 0 ? JSON.stringify(warning, null, 2) : "None"}

POSITIVE SIGNALS (${positive.length}):
${positive.length > 0 ? JSON.stringify(positive, null, 2) : "None"}

NEUTRAL / OBSERVATIONS (${neutral.length}) — supporting context only:
${neutral.length > 0 ? JSON.stringify(neutral, null, 2) : "None"}

INSIGHTS BY CATEGORY:
${JSON.stringify(byCategory, null, 2)}

TASK: Write a single paragraph (4-6 sentences) following the narrative arc
in your instructions. The DOMINANT SIGNAL line above tells you how to open.
Use only the data above. No speculation. No bullet points.`;
}

export async function generateNarrative(insights: Insight[]): Promise<string> {
  if (insights.length === 0) {
    return "No actionable insights are available for the selected period. " +
           "Ensure data sources are connected and metrics are being collected.";
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.3,
    max_tokens: 500,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(insights) },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("AI returned an empty response");
  }

  return content.trim();
}
