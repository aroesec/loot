/**
 * Request rate limiting for the API routes.
 *
 * In-process, because Postgres is this app's only hard dependency and adding
 * Redis to run a personal finance ledger on a spare VPS is a worse trade than
 * the accuracy it would buy. The limits below are about **cost and abuse
 * ceilings**, not correctness — nothing in the app breaks if a request slips
 * through on a second instance.
 *
 * That per-instance weakness is real and worth naming: a serverless deployment
 * spread over N warm instances effectively multiplies every limit by N. The
 * limits are set low enough that even multiplied they still bound the damage,
 * and the routes that actually protect a secret — login, MCP tokens — are
 * additionally protected by hashing and constant-time comparison rather than by
 * this alone.
 *
 * Distinct from `auth/rate-limit.ts`, which counts *failures* and locks out.
 * This counts *requests* and sheds them. Login needs the first, because eight
 * wrong passwords is a signal in a way eight page loads is not.
 */

export type LimitPolicy = {
  /** Namespaces the bucket, so two routes never share a counter. */
  name: string;
  /** Requests permitted per window. */
  limit: number;
  windowMs: number;
};

export type LimitVerdict = {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window rolls over. */
  retryAfter: number;
};

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

/**
 * Bounded so a flood of distinct keys cannot grow the map without limit.
 *
 * Reaching this is itself abnormal for a single-household app, so the whole map
 * is dropped rather than evicting cleverly: an attacker who can pick keys must
 * not be able to steer *which* entry is discarded, and rebuilding a few live
 * counters costs one extra allowed request each.
 */
const MAX_TRACKED = 20_000;

/**
 * Count one request against a policy.
 *
 * Fixed windows rather than a sliding log: the burst-at-the-boundary weakness
 * lets through at most two windows' worth back to back, which for limits
 * measured in tens of requests is not worth the per-request memory of keeping
 * timestamps.
 */
export function consume(
  key: string,
  policy: LimitPolicy,
  now = Date.now(),
): LimitVerdict {
  const bucketKey = `${policy.name}:${key}`;
  const existing = windows.get(bucketKey);

  if (!existing || existing.resetAt <= now) {
    if (windows.size >= MAX_TRACKED) windows.clear();
    windows.set(bucketKey, { count: 1, resetAt: now + policy.windowMs });
    return {
      allowed: true,
      limit: policy.limit,
      remaining: policy.limit - 1,
      retryAfter: 0,
    };
  }

  existing.count += 1;
  const remaining = Math.max(0, policy.limit - existing.count);
  const allowed = existing.count <= policy.limit;

  return {
    allowed,
    limit: policy.limit,
    remaining,
    retryAfter: allowed ? 0 : Math.ceil((existing.resetAt - now) / 1000),
  };
}

/** Test seam. */
export function resetLimits(): void {
  windows.clear();
}

/**
 * The policies, in one place so they can be read as a set.
 *
 * Each is sized against what the route legitimately costs rather than a uniform
 * number: uploading runs a classification pass over every row, a Plaid sync
 * costs money and has the provider's own quota behind it, and reading whether
 * push is configured is nearly free.
 */
export const POLICIES = {
  /** A CSV import: parsing, dedupe, and a model pass over every new row. */
  upload: { name: "upload", limit: 10, windowMs: 60 * 60 * 1000 },
  /** Billed by Plaid per call, and the provider rate-limits it too. */
  plaidSync: { name: "plaid-sync", limit: 20, windowMs: 60 * 60 * 1000 },
  /** Link token creation precedes every connection attempt. */
  plaidLink: { name: "plaid-link", limit: 30, windowMs: 60 * 60 * 1000 },
  /** Push subscribe/unsubscribe — a handful per device, ever. */
  push: { name: "push", limit: 30, windowMs: 15 * 60 * 1000 },
  /** Sends a real notification to every device. */
  pushTest: { name: "push-test", limit: 5, windowMs: 15 * 60 * 1000 },
  /**
   * MCP tool calls. Generous, because an agent legitimately makes many small
   * reads in one conversation — this is a runaway-loop ceiling, not a guard on
   * the token, which is checked by hash.
   */
  mcp: { name: "mcp", limit: 240, windowMs: 60 * 1000 },
  /**
   * Unauthenticated attempts, keyed by address: a wrong bearer token, a wrong
   * cron secret. Tight, because there is no legitimate reason to get these
   * wrong repeatedly and each attempt is a guess at a credential.
   */
  badCredential: { name: "bad-credential", limit: 10, windowMs: 15 * 60 * 1000 },
} as const satisfies Record<string, LimitPolicy>;

/**
 * Standard headers so a client can back off rather than retry blindly.
 *
 * `Retry-After` is the one every HTTP client already understands; the
 * `RateLimit-*` pair is the draft standard and is what an MCP client is most
 * likely to read.
 */
export function limitHeaders(verdict: LimitVerdict): Record<string, string> {
  const headers: Record<string, string> = {
    "RateLimit-Limit": String(verdict.limit),
    "RateLimit-Remaining": String(verdict.remaining),
  };
  if (!verdict.allowed) {
    headers["Retry-After"] = String(verdict.retryAfter);
    headers["RateLimit-Reset"] = String(verdict.retryAfter);
  }
  return headers;
}
