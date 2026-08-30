/**
 * Reusing the way you split this merchant last time.
 *
 * DB-free, so the division can be tested — and it has to be, because the whole
 * point of a split is the invariant that the parts sum exactly to what they
 * replaced. A remembered ratio applied to a new amount is where a penny would
 * go missing if anywhere.
 *
 * **This suggests; it never applies.** Splitting on import would be inventing a
 * division of money nobody confirmed: the same shop is 70/30 one week and
 * entirely household the next, and the ledger cannot tell which from the total.
 * The tedium being fixed is re-typing the same two categories every week, not
 * the deciding — so the form arrives filled in and the person still presses the
 * button. It is the same line the classifier draws when it files something as
 * Uncategorized rather than guessing.
 */

export type PriorPart = { categoryId: string; amountCents: number };
export type SuggestedPart = { categoryId: string; amountCents: number };

/**
 * Split `totalCents` the way `prior` was split.
 *
 * Largest-remainder: every part takes its floor, then the leftover pennies go
 * to the parts with the largest fractions. Rounding each share independently
 * would lose or invent a cent, and nothing downstream re-checks the sum —
 * `db:audit-splits` would find it later, which is not the same as not doing it.
 *
 * Returns `null` when there is nothing usable to copy, so the caller can offer
 * an empty form rather than a suggestion of zero parts.
 */
export function suggestSplit(
  totalCents: number,
  prior: PriorPart[],
): SuggestedPart[] | null {
  if (prior.length < 2 || totalCents <= 0) return null;

  const priorTotal = prior.reduce((sum, p) => sum + Math.abs(p.amountCents), 0);
  if (priorTotal <= 0) return null;

  const exact = prior.map((p) => (Math.abs(p.amountCents) / priorTotal) * totalCents);
  const floors = exact.map(Math.floor);
  let remainder = totalCents - floors.reduce((a, b) => a + b, 0);

  // Biggest fractional part first, so the pennies land where they were closest
  // to being earned rather than always on the first row.
  const order = exact
    .map((value, i) => ({ i, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac);

  const cents = [...floors];
  for (const { i } of order) {
    if (remainder <= 0) break;
    cents[i]! += 1;
    remainder -= 1;
  }

  return prior.map((p, i) => ({ categoryId: p.categoryId, amountCents: cents[i]! }));
}
