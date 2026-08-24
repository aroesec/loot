import { and, eq, isNotNull, sql, inArray } from "drizzle-orm";
import { db } from "@/db";
import { transactions, recurringSeries } from "@/db/schema";
import { detectSeries } from "./detect";

// The detection logic itself is pure and lives in ./detect so it can be
// exercised without a database.
export * from "./detect";

/**
 * Recompute every series from the ledger and persist. Cheap enough to run
 * after each import; detection is over merchant groups, not full history scans
 * per row.
 */
export async function refreshRecurringSeries(): Promise<{
  detected: number;
  active: number;
}> {
  const rows = await db
    .select({
      id: transactions.id,
      merchant: transactions.merchant,
      categoryId: transactions.categoryId,
      postedOn: transactions.postedOn,
      amountCents: transactions.amountCents,
    })
    .from(transactions)
    .where(
      and(
        isNotNull(transactions.merchant),
        eq(transactions.isTransfer, false),
        // Outflows only — income is handled as its own concept.
        sql`${transactions.amountCents} < 0`,
      ),
    );

  const candidates = detectSeries(
    rows
      .filter((r): r is typeof r & { merchant: string } => Boolean(r.merchant))
      .map((r) => ({
        id: r.id,
        merchant: r.merchant,
        categoryId: r.categoryId,
        postedOn: r.postedOn,
        amountCents: r.amountCents,
      })),
  );

  // Clear stale links so a merchant that stopped being regular is released.
  await db
    .update(transactions)
    .set({ recurringSeriesId: null })
    .where(isNotNull(transactions.recurringSeriesId));

  let active = 0;

  for (const c of candidates) {
    const [row] = await db
      .insert(recurringSeries)
      .values({
        merchant: c.merchant,
        categoryId: c.categoryId,
        cadence: c.cadence,
        typicalAmountCents: c.typicalAmountCents,
        lastAmountCents: c.lastAmountCents,
        firstSeenOn: c.firstSeenOn,
        lastSeenOn: c.lastSeenOn,
        nextExpectedOn: c.nextExpectedOn,
        occurrences: c.occurrences,
        status: c.status,
        priceChangePct: c.priceChangePct,
        annualizedCents: c.annualizedCents,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: recurringSeries.merchant,
        set: {
          categoryId: c.categoryId,
          cadence: c.cadence,
          typicalAmountCents: c.typicalAmountCents,
          lastAmountCents: c.lastAmountCents,
          firstSeenOn: c.firstSeenOn,
          lastSeenOn: c.lastSeenOn,
          nextExpectedOn: c.nextExpectedOn,
          occurrences: c.occurrences,
          // A user-paused series stays paused across refreshes. Both branches
          // need an explicit cast — Postgres cannot infer the enum type for a
          // bound parameter inside a CASE.
          status: sql`CASE WHEN ${recurringSeries.status} = 'paused' THEN 'paused'::series_status ELSE ${c.status}::series_status END`,
          priceChangePct: c.priceChangePct,
          annualizedCents: c.annualizedCents,
          updatedAt: new Date(),
        },
      })
      .returning({ id: recurringSeries.id });

    if (row && c.transactionIds.length > 0) {
      for (let i = 0; i < c.transactionIds.length; i += 500) {
        await db
          .update(transactions)
          .set({ recurringSeriesId: row.id })
          .where(inArray(transactions.id, c.transactionIds.slice(i, i + 500)));
      }
    }
    if (c.status === "active") active++;
  }

  return { detected: candidates.length, active };
}
