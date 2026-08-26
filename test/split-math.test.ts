import { describe, expect, it } from "vitest";
import { divideEvenly, validateSplit } from "@/lib/split-math";

const part = (amountCents: number, categoryId = "cat") => ({ amountCents, categoryId });

/**
 * A split replaces one transaction with several that sum to it, so nothing
 * downstream re-checks the arithmetic. If these parts do not add up, a month's
 * total silently moves and no query errors.
 */
describe("validateSplit", () => {
  it("accepts parts that sum exactly", () => {
    const r = validateSplit(-24_000, [part(-14_000), part(-10_000)]);
    expect(r.ok).toBe(true);
  });

  it("rejects parts that are short, and says by how much", () => {
    const r = validateSplit(-24_000, [part(-14_000), part(-9_000)]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problem.kind).toBe("sum-mismatch");
    expect(r.problem.message).toContain("$10.00");
    expect(r.problem.message).toContain("short");
  });

  it("rejects parts that overshoot, and says so differently", () => {
    // Over and short are different mistakes; one message for both is useless.
    const r = validateSplit(-24_000, [part(-14_000), part(-11_000)]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problem.message).toContain("over");
  });

  it("rejects a single-cent discrepancy", () => {
    /*
     * The one that would slip through a tolerance. Cents are integers here
     * precisely so that "close enough" never enters the ledger.
     */
    const r = validateSplit(-24_000, [part(-14_000), part(-9_999)]);
    expect(r.ok).toBe(false);
  });

  it("needs at least two parts", () => {
    expect(validateSplit(-100, [part(-100)]).ok).toBe(false);
    expect(validateSplit(-100, []).ok).toBe(false);
  });

  it("rejects a zero part", () => {
    // Sums correctly, and would put a meaningless row in the ledger.
    const r = validateSplit(-100, [part(-100), part(0)]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem.kind).toBe("zero-part");
  });

  it("rejects a part pointing the other way", () => {
    /*
     * -100 and +50 and -50 sums to -100, so a sum check alone lets this
     * through. It would turn one payment into both spending and income, which
     * no statement line ever is.
     */
    const r = validateSplit(-100, [part(-150), part(50)]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem.kind).toBe("sign-mismatch");
  });

  it("splits a deposit too", () => {
    expect(validateSplit(500_00, [part(300_00), part(200_00)]).ok).toBe(true);
    expect(validateSplit(500_00, [part(600_00), part(-100_00)]).ok).toBe(false);
  });

  it("accepts many parts", () => {
    const parts = Array.from({ length: 8 }, () => part(-1_250));
    expect(validateSplit(-10_000, parts).ok).toBe(true);
  });
});

describe("divideEvenly", () => {
  it("gives the remainder to the earliest parts", () => {
    // $10.00 three ways is 334/333/333, never 333.33 each.
    expect(divideEvenly(-1000, 3)).toEqual([-334, -333, -333]);
  });

  it("always sums back to the original", () => {
    // The property that matters: whatever it returns has to be splittable.
    for (const total of [-1000, -1, -999_999, 7, 100_000, -33]) {
      for (const ways of [2, 3, 4, 7, 11]) {
        const parts = divideEvenly(total, ways);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
        expect(parts).toHaveLength(ways);
      }
    }
  });

  it("keeps the original sign on every part", () => {
    expect(divideEvenly(-1000, 3).every((p) => p < 0)).toBe(true);
    expect(divideEvenly(1000, 3).every((p) => p > 0)).toBe(true);
  });

  it("divides evenly when it can", () => {
    expect(divideEvenly(-900, 3)).toEqual([-300, -300, -300]);
  });

  it("handles an amount smaller than the number of parts", () => {
    // Two cents three ways: one part has to be zero, and validateSplit will
    // then reject it. Better that than inventing a cent.
    expect(divideEvenly(-2, 3)).toEqual([-1, -1, 0]);
    expect(divideEvenly(-2, 3).reduce((a, b) => a + b, 0)).toBe(-2);
  });
});
