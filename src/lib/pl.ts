import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, transactions } from "@/db/schema";
import { monthBounds, yearBounds, type MonthKey } from "./ledger";

/**
 * Profit and loss, for the business chart of accounts.
 *
 * Separate from `ledger.ts` rather than bolted onto it, because it answers a
 * different question. The personal ledger asks "where did the money go"; this
 * asks "what did the business earn, and what did it cost to earn it". The
 * structure is the accounting one:
 *
 *   revenue − cogs         = gross profit
 *   gross profit − opex    = net profit
 *
 * Two things it deliberately does NOT count as costs:
 *
 *   **Owner's draw.** Paying yourself is equity leaving, not an expense.
 *   Counting it understates profit and overstates deductions — and unlike most
 *   errors here, that one ends up on a tax return.
 *
 *   **Internal transfers and card payments.** Same rule as the personal
 *   ledger: the same dollar is already counted elsewhere.
 *
 * Both are excluded by `is_transfer`, which is why the owner-equity categories
 * are seeded with `kind: "transfer"`. They still appear in `ownerEquity` below,
 * because "where did the profit go" is a question worth answering separately
 * from "what did it cost to make".
 */

export type PlLine = {
  slug: string;
  name: string;
  section: string;
  amountCents: number;
  deductiblePct: number | null;
  /** `amountCents` scaled by the deductible share. */
  deductibleCents: number;
  scheduleCLine: string | null;
  transactionCount: number;
};

export type ProfitAndLoss = {
  periodStart: string;
  periodEnd: string;
  label: string;

  revenueCents: number;
  cogsCents: number;
  grossProfitCents: number;
  opexCents: number;
  netProfitCents: number;

  /** Net profit as a share of revenue. Null when there was no revenue. */
  netMargin: number | null;
  grossMargin: number | null;

  /** Deductible portion of all expenses, for estimating taxable profit. */
  deductibleCents: number;

  /** Draws, contributions and estimated tax. Outside the P&L by definition. */
  ownerEquityCents: number;

  lines: PlLine[];
};

async function plForRange(
  start: string,
  end: string,
  label: string,
): Promise<ProfitAndLoss> {
  const rows = await db
    .select({
      slug: categories.slug,
      name: categories.name,
      section: categories.plSection,
      deductiblePct: categories.deductiblePct,
      scheduleCLine: categories.scheduleCLine,
      isTransfer: transactions.isTransfer,
      /*
       * Reported as positive magnitudes per section rather than raw signed
       * sums. Revenue is stored positive and costs negative, so flipping the
       * cost sections here keeps the arithmetic below readable — and keeps a
       * refund issued to a customer reducing revenue rather than appearing as
       * negative spending.
       */
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
      ),
    )
    .groupBy(
      categories.slug,
      categories.name,
      categories.plSection,
      categories.deductiblePct,
      categories.scheduleCLine,
      transactions.isTransfer,
    );

  const lines: PlLine[] = [];
  let revenue = 0;
  let cogs = 0;
  let opex = 0;
  let ownerEquity = 0;
  let deductible = 0;

  for (const r of rows) {
    const signed = Number(r.total);
    const section = r.section ?? "other";

    // Equity movement is not a cost of doing business. Tracked, not subtracted.
    if (section === "owner_equity") {
      ownerEquity += Math.abs(signed);
      lines.push({
        slug: r.slug,
        name: r.name,
        section,
        amountCents: Math.abs(signed),
        deductiblePct: null,
        deductibleCents: 0,
        scheduleCLine: r.scheduleCLine,
        transactionCount: Number(r.count),
      });
      continue;
    }

    // Everything else excluded by the transfer flag is already counted
    // elsewhere in the ledger and must not appear twice.
    if (r.isTransfer) continue;

    const magnitude = Math.abs(signed);
    const pct = r.deductiblePct;
    const deductibleCents =
      pct === null || section === "revenue"
        ? 0
        : Math.round((magnitude * pct) / 100);

    if (section === "revenue") {
      // A refund issued to a customer is stored negative and correctly
      // reduces revenue rather than adding to it.
      revenue += signed;
    } else if (section === "cogs") {
      cogs += magnitude;
      deductible += deductibleCents;
    } else {
      opex += magnitude;
      deductible += deductibleCents;
    }

    lines.push({
      slug: r.slug,
      name: r.name,
      section,
      amountCents: section === "revenue" ? signed : magnitude,
      deductiblePct: pct,
      deductibleCents,
      scheduleCLine: r.scheduleCLine,
      transactionCount: Number(r.count),
    });
  }

  const grossProfit = revenue - cogs;
  const netProfit = grossProfit - opex;

  return {
    periodStart: start,
    periodEnd: end,
    label,
    revenueCents: revenue,
    cogsCents: cogs,
    grossProfitCents: grossProfit,
    opexCents: opex,
    netProfitCents: netProfit,
    // Guarded: a period with no revenue has no margin, and dividing would
    // produce an Infinity that renders as a confident nonsense percentage.
    grossMargin: revenue > 0 ? grossProfit / revenue : null,
    netMargin: revenue > 0 ? netProfit / revenue : null,
    deductibleCents: deductible,
    ownerEquityCents: ownerEquity,
    lines: lines.sort((a, b) => b.amountCents - a.amountCents),
  };
}

export async function monthlyPl(month: MonthKey): Promise<ProfitAndLoss> {
  const { start, end } = monthBounds(month);
  return plForRange(start, end, month);
}

export async function yearlyPl(year: number): Promise<ProfitAndLoss> {
  const { start, end } = yearBounds(year);
  return plForRange(start, end, String(year));
}

/**
 * The four quarters of a year.
 *
 * Quarterly matters for a business in a way it does not for a person: US
 * estimated tax is paid on this cadence, and the number owed comes from the
 * period's profit rather than its cashflow.
 */
export async function quarterlyPl(year: number): Promise<ProfitAndLoss[]> {
  const quarters: Array<[string, string, string]> = [
    [`${year}-01-01`, `${year}-03-31`, `Q1 ${year}`],
    [`${year}-04-01`, `${year}-06-30`, `Q2 ${year}`],
    [`${year}-07-01`, `${year}-09-30`, `Q3 ${year}`],
    [`${year}-10-01`, `${year}-12-31`, `Q4 ${year}`],
  ];
  return Promise.all(quarters.map(([s, e, l]) => plForRange(s, e, l)));
}
