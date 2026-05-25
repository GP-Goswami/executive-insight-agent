// Abstract base class for all AI agents (A01–A12).
//
// Subclasses implement run(); the base provides the cross-cutting machinery so
// every agent behaves consistently:
//   - run logging   → one agent_runs row per execution (running → completed/failed)
//   - token tracking → trackTokens(); persisted to agent_runs + scratchpad
//   - retry logic    → up to 3 retries (p-retry, exp. backoff) around run()
//   - scratchpad     → writeScratchpad() forwards to the orchestrator helper
//
// Usage:
//   class AnomalyAgent extends BaseAgent {
//     readonly agentId = "A08";
//     readonly model = "gpt-4.1-nano";        // see CLAUDE.md "Model Routing"
//     async run(tenantId: string): Promise<AgentResult> {
//       const findings = await this.detect(tenantId);  // call this.trackTokens(...)
//       await this.writeScratchpad(findings);
//       return this.result(findings);
//     }
//   }
//   const result = await new AnomalyAgent().execute(tenantId); // logging + retry

import pRetry from "p-retry";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { agentRuns } from "@shared/schema";
import { writeToScratchpad } from "../orchestrator/scratchpad";

/** Max retries (after the initial attempt) for a single agent run. */
const MAX_RETRIES = 3;

export interface AgentResult {
  agentId: string;
  runId: string;
  tenantId: string;
  status: "completed" | "failed";
  findings: Record<string, unknown> | null;
  tokensIn: number;
  tokensOut: number;
  model: string;
  error?: string;
}

export abstract class BaseAgent {
  /** Stable agent code, e.g. "A08". */
  abstract readonly agentId: string;
  /** Model id per CLAUDE.md "Model Routing", e.g. "gpt-4.1-nano". */
  abstract readonly model: string;

  protected runId: string | null = null;
  protected tenantId: string | null = null;
  protected tokensIn = 0;
  protected tokensOut = 0;

  /**
   * Core agent logic — implemented by each subclass. Inside, use this.runId,
   * this.trackTokens(...) and this.writeScratchpad(...). Prefer returning via
   * this.result(findings). Called by execute() within run-logging + retry.
   */
  abstract run(tenantId: string): Promise<AgentResult>;

  /**
   * Public entry point. Opens an agent_runs row, runs run() with retry, and
   * records the outcome (tokens, output, error). Never throws — a failed run
   * resolves to an AgentResult with status "failed".
   */
  async execute(tenantId: string): Promise<AgentResult> {
    this.tenantId = tenantId;
    this.tokensIn = 0;
    this.tokensOut = 0;

    const inputHash = await this.computeInputHash(tenantId);
    const runId = await this.startRun(tenantId, inputHash);
    this.runId = runId;

    try {
      const result = await this.withRetry(() => this.run(tenantId));
      await this.completeRun(runId, result.findings);
      this.log(`run ${runId} completed (tokens in=${this.tokensIn}, out=${this.tokensOut})`);
      return { ...result, runId, status: "completed", tokensIn: this.tokensIn, tokensOut: this.tokensOut };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.failRun(runId, message);
      this.logError(`run ${runId} failed: ${message}`);
      return {
        agentId: this.agentId,
        runId,
        tenantId,
        status: "failed",
        findings: null,
        tokensIn: this.tokensIn,
        tokensOut: this.tokensOut,
        model: this.model,
        error: message,
      };
    }
  }

  // ── Built-in: token tracking ───────────────────────────────────────────────

  /** Accumulate token usage from a model call into the current run totals. */
  protected trackTokens(input: number, output: number): void {
    this.tokensIn += input;
    this.tokensOut += output;
  }

  // ── Built-in: scratchpad write helper ──────────────────────────────────────

  /** Persist findings to the scratchpad for the current run (model + tokens attached). */
  protected async writeScratchpad(findings: Record<string, unknown>): Promise<void> {
    if (!this.tenantId || !this.runId) {
      throw new Error(`[agent:${this.agentId}] writeScratchpad() called before execute() started a run`);
    }
    await writeToScratchpad(this.agentId, this.tenantId, this.runId, findings, {
      modelUsed: this.model,
      tokensUsed: this.tokensIn + this.tokensOut,
    });
  }

  /** Convenience builder for a successful AgentResult from the current run state. */
  protected result(findings: Record<string, unknown>): AgentResult {
    return {
      agentId: this.agentId,
      runId: this.runId ?? "",
      tenantId: this.tenantId ?? "",
      status: "completed",
      findings,
      tokensIn: this.tokensIn,
      tokensOut: this.tokensOut,
      model: this.model,
    };
  }

  // ── Built-in: retry logic ──────────────────────────────────────────────────

  /** Run `fn` with up to MAX_RETRIES retries and exponential backoff. */
  protected withRetry<T>(fn: () => Promise<T>): Promise<T> {
    return pRetry(fn, {
      retries: MAX_RETRIES,
      factor: 2,
      minTimeout: 1000,
      maxTimeout: 15000,
      onFailedAttempt: ({ error, attemptNumber, retriesLeft }) => {
        this.logError(
          `attempt ${attemptNumber} failed (${retriesLeft} retries left): ${error.message}`,
        );
      },
    });
  }

  // ── Built-in: run logging to agent_runs ────────────────────────────────────

  /** Insert an agent_runs row in the "running" state; returns its id. */
  protected async startRun(tenantId: string, inputHash?: string): Promise<string> {
    const [row] = await db
      .insert(agentRuns)
      .values({
        tenantId,
        agentId: this.agentId,
        status: "running",
        inputHash: inputHash ?? null,
      })
      .returning({ id: agentRuns.id });
    return row.id;
  }

  /** Mark the run completed and persist its output + token totals. */
  protected async completeRun(runId: string, output: Record<string, unknown> | null): Promise<void> {
    await db
      .update(agentRuns)
      .set({
        status: "completed",
        completedAt: new Date(),
        output,
        tokensIn: this.tokensIn,
        tokensOut: this.tokensOut,
      })
      .where(eq(agentRuns.id, runId));
  }

  /** Mark the run failed and persist the error + token totals. */
  protected async failRun(runId: string, error: string): Promise<void> {
    await db
      .update(agentRuns)
      .set({
        status: "failed",
        completedAt: new Date(),
        error,
        tokensIn: this.tokensIn,
        tokensOut: this.tokensOut,
      })
      .where(eq(agentRuns.id, runId));
  }

  /**
   * Override to populate agent_runs.input_hash for idempotency / dedupe.
   * Default returns undefined (no hash). Use this.sha256(...) to build one.
   */
  protected async computeInputHash(_tenantId: string): Promise<string | undefined> {
    return undefined;
  }

  /** Stable SHA-256 hex digest of any JSON-serialisable value. */
  protected sha256(data: unknown): string {
    return createHash("sha256").update(JSON.stringify(data)).digest("hex");
  }

  // ── Logging ────────────────────────────────────────────────────────────────

  protected log(message: string): void {
    console.log(`[agent:${this.agentId}] ${message}`);
  }

  protected logError(message: string): void {
    console.error(`[agent:${this.agentId}] ${message}`);
  }
}
