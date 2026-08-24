/**
 * Login throttling.
 *
 * In-process and therefore per-instance, which is the right trade for a
 * self-hosted single-user app: no Redis to run, and the thing it defends
 * against — someone grinding guesses at a password — is slowed enough to be
 * useless well before the bookkeeping cost matters.
 *
 * It is deliberately *not* a security boundary on its own. A serverless
 * deployment with many cold instances weakens it, which is why the password is
 * also hashed and the comparison is constant-time. Defence in depth, not a
 * single wall.
 */

type Bucket = { failures: number; firstFailureAt: number; lockedUntil: number };

const buckets = new Map<string, Bucket>();

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;
const LOCKOUT_MS = 15 * 60 * 1000;
/** Bounded so a flood of distinct keys cannot grow the map without limit. */
const MAX_TRACKED = 10_000;

export type RateLimitResult = {
  allowed: boolean;
  /** Seconds until the caller may try again. Zero when allowed. */
  retryAfter: number;
};

export function checkRateLimit(key: string, now = Date.now()): RateLimitResult {
  const bucket = buckets.get(key);
  if (!bucket) return { allowed: true, retryAfter: 0 };

  if (bucket.lockedUntil > now) {
    return {
      allowed: false,
      retryAfter: Math.ceil((bucket.lockedUntil - now) / 1000),
    };
  }

  // The window has passed with no lockout — forget the history.
  if (now - bucket.firstFailureAt > WINDOW_MS) {
    buckets.delete(key);
  }
  return { allowed: true, retryAfter: 0 };
}

export function recordFailure(key: string, now = Date.now()): void {
  if (buckets.size >= MAX_TRACKED && !buckets.has(key)) {
    // Drop the oldest rather than refusing to track — an attacker should not
    // be able to evict their own bucket by flooding new keys.
    const oldest = [...buckets.entries()].sort(
      (a, b) => a[1].firstFailureAt - b[1].firstFailureAt,
    )[0];
    if (oldest) buckets.delete(oldest[0]);
  }

  const bucket = buckets.get(key) ?? {
    failures: 0,
    firstFailureAt: now,
    lockedUntil: 0,
  };

  if (now - bucket.firstFailureAt > WINDOW_MS) {
    bucket.failures = 0;
    bucket.firstFailureAt = now;
  }

  bucket.failures += 1;
  if (bucket.failures >= MAX_FAILURES) {
    bucket.lockedUntil = now + LOCKOUT_MS;
    bucket.failures = 0;
    bucket.firstFailureAt = now;
  }
  buckets.set(key, bucket);
}

export function clearRateLimit(key: string): void {
  buckets.delete(key);
}

/** Test seam. */
export function resetRateLimits(): void {
  buckets.clear();
}
