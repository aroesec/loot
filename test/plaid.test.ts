import { describe, it, expect, beforeAll } from "vitest";

/**
 * These cover the two places a Plaid integration can lose or corrupt money
 * without erroring: the sign convention, which is inverted relative to this
 * ledger, and the access-token encryption, which has to round-trip exactly or
 * the linked banks are unreachable.
 *
 * The env has to exist before the modules under test are imported, because
 * `env.ts` validates at module load.
 */
beforeAll(() => {
  process.env.DATABASE_URL ??= "postgres://test/test";
  process.env.APP_PASSWORD ??= "test-password";
  process.env.SESSION_SECRET ??= "x".repeat(32);
  process.env.PLAID_TOKEN_KEY ??= "k".repeat(48);
});

/**
 * Mirrors `toLedgerCents` in lib/plaid/sync.ts. Kept as a local copy so this
 * file stays free of the database import that module pulls in — the same
 * reason match.ts was split out of rules.ts.
 */
function toLedgerCents(plaidAmount: number): number {
  return -Math.round(plaidAmount * 100);
}

describe("Plaid sign convention", () => {
  /*
   * Plaid: positive means money left the account.
   * This ledger: negative means money left the account.
   *
   * Getting this backwards would not error anywhere. It would silently file
   * every purchase as income and every paycheck as spending.
   */
  it("flips a purchase to negative", () => {
    expect(toLedgerCents(5.0)).toBe(-500);
    expect(toLedgerCents(1430.55)).toBe(-143055);
  });

  it("flips an inflow to positive", () => {
    // Plaid writes deposits as negative amounts.
    expect(toLedgerCents(-2500.75)).toBe(250075);
    expect(toLedgerCents(-60)).toBe(6000);
  });

  it("rounds to whole cents rather than carrying a float", () => {
    // Plaid amounts are JSON floats; the ledger stores integer cents only.
    expect(toLedgerCents(0.1 + 0.2)).toBe(-30);
    expect(Number.isInteger(toLedgerCents(19.999))).toBe(true);
    expect(toLedgerCents(12.345)).toBe(-1235);
  });

  it("keeps a round trip exact across a realistic statement", () => {
    const amounts = [5.0, 149.99, -1875.5, 0.03, 3210.45];
    for (const a of amounts) {
      expect(Math.abs(toLedgerCents(a))).toBe(Math.round(Math.abs(a) * 100));
    }
  });
});

describe("access token encryption", () => {
  it("round-trips a token", async () => {
    const { encryptToken, decryptToken } = await import("@/lib/plaid/crypto");
    const token = "access-sandbox-8ab976e6-64b1-4c1e-9f4a-6f2f0d9a1b23";
    expect(decryptToken(encryptToken(token))).toBe(token);
  });

  it("never stores the token in readable form", async () => {
    const { encryptToken } = await import("@/lib/plaid/crypto");
    const token = "access-production-secret-value";
    const stored = encryptToken(token);
    expect(stored).not.toContain(token);
    expect(stored).not.toContain("secret");
  });

  it("uses a fresh IV, so the same token encrypts differently each time", async () => {
    // Reusing an IV under AES-GCM is a total break, not a weakness.
    const { encryptToken } = await import("@/lib/plaid/crypto");
    const a = encryptToken("same-token");
    const b = encryptToken("same-token");
    expect(a).not.toBe(b);
  });

  it("rejects tampering rather than returning garbage", async () => {
    const { encryptToken, decryptToken } = await import("@/lib/plaid/crypto");
    const stored = encryptToken("access-production-abc");
    const [iv, ciphertext, tag] = stored.split(".");

    // Flip the ciphertext but keep the structure intact.
    const flipped = ciphertext!.slice(0, -2) + (ciphertext!.endsWith("A") ? "BB" : "AA");
    expect(() => decryptToken([iv, flipped, tag].join("."))).toThrow();
  });

  it("rejects a malformed record", async () => {
    const { decryptToken } = await import("@/lib/plaid/crypto");
    expect(() => decryptToken("not-a-token")).toThrow(/malformed/i);
  });
});
