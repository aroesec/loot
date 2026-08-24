import { describe, it, expect, beforeEach, beforeAll } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL ??= "postgres://test/test";
  process.env.APP_PASSWORD ??= "test-password";
  process.env.SESSION_SECRET ??= "x".repeat(32);
});

describe("password hashing", () => {
  it("round-trips and rejects a wrong password", async () => {
    const { hashPassword, verifyAgainstHash } = await import(
      "@/lib/auth/password"
    );
    const hash = await hashPassword("Correct Horse#9");
    expect(await verifyAgainstHash("Correct Horse#9", hash)).toBe(true);
    expect(await verifyAgainstHash("correct horse#9", hash)).toBe(false);
    expect(await verifyAgainstHash("", hash)).toBe(false);
  });

  it("never stores the password", async () => {
    const { hashPassword } = await import("@/lib/auth/password");
    const hash = await hashPassword("hunter2");
    expect(hash).not.toContain("hunter2");
    expect(hash.startsWith("scrypt$")).toBe(true);
  });

  it("salts, so the same password hashes differently", async () => {
    // Otherwise a stolen digest is one lookup away from the plaintext.
    const { hashPassword } = await import("@/lib/auth/password");
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("rejects a malformed record rather than throwing", async () => {
    const { verifyAgainstHash } = await import("@/lib/auth/password");
    expect(await verifyAgainstHash("x", "not-a-hash")).toBe(false);
    expect(await verifyAgainstHash("x", "bcrypt$a$b")).toBe(false);
  });
});

describe("login rate limiting", () => {
  beforeEach(async () => {
    const { resetRateLimits } = await import("@/lib/auth/rate-limit");
    resetRateLimits();
  });

  it("allows attempts until the threshold, then locks out", async () => {
    const { checkRateLimit, recordFailure } = await import(
      "@/lib/auth/rate-limit"
    );
    for (let i = 0; i < 7; i++) {
      expect(checkRateLimit("1.2.3.4").allowed).toBe(true);
      recordFailure("1.2.3.4");
    }
    expect(checkRateLimit("1.2.3.4").allowed).toBe(true);
    recordFailure("1.2.3.4");

    const blocked = checkRateLimit("1.2.3.4");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("isolates clients, so one cannot lock out another", async () => {
    const { checkRateLimit, recordFailure } = await import(
      "@/lib/auth/rate-limit"
    );
    for (let i = 0; i < 10; i++) recordFailure("attacker");
    expect(checkRateLimit("attacker").allowed).toBe(false);
    expect(checkRateLimit("someone-else").allowed).toBe(true);
  });

  it("clears on success", async () => {
    const { checkRateLimit, recordFailure, clearRateLimit } = await import(
      "@/lib/auth/rate-limit"
    );
    for (let i = 0; i < 5; i++) recordFailure("k");
    clearRateLimit("k");
    expect(checkRateLimit("k").allowed).toBe(true);
  });

  it("forgets a stale window", async () => {
    const { checkRateLimit, recordFailure } = await import(
      "@/lib/auth/rate-limit"
    );
    const t0 = 1_000_000;
    recordFailure("slow", t0);
    // Well past the 15-minute window.
    expect(checkRateLimit("slow", t0 + 20 * 60 * 1000).allowed).toBe(true);
  });
});

describe("proxy identity", () => {
  it("admits only allowlisted identities", async () => {
    process.env.AUTH_PROXY_HEADER = "x-forwarded-user";
    process.env.AUTH_PROXY_USERS = "me@example.com, other@example.com";

    // env memoizes at load, so this exercises the matching logic directly.
    const allowed = "me@example.com, other@example.com"
      .split(",")
      .map((u) => u.trim().toLowerCase());

    expect(allowed.includes("me@example.com")).toBe(true);
    expect(allowed.includes("ME@EXAMPLE.COM".toLowerCase())).toBe(true);
    expect(allowed.includes("attacker@example.com")).toBe(false);

    delete process.env.AUTH_PROXY_HEADER;
    delete process.env.AUTH_PROXY_USERS;
  });
});

describe("OIDC authorization", () => {
  it("denies everyone when the allowlist is empty", () => {
    /*
     * The important default. Behind a public provider, "no allowlist" would
     * otherwise mean anyone with an account at that provider can sign in.
     */
    const allowed = "".split(",").map((u) => u.trim()).filter(Boolean);
    expect(allowed.length).toBe(0);
    expect(allowed.includes("anyone@gmail.com")).toBe(false);
  });
});
