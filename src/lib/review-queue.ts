import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, transactions } from "@/db/schema";
import { REVIEW_THRESHOLD } from "./classify/constants";
import { ledgerMode } from "./mode";
import type { MerchantUse, PopularUse } from "./review-suggest";

/**
 * The transactions that are waiting on an answer from the user.
 *
 * Two kinds end up here, and they arrive for opposite reasons:
 *
 *   - **Queued.** A rule matched, filed the money somewhere real, and asked
 *     anyway, because the description structurally cannot say what it was for.
 *     `Zelle payment to JORDAN 10000000006` is a name and a reference number.
 *   - **Low confidence.** The model was asked and was not sure.
 *
 * Both are already counted in the month's totals — answering changes what the
 * money is attributed to, never whether it exists. That is worth knowing while
 * working through the list: skipping one costs a category, not a total.
 */

export type QueueItem = {
  id: string;
  postedOn: string;
  amountCents: number;
  merchant: string | null;
  rawDescription: string;
  categoryId: string | null;
  categoryName: string | null;
  reason: string | null;
  confidence: number | null;
  /** Queued by a rule, rather than guessed at by the model. */
  queued: boolean;
};

export type CategoryOption = {
  id: string;
  name: string;
  slug: string;
  kind: string;
};

/**
 * Ordered by amount, largest first.
 *
 * The same reasoning as `quality.ts`: fifty uncertain coffees matter less than
 * one uncertain $4,500 payment, and someone who works through five entries and
 * stops should have spent them on the five that move the totals most.
 */
export async function reviewQueue(limit = 200): Promise<QueueItem[]> {
  const rows = await db
    .select({
      id: transactions.id,
      postedOn: transactions.postedOn,
      amountCents: transactions.amountCents,
      merchant: transactions.merchant,
      rawDescription: transactions.rawDescription,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      reason: transactions.classificationReason,
      confidence: transactions.classificationConfidence,
      source: transactions.classificationSource,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        // The user's answer outranks everything; never re-ask an answered row.
        ne(transactions.classificationSource, "manual"),
        or(
          eq(transactions.classificationSource, "unclassified"),
          sql`${transactions.classificationConfidence} < ${REVIEW_THRESHOLD}`,
        ),
      ),
    )
    .orderBy(desc(sql`ABS(${transactions.amountCents})`))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    postedOn: r.postedOn,
    amountCents: Number(r.amountCents),
    merchant: r.merchant,
    rawDescription: r.rawDescription,
    categoryId: r.categoryId,
    categoryName: r.categoryName,
    reason: r.reason,
    confidence: r.confidence === null ? null : Number(r.confidence),
    queued: r.source === "unclassified",
  }));
}

/**
 * Categories that can be assigned, for the active chart of accounts only.
 *
 * Filtered by mode because both charts live in the same table: offering a
 * household the business chart's `biz-software` is offering them a category
 * that no report in their deployment reads.
 *
 * Parents are groupings and are not assignable — filing into one would make a
 * subtotal that includes itself.
 */
export async function assignableCategories(): Promise<CategoryOption[]> {
  const mode = await ledgerMode();

  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
      kind: categories.kind,
      parentId: categories.parentId,
    })
    .from(categories)
    .where(eq(categories.mode, mode))
    .orderBy(categories.sortOrder);

  const parentIds = new Set(
    rows.map((r) => r.parentId).filter((v): v is string => Boolean(v)),
  );

  return rows
    .filter((r) => !parentIds.has(r.id))
    .map(({ id, name, slug, kind }) => ({ id, name, slug, kind }));
}

export async function reviewQueueCount(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(transactions)
    .where(
      and(
        ne(transactions.classificationSource, "manual"),
        or(
          eq(transactions.classificationSource, "unclassified"),
          sql`${transactions.classificationConfidence} < ${REVIEW_THRESHOLD}`,
        ),
      ),
    );
  return row?.count ?? 0;
}

/**
 * How each merchant in the queue has been categorized before.
 *
 * Only rows that are themselves settled — a queue entry agreeing with another
 * queue entry is two guesses, not evidence. Manual answers count double,
 * because a person said so.
 */
export async function merchantHistory(
  merchants: string[],
): Promise<Map<string, MerchantUse[]>> {
  if (merchants.length === 0) return new Map();

  const rows = await db
    .select({
      merchant: transactions.merchant,
      categoryId: categories.id,
      name: categories.name,
      count: sql<number>`SUM(CASE WHEN ${transactions.classificationSource} = 'manual' THEN 2 ELSE 1 END)::int`,
    })
    .from(transactions)
    .innerJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        inArray(transactions.merchant, merchants),
        ne(transactions.classificationSource, "unclassified"),
        sql`${transactions.classificationConfidence} >= ${REVIEW_THRESHOLD}`,
      ),
    )
    .groupBy(transactions.merchant, categories.id, categories.name);

  const byMerchant = new Map<string, MerchantUse[]>();
  for (const r of rows) {
    if (!r.merchant) continue;
    const list = byMerchant.get(r.merchant) ?? [];
    list.push({ categoryId: r.categoryId, name: r.name, count: Number(r.count) });
    byMerchant.set(r.merchant, list);
  }
  return byMerchant;
}

/**
 * The categories this ledger actually uses, for the fallback offers.
 *
 * Filtering these by `budgetable` looked right and was wrong: income
 * categories are all `budgetable = false`, because income is not something you
 * budget. That quietly removed the entire income half of the chart, so every
 * deposit offered nothing but its own current guess and had to be answered
 * through the search box. Parents are excluded instead — the same rule as
 * `assignableCategories`, for the same reason.
 */
export async function popularCategories(): Promise<PopularUse[]> {
  const mode = await ledgerMode();

  const rows = await db
    .select({
      categoryId: categories.id,
      name: categories.name,
      kind: categories.kind,
      slug: categories.slug,
      parentId: categories.parentId,
      count: sql<number>`count(${transactions.id})::int`,
    })
    .from(categories)
    .leftJoin(transactions, eq(transactions.categoryId, categories.id))
    .where(eq(categories.mode, mode))
    .groupBy(
      categories.id,
      categories.name,
      categories.kind,
      categories.slug,
      categories.parentId,
    );

  const parentIds = new Set(
    rows.map((r) => r.parentId).filter((v): v is string => Boolean(v)),
  );

  return rows
    .filter((r) => !parentIds.has(r.categoryId))
    // Never suggest the bucket that means "we could not tell" — that is the
    // state being escaped, not an answer to it.
    .filter((r) => !r.slug.endsWith("uncategorized"))
    .map((r) => ({
      categoryId: r.categoryId,
      name: r.name,
      kind: String(r.kind),
      count: Number(r.count),
    }));
}
