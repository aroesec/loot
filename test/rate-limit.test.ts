import { beforeEach, describe, expect, it } from "vitest";
import { consume, limitHeaders, POLICIES, resetLimits } from "@/lib/http/rate-limit";

const policy = { name: "test", limit: 3, windowMs: 60_000 };

describe("consume", () => {
  beforeEach(resetLimits);

  it("allows up to the limit and then sheds", () => {
    const now = 1_000_000;
    expect(consume("a", policy, now).allowed).toBe(true);
    expect(consume("a", policy, now).allowed).toBe(true);
    expect(consume("a", policy, now).allowed).toBe(true);
    expect(consume("a", policy, now).allowed).toBe(false);
  });

  it("counts down remaining, and never below zero", () => {
    const now = 1_000_000;
    expect(consume("a", policy, now).remaining).toBe(2);
    expect(consume("a", policy, now).remaining).toBe(1);
    expect(consume("a", policy, now).remaining).toBe(0);
    expect(consume("a", policy, now).remaining).toBe(0);
  });

  it("keeps keys apart", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) consume("a", policy, now);
    // One caller exhausting their bucket must not shed another's traffic.
    expect(consume("b", policy, now).allowed).toBe(true);
  });

  it("keeps policies apart under the same key", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) consume("a", policy, now);
    // Uploading a lot must not lock the same person out of Plaid.
    expect(consume("a", { ...policy, name: "other" }, now).allowed).toBe(true);
  });

  it("recovers when the window rolls over", () => {
    const now = 1_000_000;
    for (let i = 0; i < 4; i++) consume("a", policy, now);
    expect(consume("a", policy, now + 60_001).allowed).toBe(true);
  });

  it("reports how long to wait", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) consume("a", policy, now);
    // 15s into a 60s window, 45s remain.
    expect(consume("a", policy, now + 15_000).retryAfter).toBe(45);
  });

  it("reports no wait while still allowed", () => {
    expect(consume("a", policy, 1_000_000).retryAfter).toBe(0);
  });
});

describe("limitHeaders", () => {
  it("omits Retry-After while the caller is within the limit", () => {
    // A Retry-After on a successful response tells a well-behaved client to
    // back off when it does not need to.
    const headers = limitHeaders({ allowed: true, limit: 3, remaining: 2, retryAfter: 0 });
    expect(headers["Retry-After"]).toBeUndefined();
    expect(headers["RateLimit-Remaining"]).toBe("2");
  });

  it("includes Retry-After once shedding", () => {
    const headers = limitHeaders({ allowed: false, limit: 3, remaining: 0, retryAfter: 45 });
    expect(headers["Retry-After"]).toBe("45");
  });
});

describe("POLICIES", () => {
  it("gives every policy a distinct name", () => {
    // Two policies sharing a name would silently share a counter, so a Plaid
    // sync could shed an upload.
    const names = Object.values(POLICIES).map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("leaves normal use well clear of every ceiling", () => {
    for (const p of Object.values(POLICIES)) {
      expect(p.limit).toBeGreaterThan(0);
      expect(p.windowMs).toBeGreaterThan(0);
    }
    // An agent making a read per tool call in a long conversation must not be
    // throttled — this is a runaway-loop ceiling, not a usage quota.
    expect(POLICIES.mcp.limit).toBeGreaterThanOrEqual(120);
  });
});
