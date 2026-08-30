/**
 * Carrying a budget between months.
 *
 * DB-free so the arithmetic is testable, like `tax-math.ts`. The database layer
 * decides which months to hand over; this decides what they add up to.
 *
 * A calendar month is an accounting artifact, not how money is actually spent.
 * Real costs are lumpy — a car service, an annual renewal, a birthday — and a
 * budget that resets on the 1st scores three deliberate months of underspending
 * as three wins followed by one failure. Rollover lets the underspend be the
 * plan it actually was.
 *
 * **This changes a number the user already acts on**, which is why it is off
 * unless asked for, per budget rather than globally. A groceries line reading
 * $680 against a $600 budget has to be because someone chose that, not because
 * a deploy happened.
 *
 * Turning it on has no retroactive effect either. Saving a budget writes a new
 * effective-dated version, and the carry window starts there — so switching
 * rollover on today begins accumulating next month rather than presenting a
 * balance built from months nobody was budgeting under these rules. The switch
 * never makes a figure jump on the way in, and turning it off restores exactly
 * the numbers that were there before.
 */

export const ROLLOVER_MODES = [
  {
    value: "none",
    label: "No rollover",
    hint: "Each month starts fresh. What you did not spend is not carried.",
  },
  {
    value: "under",
    label: "Carry what is left",
    hint: "Underspending is added to next month. Overspending is not carried as a debt — the balance stops at zero.",
  },
  {
    value: "both",
    label: "Carry both ways",
    hint: "Underspending is added and overspending is subtracted, so a month you go over leaves you less to work with. Strictest, and the truest to envelope budgeting.",
  },
] as const;

export type RolloverMode = (typeof ROLLOVER_MODES)[number]["value"];

export function isRolloverMode(value: string): value is RolloverMode {
  return ROLLOVER_MODES.some((m) => m.value === value);
}

/** One prior month of the same budget, oldest first. */
export type PriorMonth = { budgetedCents: number; spentCents: number };

/**
 * What a month starts with on top of its own budget.
 *
 * Positive means money carried in, negative means a debt carried in — only
 * possible under `both`.
 *
 * The running balance is *consumed* by overspending in every mode that carries
 * anything, which is the part worth being careful about. Under `under`, a month
 * that spends into the carried surplus reduces it; the mode only refuses to let
 * the balance go below zero. Accumulating underspend while ignoring overspend
 * would produce a pot that only ever grows — a number that says you can afford
 * something you cannot, which is exactly the failure this codebase exists to
 * avoid.
 */
export function carriedInCents(mode: RolloverMode, months: PriorMonth[]): number {
  if (mode === "none") return 0;

  let running = 0;
  for (const m of months) {
    running += m.budgetedCents - m.spentCents;
    // `under` forgives a deficit rather than carrying it forward; `both` keeps
    // it, which is what makes it the honest-but-strict option.
    if (mode === "under" && running < 0) running = 0;
  }
  return running;
}

/**
 * What is actually available this month: the budget plus whatever carried.
 *
 * Floored at zero. A carried debt larger than the month's budget would
 * otherwise show a negative allowance, which reads as "you may not buy food"
 * rather than "you are behind" — the debt is still visible as the carried
 * figure beside it.
 */
export function availableCents(budgetCents: number, carriedCents: number): number {
  return Math.max(0, budgetCents + carriedCents);
}
