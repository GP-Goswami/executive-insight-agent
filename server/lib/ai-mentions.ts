import OpenAI from "openai";
import { db } from "../db";
import {
  aiPromptSets,
  aiPrompts,
  aiBrandEntities,
  aiPromptRuns,
  aiMentions,
  type AiPrompt,
  type AiBrandEntity,
} from "@shared/schema";
import { eq, and, desc, gte, lte } from "drizzle-orm";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const SYSTEM_PROMPT = `You are an unbiased assistant. Answer the user's prompt as accurately as possible. Do not mention tracking or analytics. Keep the answer concise, list recommendations when applicable.`;

interface MentionAnalysis {
  mentionFound: boolean;
  mentionCount: number;
  mentionPosition: "early" | "mid" | "late" | null;
  contextSnippet: string | null;
  competitorsFound: string[];
  sentiment: "positive" | "neutral" | "negative";
  recommendationFlag: boolean;
  mentionScore: number;
}

export function analyzeMentions(
  responseText: string,
  brandEntity: AiBrandEntity
): MentionAnalysis {
  const lowerText = responseText.toLowerCase();
  const brandName = brandEntity.brandName.toLowerCase();
  const synonyms = (brandEntity.synonymsJson || []).map((s) => s.toLowerCase());
  const competitors = (brandEntity.competitorsJson || []).map((c) => c.toLowerCase());
  const allBrandTerms = [brandName, ...synonyms];

  let mentionFound = false;
  let mentionCount = 0;
  let firstMentionIndex = -1;

  for (const term of allBrandTerms) {
    const regex = new RegExp(`\\b${escapeRegex(term)}\\b`, "gi");
    const matches = responseText.match(regex);
    if (matches) {
      mentionFound = true;
      mentionCount += matches.length;
      if (firstMentionIndex === -1) {
        firstMentionIndex = lowerText.indexOf(term);
      }
    }
  }

  let mentionPosition: "early" | "mid" | "late" | null = null;
  if (firstMentionIndex !== -1) {
    const ratio = firstMentionIndex / responseText.length;
    if (ratio < 0.33) mentionPosition = "early";
    else if (ratio < 0.66) mentionPosition = "mid";
    else mentionPosition = "late";
  }

  let contextSnippet: string | null = null;
  if (firstMentionIndex !== -1) {
    const start = Math.max(0, firstMentionIndex - 50);
    const end = Math.min(responseText.length, firstMentionIndex + 150);
    contextSnippet = responseText.slice(start, end).trim();
    if (start > 0) contextSnippet = "..." + contextSnippet;
    if (end < responseText.length) contextSnippet = contextSnippet + "...";
  }

  const competitorsFound: string[] = [];
  for (const comp of competitors) {
    const regex = new RegExp(`\\b${escapeRegex(comp)}\\b`, "gi");
    if (regex.test(responseText)) {
      competitorsFound.push(comp);
    }
  }

  const sentiment = analyzeSentiment(responseText, brandName, synonyms);

  const recommendPatterns = [
    /\brecommend\b/i,
    /\bsuggested?\b/i,
    /\bbest\s+(option|choice)\b/i,
    /\btop\s+pick\b/i,
    /\bgo with\b/i,
    /\bconsider\b/i,
  ];
  let recommendationFlag = false;
  if (mentionFound) {
    for (const pattern of recommendPatterns) {
      if (pattern.test(responseText)) {
        recommendationFlag = true;
        break;
      }
    }
  }

  let mentionScore = 0;
  if (mentionFound) {
    mentionScore += 50;
    if (mentionPosition === "early") mentionScore += 20;
    else if (mentionPosition === "mid") mentionScore += 10;
    else if (mentionPosition === "late") mentionScore += 5;
    if (recommendationFlag) mentionScore += 20;
    if (sentiment === "negative") mentionScore -= 20;
    else if (sentiment === "positive") mentionScore += 5;
    if (competitorsFound.length > 0) {
      mentionScore -= Math.min(10, competitorsFound.length * 3);
    }
    mentionScore = Math.max(0, Math.min(100, mentionScore));
  }

  return {
    mentionFound,
    mentionCount,
    mentionPosition,
    contextSnippet,
    competitorsFound,
    sentiment,
    recommendationFlag,
    mentionScore,
  };
}

