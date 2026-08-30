import { and, desc, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { transactions } from "@/db/schema";
import { suggestSplit, type PriorPart } from "./split-suggest";

export { suggestSplit } from "./split-suggest";

/**
 * The most recent split of each of these merchants.
 *
 * Batched for the whole page rather than looked up per row: a transactions page
 * renders fifty rows, and a query each would be a hundred round trips to fill
 * in a form most of them will never open.
 *
 * Keyed on `merchant` rather than the raw description, which carries a date and
 * a store number and would never match twice. `merchant` is what the rules
 * already normalise to, so this rides on work the classifier has done instead
 * of inventing its own matching.
 */
export async function priorSplitsByMerchant(
  merchants: Array<string | null>,
): Promise<Map<string, PriorPart[]>> {
  const names = [...new Set(merchants.filter((m): m is string => Boolean(m)))];
  const byMerchant = new Map<string, PriorPart[]>();
  if (names.length === 0) return byMerchant;

  /*
   * The query builder rather than `DISTINCT ON` in a raw template. The first
   * attempt passed the merchant list as `merchant = ANY(${names})`, which does
   * not render a Postgres array literal — it fails with 22P02 at runtime, not
   * at typecheck. Picking the newest group per merchant in JS is expressible
   * with the builder, and splits are rare enough that the rows are few.
   */
  const split = await db
    .select({
      merchant: transactions.merchant,
      groupId: transactions.splitGroupId,
      categoryId: transactions.categoryId,
      amountCents: transactions.amountCents,
      postedOn: transactions.postedOn,
    })
    .from(transactions)
    .where(
      and(inArray(transactions.merchant, names), isNotNull(transactions.splitGroupId)),
    )
    .orderBy(desc(transactions.postedOn));

  // The newest group per merchant, then that group's parts.
  const newestGroup = new Map<string, string>();
  const byGroup = new Map<string, PriorPart[]>();
  for (const row of split) {
    if (!row.merchant || !row.groupId) continue;
    if (!newestGroup.has(row.merchant)) newestGroup.set(row.merchant, row.groupId);
    if (row.categoryId) {
      const list = byGroup.get(row.groupId) ?? [];
      list.push({ categoryId: row.categoryId, amountCents: row.amountCents });
      byGroup.set(row.groupId, list);
    }
  }

  for (const [merchant, groupId] of newestGroup) {
    const prior = byGroup.get(groupId);
    if (prior && prior.length >= 2) byMerchant.set(merchant, prior);
  }
  return byMerchant;
}

/** The suggestion for one row, or null if this merchant has never been split. */
export function suggestionFor(
  prior: Map<string, PriorPart[]>,
  merchant: string | null,
  amountCents: number,
) {
  if (!merchant) return null;
  const parts = prior.get(merchant);
  return parts ? suggestSplit(Math.abs(amountCents), parts) : null;
}
