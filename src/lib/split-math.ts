/**
 * Validating a split before it touches the ledger.
 *
 * DB-free so it can be tested without a database.
 *
 * A split replaces one transaction with several that sum to it. That shape was
 * chosen over parent-and-children because 54 places in this codebase build
 * their own transactions query and 17 filter transfers by hand: a parent row
 * that every total must remember to exclude is a standing invitation to
 * double-count, and double-counting is exactly how $6,000 of spending once
 * disappeared from a month. Siblings that sum to the original are correct in
 * every existing query without changing any of them.
 *
 * The cost of that choice is that the arithmetic has to be exact here, because
 * nothing downstream will catch it. If the parts do not sum to the original,
 * the month's total silently moves.
 */

export type SplitPart = {
  /** Signed cents, same sign as the original. */
  amountCents: number;
  categoryId: string;
  note?: string | null;
};

export type SplitProblem =
  | { kind: "too-few"; message: string }
  | { kind: "zero-part"; message: string }
  | { kind: "sign-mismatch"; message: string }
  | { kind: "sum-mismatch"; message: string; differenceCents: number };

export type SplitCheck =
  | { ok: true; parts: SplitPart[] }
  | { ok: false; problem: SplitProblem };

export function validateSplit(
  originalCents: number,
  parts: SplitPart[],
): SplitCheck {
  if (parts.length < 2) {
    return {
      ok: false,
      problem: { kind: "too-few", message: "A split needs at least two parts." },
    };
  }

  if (parts.some((p) => p.amountCents === 0)) {
    return {
      ok: false,
      problem: {
        kind: "zero-part",
        // A zero part is either a mistake or a category the person meant to
        // remove. Either way it should not become a row in the ledger.
        message: "Every part needs an amount. Remove the empty one.",
      },
    };
  }

  /*
   * All parts share the original's direction. A split with a positive and a
   * negative part would still sum correctly while turning one transaction into
   * both income and spending, which no statement line ever is.
   */
  const originalSign = Math.sign(originalCents);
  if (parts.some((p) => Math.sign(p.amountCents) !== originalSign)) {
    return {
      ok: false,
      problem: {
        kind: "sign-mismatch",
        message:
          originalCents < 0
            ? "Every part of a payment has to be money going out."
            : "Every part of a deposit has to be money coming in.",
      },
    };
  }

  const total = parts.reduce((sum, p) => sum + p.amountCents, 0);
  if (total !== originalCents) {
    const difference = originalCents - total;
    /*
     * Compared as magnitudes, not signed values. On an outflow both numbers are
     * negative, so `originalCents - total` is negative when the parts fall
     * *short* — reading that sign directly reports every shortfall as an
     * overshoot and every overshoot as a shortfall.
     */
    const short = Math.abs(total) < Math.abs(originalCents);
    return {
      ok: false,
      problem: {
        kind: "sum-mismatch",
        differenceCents: difference,
        message: short
          ? `The parts are ${fmt(Math.abs(difference))} short of the total.`
          : `The parts are ${fmt(Math.abs(difference))} over the total.`,
      },
    };
  }

  return { ok: true, parts };
}

function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Split an amount evenly, giving the remainder to the first parts.
 *
 * Integer cents do not divide evenly. $10.00 in three is 333, 333, 334 — never
 * 333.33 each, which would either lose a cent or introduce a float into a
 * ledger that has none. The remainder goes to the earliest parts so the result
 * is deterministic rather than depending on iteration order.
 */
export function divideEvenly(totalCents: number, ways: number): number[] {
  if (ways < 1) return [];

  const sign = totalCents < 0 ? -1 : 1;
  const magnitude = Math.abs(totalCents);
  const base = Math.floor(magnitude / ways);
  const remainder = magnitude - base * ways;

  return Array.from({ length: ways }, (_, i) => {
    const value = base + (i < remainder ? 1 : 0);
    // `-1 * 0` is `-0`, which compares equal to 0 but serializes as "-0" and
    // shows up as a distinct value in a diff.
    return value === 0 ? 0 : sign * value;
  });
}