function analyzeSentiment(
  text: string,
  brandName: string,
  synonyms: string[]
): "positive" | "neutral" | "negative" {
  const positiveWords = ["excellent", "great", "amazing", "best", "reliable", "trusted", "recommended", "popular", "leading", "top"];
  const negativeWords = ["avoid", "poor", "bad", "worst", "unreliable", "issues", "problems", "complaints", "not recommended"];
  
  let positiveCount = 0;
  let negativeCount = 0;

  for (const word of positiveWords) {
    if (text.toLowerCase().includes(word)) positiveCount++;
  }
  for (const word of negativeWords) {
    if (text.toLowerCase().includes(word)) negativeCount++;
  }

  if (negativeCount > positiveCount) return "negative";
  if (positiveCount > negativeCount) return "positive";
  return "neutral";
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function runPrompt(
  prompt: AiPrompt,
  brandEntity: AiBrandEntity | null,
  model: string = "gpt-4o"
): Promise<{ run: typeof aiPromptRuns.$inferSelect; mention: typeof aiMentions.$inferSelect | null }> {
  const startTime = Date.now();

  const [run] = await db
    .insert(aiPromptRuns)
    .values({
      promptId: prompt.id,
      model,
      status: "running",
    })
    .returning();

  try {
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt.promptText },
      ],
      max_tokens: 1024,
    });

    const latencyMs = Date.now() - startTime;
    const responseText = completion.choices[0]?.message?.content || "";
    const inputTokens = completion.usage?.prompt_tokens || 0;
    const outputTokens = completion.usage?.completion_tokens || 0;

    const [updatedRun] = await db
      .update(aiPromptRuns)
      .set({
        status: "completed",
        latencyMs,
        inputTokens,
        outputTokens,
        responseText,
      })
      .where(eq(aiPromptRuns.id, run.id))
      .returning();

    // Always create a mention record - with or without brand entity
    let mention = null;
    if (responseText) {
      if (brandEntity) {
        const analysis = analyzeMentions(responseText, brandEntity);
        [mention] = await db
          .insert(aiMentions)
          .values({
            runId: run.id,
            mentionFound: analysis.mentionFound ? 1 : 0,
            mentionCount: analysis.mentionCount,
            mentionPosition: analysis.mentionPosition,
            contextSnippet: analysis.contextSnippet,
            competitorFoundJson: analysis.competitorsFound,
            sentiment: analysis.sentiment,
            recommendationFlag: analysis.recommendationFlag ? 1 : 0,
            mentionScore: analysis.mentionScore,
          })
          .returning();
      } else {
        // No brand entity - create placeholder mention record with empty values
        [mention] = await db
          .insert(aiMentions)
          .values({
            runId: run.id,
            mentionFound: 0,
            mentionCount: 0,
            mentionPosition: null,
            contextSnippet: null,
            competitorFoundJson: [],
            sentiment: "neutral",
            recommendationFlag: 0,
            mentionScore: 0,
          })
          .returning();
      }
    }

    return { run: updatedRun, mention };
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    const [updatedRun] = await db
      .update(aiPromptRuns)
      .set({
        status: "failed",
        latencyMs,
        errorMessage: error?.message || "Unknown error",
      })
      .where(eq(aiPromptRuns.id, run.id))
      .returning();

    return { run: updatedRun, mention: null };
  }
}

export async function runPromptSet(
  promptSetId: string,
  brandEntityId: string | null,
  model: string = "gpt-4o"
): Promise<{ completed: number; failed: number; total: number }> {
  const prompts = await db
    .select()
    .from(aiPrompts)
    .where(eq(aiPrompts.promptSetId, promptSetId));

  let brandEntity: AiBrandEntity | null = null;
  if (brandEntityId) {
    const [entity] = await db
      .select()
      .from(aiBrandEntities)
      .where(eq(aiBrandEntities.id, brandEntityId));
    brandEntity = entity || null;
  }

  let completed = 0;
  let failed = 0;

  for (const prompt of prompts) {
    const result = await runPrompt(prompt, brandEntity, model);
    if (result.run.status === "completed") {
      completed++;
    } else {
      failed++;
    }
  }

  return { completed, failed, total: prompts.length };
}

export async function getPromptSetResults(
  promptSetId: string,
  startDate?: Date,
  endDate?: Date
) {
  const prompts = await db
    .select()
    .from(aiPrompts)
    .where(eq(aiPrompts.promptSetId, promptSetId));

  const promptIds = prompts.map((p) => p.id);
  
  if (promptIds.length === 0) {
    return { prompts: [], runs: [], mentions: [] };
  }

  let runsQuery = db
    .select()
    .from(aiPromptRuns)
    .orderBy(desc(aiPromptRuns.runAt));

  const runs = await runsQuery;
  const filteredRuns = runs.filter((r) => {
    if (!promptIds.includes(r.promptId)) return false;
    if (startDate && r.runAt && r.runAt < startDate) return false;
    if (endDate && r.runAt && r.runAt > endDate) return false;
    return true;
  });

  const runIds = filteredRuns.map((r) => r.id);
  const mentions = runIds.length > 0
    ? await db.select().from(aiMentions)
    : [];
  const filteredMentions = mentions.filter((m) => runIds.includes(m.runId));

  return { prompts, runs: filteredRuns, mentions: filteredMentions };
}

export async function getAiMentionsStats(
  promptSetId: string,
  startDate?: Date,
  endDate?: Date
) {
  const { prompts, runs, mentions } = await getPromptSetResults(
    promptSetId,
    startDate,
    endDate
  );

  const totalPrompts = prompts.length;
  const totalRuns = runs.length;
  const completedRuns = runs.filter((r) => r.status === "completed").length;
  
  // Safely handle mentions - normalize mentionFound to number
  const mentionsWithData = mentions.filter((m) => {
    const found = typeof m.mentionFound === 'number' ? m.mentionFound : 0;
    return found === 1;
  });
  
  const coverage = completedRuns > 0 
    ? Math.round((mentionsWithData.length / completedRuns) * 100) 
    : 0;
  
  const avgScore = mentionsWithData.length > 0
    ? Math.round(mentionsWithData.reduce((sum, m) => sum + (Number(m.mentionScore) || 0), 0) / mentionsWithData.length)
    : 0;

  const promptsWithMention = new Set(
    runs
      .filter((r) => {
        const mention = mentions.find((m) => m.runId === r.id);
        const found = mention ? (typeof mention.mentionFound === 'number' ? mention.mentionFound : 0) : 0;
        return found === 1;
      })
      .map((r) => r.promptId)
  );

  const promptsMissing = prompts.filter((p) => !promptsWithMention.has(p.id));

  return {
    totalPrompts,
    totalRuns,
    completedRuns,
    coverage: isNaN(coverage) ? 0 : coverage,
    avgScore: isNaN(avgScore) ? 0 : avgScore,
    mentionCount: mentionsWithData.length,
    promptsMissing: promptsMissing.slice(0, 5),
  };
}
