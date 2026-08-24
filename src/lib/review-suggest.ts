/**
 * Choosing which categories to offer as one-key answers.
 *
 * A keyboard queue is only faster than a dropdown if the right answer is
 * usually among the first few keys. Getting the *order* right is therefore the
 * whole feature, and it is ordinary ranking rather than anything clever:
 * what this merchant was last time, then what money of this direction usually
 * is, then everything else behind a search.
 *
 * DB-free so it can be tested without a database, like `match.ts` and
 * `dates.ts`.
 */

export type Suggestion = {
  categoryId: string;
  name: string;
  /** Shown next to the key, so the offer explains itself. */
  why: string;
};

export type MerchantUse = { categoryId: string; name: string; count: number };
export type PopularUse = {
  categoryId: string;
  name: string;
  kind: string;
  count: number;
};

/**
 * @param amountCents Sign decides which half of the chart is plausible.
 *   Money arriving is not a restaurant, and offering one as key 1 is how a
 *   fast queue produces a wrong answer faster.
 */
export function suggestFor(input: {
  amountCents: number;
  merchant: string | null;
  current: { id: string; name: string } | null;
  merchantHistory: MerchantUse[];
  popular: PopularUse[];
  max?: number;
}): Suggestion[] {
  const max = input.max ?? 9;
  const out: Suggestion[] = [];
  const seen = new Set<string>();

  const add = (categoryId: string, name: string, why: string) => {
    if (seen.has(categoryId) || out.length >= max) return;
    seen.add(categoryId);
    out.push({ categoryId, name, why });
  };

  /*
   * The existing guess leads, because confirming is the most common outcome —
   * these rows are uncertain, not necessarily wrong, and a queued payment rail
   * has already been filed somewhere real.
   */
  if (input.current) {
    add(input.current.id, input.current.name, "current");
  }

  /*
   * What this merchant has been before. The strongest signal available, and
   * the same one `quality.ts` uses in reverse to find misfiled rows — a
   * merchant that is nine-tenths one category is telling you something.
   */
  for (const use of [...input.merchantHistory].sort((a, b) => b.count - a.count)) {
    add(
      use.categoryId,
      use.name,
      use.count === 1 ? "filed here once" : `filed here ${use.count}×`,
    );
  }

  /*
   * Then whatever money of this direction usually is. An income category
   * cannot be the answer for money going out, and vice versa — the sign is the
   * one thing about these rows that is never in doubt.
   */
  const wantKind = input.amountCents > 0 ? "income" : "expense";
  for (const use of [...input.popular].sort((a, b) => b.count - a.count)) {
    if (use.kind !== wantKind) continue;
    add(use.categoryId, use.name, "common");
  }

  return out;
}

/**
 * Whether a row can be answered by confirming what is already there.
 *
 * A queued rail has a real category that was never in question — the rule filed
 * it deliberately and asked a different question, "what was it *for*". So
 * "confirm" means something for those rows and nothing for a row with no
 * category at all.
 */
export function canConfirm(item: {
  categoryId: string | null;
  categoryName: string | null;
}): boolean {
  return Boolean(item.categoryId && item.categoryName);
}
