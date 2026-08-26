import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, transactions } from "@/db/schema";
import { lineOrder, type ScheduleCLine, type ScheduleCSummary } from "./tax-lines";

export * from "./tax-lines";

/**
 * The year, arranged the way Schedule C asks for it.
 *
 * Every business category already carries the line it belongs to; nothing was
 * surfacing it. This groups a year by that line so the figures can be read off
 * in the order the form wants them, rather than reconstructed from a P&L that
 * is organised for running the business instead of filing.
 *
 * Two things it does not do, on purpose:
 *
 *   - it does not decide what is deductible. `deductible_pct` is a default for
 *     organising records, and the interesting cases (meals, home office,
 *     vehicle) depend on facts the ledger does not hold.
 *   - it does not fill in a form. It reports what the ledger contains, which is
 *     a starting point for a return rather than a substitute for one.
 */

export async function scheduleC(year: number): Promise<ScheduleCSummary> {
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;

  const rows = await db
    .select({
      slug: categories.slug,
      name: categories.name,
      section: categories.plSection,
      line: categories.scheduleCLine,
      deductiblePct: categories.deductiblePct,
      total: sql<string>`COALESCE(SUM(${transactions.amountCents}), 0)`,
      count: sql<string>`COUNT(*)`,
    })
    .from(transactions)
    .innerJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        gte(transactions.postedOn, start),
        lte(transactions.postedOn, end),
        eq(categories.mode, "business"),
        // Same exclusion every other total makes: a transfer is the same dollar
        // already counted on its other side.
        eq(transactions.isTransfer, false),
      ),
    )
    .groupBy(
      categories.slug,
      categories.name,
      categories.plSection,
      categories.scheduleCLine,
      categories.deductiblePct,
    );

  const revenue = new Map<string, ScheduleCLine>();
  const expense = new Map<string, ScheduleCLine>();
  let unmapped: ScheduleCLine | null = null;
  let ownerEquity = 0;
  let gross = 0;
  let expenses = 0;
  let deductible = 0;

  for (const r of rows) {
    const signed = Number(r.total);
    const count = Number(r.count);

    /*
     * Owner equity never reaches the form. A draw is profit being withdrawn,
     * not a cost of earning it, and deducting it would understate the tax owed
     * on a return rather than merely mislabelling a report.
     */
    if (r.section === "owner_equity") {
      ownerEquity += Math.abs(signed);
      continue;
    }

    const isRevenue = r.section === "revenue";
    // Costs are stored negative; the form wants positive magnitudes.
    const amount = isRevenue ? signed : -signed;
    if (amount === 0 && count === 0) continue;

    const pct = r.deductiblePct === null ? null : Number(r.deductiblePct);
    const deductibleHere = isRevenue
      ? 0
      : Math.round(amount * ((pct ?? 100) / 100));

    const target = isRevenue ? revenue : expense;
    const key = r.line ?? "__unmapped__";
    const bucket =
      key === "__unmapped__" && !isRevenue
        ? (unmapped ??= {
            line: null,
            lineNumber: 9999,
            categories: [],
            amountCents: 0,
            deductibleCents: 0,
            deductiblePct: null,
            transactionCount: 0,
          })
        : (target.get(key) ??
          (target
            .set(key, {
              line: r.line,
              lineNumber: lineOrder(r.line),
              categories: [],
              amountCents: 0,
              deductibleCents: 0,
              deductiblePct: pct,
              transactionCount: 0,
            })
            .get(key) as ScheduleCLine));

    bucket.categories.push({ slug: r.slug, name: r.name, amountCents: amount });
    bucket.amountCents += amount;
    bucket.deductibleCents += deductibleHere;
    bucket.transactionCount += count;
    // Two categories on one line with different percentages cannot be shown as
    // a single percentage without lying about one of them.
    if (bucket.deductiblePct !== pct) bucket.deductiblePct = null;

    if (isRevenue) gross += amount;
    else {
      expenses += amount;
      deductible += deductibleHere;
    }
  }

  const bySortKey = (a: ScheduleCLine, b: ScheduleCLine) =>
    a.lineNumber - b.lineNumber;

  return {
    year,
    grossReceiptsCents: gross,
    expensesCents: expenses,
    deductibleCents: deductible,
    // Profit for tax purposes uses the deductible share, not face value.
    netProfitCents: gross - deductible,
    revenueLines: [...revenue.values()].sort(bySortKey),
    expenseLines: [...expense.values()].sort(bySortKey),
    unmapped,
    ownerEquityCents: ownerEquity,
  };
}

/** Years the ledger actually has business activity in. */
export async function businessYears(): Promise<number[]> {
  const rows = await db
    .select({ year: sql<string>`DISTINCT EXTRACT(YEAR FROM ${transactions.postedOn})` })
    .from(transactions)
    .innerJoin(categories, eq(transactions.categoryId, categories.id))
    .where(eq(categories.mode, "business"));

  return rows.map((r) => Number(r.year)).sort((a, b) => b - a);
}
