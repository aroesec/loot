import { describe, expect, it } from "vitest";
import {
  availableCents,
  carriedInCents,
  isRolloverMode,
} from "@/lib/budget-rollover";

const m = (budgetedCents: number, spentCents: number) => ({ budgetedCents, spentCents });

describe("carriedInCents", () => {
  it("carries nothing when rollover is off", () => {
    // The default, and the reason turning it on cannot change a number by
    // accident: an existing budget behaves exactly as it did.
    expect(carriedInCents("none", [m(60000, 52000)])).toBe(0);
    expect(carriedInCents("none", [])).toBe(0);
  });

  it("carries an underspend forward", () => {
    // $600 budget, $520 spent → $80 into next month.
    expect(carriedInCents("under", [m(60000, 52000)])).toBe(8000);
    expect(carriedInCents("both", [m(60000, 52000)])).toBe(8000);
  });

  it("accumulates across several months", () => {
    const saving = [m(60000, 52000), m(60000, 55000), m(60000, 50000)];
    expect(carriedInCents("under", saving)).toBe(8000 + 5000 + 10000);
  });
});

/**
 * The case that separates the two carrying modes, and the one most likely to
 * be got wrong: a surplus has to be *spendable*. A mode that adds underspend
 * while ignoring overspend produces a pot that only ever grows — a number
 * telling you that you can afford something you cannot.
 */
describe("overspending", () => {
  it("consumes the carried surplus under `under`, rather than being ignored", () => {
    // $80 carried in, then a month $50 over: $30 left, not $80.
    const months = [m(60000, 52000), m(60000, 65000)];
    expect(carriedInCents("under", months)).toBe(3000);
  });

  it("floors at zero under `under` and goes negative under `both`", () => {
    const blown = [m(60000, 75000)];
    expect(carriedInCents("under", blown)).toBe(0);
    expect(carriedInCents("both", blown)).toBe(-15000);
  });

  it("lets `both` recover from a debt", () => {
    const months = [m(60000, 75000), m(60000, 50000)];
    // -$150 then +$100 → still $50 behind.
    expect(carriedInCents("both", months)).toBe(-5000);
  });
});

describe("availableCents", () => {
  it("adds the carry to this month's budget", () => {
    expect(availableCents(60000, 8000)).toBe(68000);
  });

  it("never shows a negative allowance, however far behind you are", () => {
    // The debt is still reported as the carried figure; the allowance itself
    // reads as nothing left rather than as a negative amount of groceries.
    expect(availableCents(60000, -75000)).toBe(0);
  });
});

describe("isRolloverMode", () => {
  it("accepts the modes offered and rejects anything else", () => {
    expect(isRolloverMode("both")).toBe(true);
    expect(isRolloverMode("carry-forward")).toBe(false);
  });
});
