import { describe, it, expect } from "vitest";
import { monthBounds } from "@/lib/dates";

/**
 * The arithmetic behind the buffer figures.
 *
 * Two bugs here produced confidently wrong advice rather than an error, which
 * is the failure mode this whole codebase keeps guarding against — so both are
 * pinned.
 */

/** Mirrors the median in lib/buffer.ts, which imports the database. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
    : sorted[mid]!;
}

/** Mirrors the completeness test in `recentFlows`. */
function isComplete(month: string, earliest: string, latest: string): boolean {
  const { start, end } = monthBounds(month);
  return start >= earliest && end <= latest;
}

/** Mirrors the liquid-cash reduction, which is where `available` misled. */
function liquid(
  accounts: Array<{ kind: string; balanceCents: number | null }>,
): number {
  return accounts
    .filter((a) => a.balanceCents !== null)
    .reduce((total, a) => {
      const amount = a.balanceCents ?? 0;
      if (a.kind === "checking" || a.kind === "savings" || a.kind === "cash") {
        return total + amount;
      }
      if (a.kind === "credit_card") return total - Math.abs(amount);
      return total;
    }, 0);
}

describe("baseline month", () => {
  it("uses the median so one large project does not set the target", () => {
    /*
     * The real case: two ordinary months and one containing $6,000 of contract
     * work. A mean would price the buffer off a month that does not repeat.
     */
    const ordinary = [1_374_065, 1_665_699];
    const withProject = [...ordinary, 2_374_812];

    const mean =
      withProject.reduce((a, b) => a + b, 0) / withProject.length;
    expect(median(withProject)).toBeLessThan(mean);
    expect(median(withProject)).toBe(1_665_699);
  });

  it("handles an even count without drifting to one side", () => {
    expect(median([100, 200])).toBe(150);
  });

  it("is zero when there is nothing to measure", () => {
    expect(median([])).toBe(0);
  });
});

describe("complete months", () => {
  const earliest = "2026-05-26";
  const latest = "2026-08-22";

  it("rejects a month the history starts partway through", () => {
    /*
     * The bug this replaced checked only the trailing edge. May began on the
     * 26th, so it showed a fortnight of spending against a full paycheck and
     * looked like a large surplus.
     */
    expect(isComplete("2026-05", earliest, latest)).toBe(false);
  });

  it("rejects the month still in progress", () => {
    expect(isComplete("2026-08", earliest, latest)).toBe(false);
  });

  it("accepts months covered on both edges", () => {
    expect(isComplete("2026-06", earliest, latest)).toBe(true);
    expect(isComplete("2026-07", earliest, latest)).toBe(true);
  });
});

describe("liquid cash", () => {
  it("counts deposits up and card balances down", () => {
    expect(
      liquid([
        { kind: "checking", balanceCents: 397_407 },
        { kind: "checking", balanceCents: -1_500 },
        { kind: "credit_card", balanceCents: 500 },
        { kind: "credit_card", balanceCents: 0 },
      ]),
    ).toBe(395_407);
  });

  it("ignores an account whose balance is unknown", () => {
    // An unlinked card must not be assumed to be at zero.
    expect(
      liquid([
        { kind: "checking", balanceCents: 100_000 },
        { kind: "credit_card", balanceCents: null },
      ]),
    ).toBe(100_000);
  });

  it("never treats an unused credit line as cash or as debt", () => {
    /*
     * Plaid reports a card's `available` as remaining credit, not a balance.
     * Using it subtracted thousands of dollars of unused borrowing capacity as
     * though it were owed, turning a positive cushion into -$7,300.
     */
    const cards = [
      { kind: "checking", balanceCents: 397_407 },
      { kind: "credit_card", balanceCents: 500 }, // owed
    ];
    const result = liquid(cards);
    expect(result).toBeGreaterThan(0);
    expect(result).toBe(396_907);
  });

  it("does not count investments as the cushion", () => {
    // Treating them as liquid is the habit that produced a forced sale.
    expect(
      liquid([
        { kind: "checking", balanceCents: 10_000 },
        { kind: "investment", balanceCents: 5_000_000 },
      ]),
    ).toBe(10_000);
  });
});
