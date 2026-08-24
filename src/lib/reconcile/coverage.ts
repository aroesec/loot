/**
 * Reading a card payment's coverage ratio.
 *
 * Kept free of any database import so it can be unit-tested and shared between
 * the UI and the CLI. This is the third module split out for that reason —
 * `match.ts` from `rules.ts`, `dates.ts` from `ledger.ts`, and now this — so
 * the rule is worth stating: pure logic worth testing does not live in a module
 * that imports `@/db`, because that pulls in the whole env schema.
 */

/**
 * How to read a coverage ratio.
 *
 * Pure, so it can be tested and so the UI and the CLI agree. The thresholds
 * are loose on purpose: a payment is rarely to the cent, and a few dollars of
 * drift between a statement close and a posting date is normal rather than
 * meaningful.
 */
export function describeCoverage(coverage: number | null): {
  label: string;
  detail: string;
} | null {
  if (coverage === null) return null;
  if (coverage > 1.05) {
    return {
      label: "cleared more than this window",
      detail:
        "The payment exceeds the charges since the last one, so it was also paying down a balance carried from earlier.",
    };
  }
  if (coverage < 0.95) {
    return {
      label: "balance carried",
      detail:
        "The payment covers less than the charges since the last one, so part of the balance rolled forward to the next cycle.",
    };
  }
  return {
    label: "paid in full",
    detail: "The payment matches the charges since the last one.",
  };
}
