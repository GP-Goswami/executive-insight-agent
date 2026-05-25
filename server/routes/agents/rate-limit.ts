// Shared in-memory rate limiter for agent "run" POST endpoints.
// Limit: 10 runs per tenant per hour.
// Applied only to POST /*/run routes, not read endpoints.

import type { Request, Response, NextFunction } from "express";

interface Bucket { count: number; resetAt: number }

const store = new Map<string, Bucket>();
const MAX_RUNS = 10;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

export function agentRunRateLimit(req: Request, res: Response, next: NextFunction) {
  const tenantId =
    (req.body?.tenantId as string | undefined) ??
    (req.query?.tenantId as string | undefined);

  // If tenantId is absent the downstream handler returns 400 — skip rate check.
  if (!tenantId) return next();

  const now = Date.now();
  let bucket = store.get(tenantId);

  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    store.set(tenantId, bucket);
  }

  if (bucket.count >= MAX_RUNS) {
    const retryAfterSec = Math.ceil((bucket.resetAt - now) / 1000);
    res.set("Retry-After", String(retryAfterSec));
    return res.status(429).json({
      error: `Rate limit exceeded: max ${MAX_RUNS} agent runs per hour per tenant`,
      retryAfterSeconds: retryAfterSec,
    });
  }

  bucket.count++;
  next();
}
