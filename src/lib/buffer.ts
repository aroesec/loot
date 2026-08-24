import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, categories, transactions } from "@/db/schema";
import { monthBounds, shiftMonth, type MonthKey } from "./dates";

/**
 * Whether there is a cushion, and what it would take to build one.
 *
 * The ledger is built entirely from flows, which let it say "you spent more
 * than you earned" without being able to say whether that mattered. A buffer
 * is a stock. This is the part that answers "what happens when something
 * unexpected arrives" — which, on the evidence, is the question that actually
 * bites.
 *
 * Every number here is derived from the person's own history. A generic "save
 * three months of expenses" is advice; "your irregular spending averaged $X a
 * month over the last N months, and you had $Y set aside" is arithmetic. Only
 * the second is worth putting in front of someone, and only the second is
 * defensible without being a financial adviser.
 */

/**
 * Categories that are not ordinary consumption.
 *
 * Excluded from the baseline because a buffer sized to include mortgage,
 * savings contributions and debt payments overstates what a lean month costs —
 * and because contributions are the first thing you would pause, not the last.
 */
const NOT_CONSUMPTION = [
  "investments",
  "investment-withdrawal",
  "card-payment",
  "transfer",
  "debt-payment",
];

export type MonthFlow = {
  month: MonthKey;
  earnedCents: number;
  consumptionCents: number;
  savedCents: number;
  withdrawnCents: number;
  /** Consumption minus earnings. Negative means a shortfall. */
  netCents: number;
};

/**
 * The last `count` complete months, oldest first.
 *
 * A month counts only when the ledger covers **both** its edges. Checking one
 * edge is not enough and produced two wrong answers at once: the first month
 * of history began mid-month, so it showed a fortnight of spending against a
 * full paycheck and looked like a huge surplus — and because most bills had
 * not yet been paid in that stub, every ordinary monthly expense looked
 * intermittent and got recommended as a sinking fund.
 */
export async function recentFlows(
  through: MonthKey,
  count = 6,
): Promise<MonthFlow[]> {
  const [span] = await db
    .select({
      earliest: sql<string | null>`MIN(${transactions.postedOn})`,
      latest: sql<string | null>`MAX(${transactions.postedOn})`,
    })
    .from(transactions);

  const out: MonthFlow[] = [];

  for (let i = count; i >= 1; i--) {
    const month = shiftMonth(through, -i + 1);
    const { start, end } = monthBounds(month);

    // Both edges, or the month is a stub pretending to be a month.
    if (!span?.earliest || !span.latest) continue;
    if (start < span.earliest || end > span.latest) continue;

    const [row] = await db
      .select({
        earned: sql<string>`COALESCE(SUM(CASE WHEN ${categories.slug} IN ('salary','freelance-income','other-income') THEN ${transactions.amountCents} ELSE 0 END), 0)`,
        consumption: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.amountCents} < 0 AND NOT ${transactions.isTransfer} AND ${categories.slug} NOT IN ${NOT_CONSUMPTION} THEN -${transactions.amountCents} ELSE 0 END), 0)`,
        saved: sql<string>`COALESCE(SUM(CASE WHEN ${categories.slug} = 'investments' THEN -${transactions.amountCents} ELSE 0 END), 0)`,
        withdrawn: sql<string>`COALESCE(SUM(CASE WHEN ${categories.slug} = 'investment-withdrawal' THEN ${transactions.amountCents} ELSE 0 END), 0)`,
      })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .where(
        and(gte(transactions.postedOn, start), lte(transactions.postedOn, end)),
      );

    const earnedCents = Number(row?.earned ?? 0);
    const consumptionCents = Number(row?.consumption ?? 0);
    if (earnedCents === 0 && consumptionCents === 0) continue;

    out.push({
      month,
      earnedCents,
      consumptionCents,
      savedCents: Number(row?.saved ?? 0),
      withdrawnCents: Number(row?.withdrawn ?? 0),
      netCents: earnedCents - consumptionCents,
    });
  }

  return out;
}

export type BufferStatus = {
  /** Cash across deposit accounts, minus what is owed on cards. */
  liquidCents: number | null;
  /** True when no linked account has reported a balance. */
  balancesUnknown: boolean;
  /** Median monthly consumption, which is what a buffer is measured in. */
  baselineMonthlyCents: number;
  /** How many months the current cushion would cover. */
  monthsCovered: number | null;
  /** Months of consumption to aim for. */
  targetMonths: number;
  targetCents: number;
  shortfallCents: number | null;
  monthsOfData: number;
};

/**
 * Median rather than mean, deliberately.
 *
 * One $6,000 project pulls a three-month mean up by $2,000 and makes the
 * buffer target look enormous. The median answers "what does a normal month
 * cost", which is what a cushion has to cover; the lumpy expenses are the
 * sinking funds' job, below.
 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
    : sorted[mid]!;
}

export async function bufferStatus(
  through: MonthKey,
  targetMonths = 3,
): Promise<BufferStatus> {
  const flows = await recentFlows(through, 6);
  const baseline = median(flows.map((f) => f.consumptionCents));

  /*
   * Liquid means reachable today. Deposit accounts count; a card's balance is
   * what is owed and counts against. Investments are excluded on purpose —
   * treating them as the buffer is exactly the habit that produced a forced
   * liquidation.
   */
  const balances = await db
    .select({
      kind: accounts.kind,
      balanceCents: accounts.balanceCents,
      availableCents: accounts.availableCents,
    })
    .from(accounts)
    .where(isNull(accounts.archivedAt));

  const known = balances.filter((b) => b.balanceCents !== null);
  const liquidCents =
    known.length === 0
      ? null
      : known.reduce((total, b) => {
          /*
           * `current`, never `available`.
           *
           * On a credit card Plaid reports `available` as the remaining credit
           * *line*, not a balance. Treating it as one subtracted several
           * thousand dollars of unused borrowing capacity as though it were
           * debt, and turned a positive cushion into a large negative.
           *
           * On a deposit account `available` excludes holds, which is closer
           * to what can be spent today — but pending transactions are already
           * in the ledger as rows, so using it here would count them twice.
           */
          const amount = b.balanceCents ?? 0;
          if (b.kind === "checking" || b.kind === "savings" || b.kind === "cash") {
            return total + amount;
          }
          // A card's balance is what is owed, so it reduces the cushion.
          if (b.kind === "credit_card") return total - Math.abs(amount);
          return total;
        }, 0);

  const targetCents = baseline * targetMonths;

  return {
    liquidCents,
    balancesUnknown: known.length === 0,
    baselineMonthlyCents: baseline,
    monthsCovered:
      liquidCents === null || baseline === 0 ? null : liquidCents / baseline,
    targetMonths,
    targetCents,
    shortfallCents:
      liquidCents === null ? null : Math.max(0, targetCents - liquidCents),
    monthsOfData: flows.length,
  };
}

export type IrregularCategory = {
  slug: string;
  name: string;
  /** Months in the window that had any spending here. */
  monthsActive: number;
  monthsObserved: number;
  totalCents: number;
  largestMonthCents: number;
  /** Total spread evenly across the window — what to set aside monthly. */
  suggestedMonthlyCents: number;
};

/**
 * Categories that arrive in lumps rather than evenly.
 *
 * These are what a sinking fund is for, and identifying them is the difference
 * between a useful suggestion and a platitude. A category that costs the same
 * every month is a budget line; one that is silent for two months and then
 * costs $7,000 is the thing that empties an account.
 *
 * The test is concentration: most of the spend landing in few months. Steady
 * categories fail it no matter how large they are.
 */
export async function irregularCategories(
  through: MonthKey,
  monthsBack = 6,
): Promise<IrregularCategory[]> {
  const flows = await recentFlows(through, monthsBack);

  /*
   * Three complete months is the floor for calling anything irregular. With
   * two, a bill paid in one of them and not the other is indistinguishable
   * from a genuine lump, and the suggestion list fills with rent, insurance
   * and the phone bill — which is worse than saying nothing.
   */
  if (flows.length < 3) return [];

  const first = monthBounds(flows[0]!.month).start;
  const last = monthBounds(flows[flows.length - 1]!.month).end;

  const rows = await db
    .select({
      slug: categories.slug,
      name: categories.name,
      month: sql<string>`to_char(${transactions.postedOn}, 'YYYY-MM')`,
      total: sql<string>`COALESCE(SUM(-${transactions.amountCents}), 0)`,
    })
    .from(transactions)
    .innerJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        gte(transactions.postedOn, first),
        lte(transactions.postedOn, last),
        sql`${transactions.amountCents} < 0`,
        eq(transactions.isTransfer, false),
        sql`${categories.slug} NOT IN ${NOT_CONSUMPTION}`,
      ),
    )
    .groupBy(categories.slug, categories.name, sql`3`);

  const byCategory = new Map<
    string,
    { name: string; months: Map<string, number> }
  >();

  for (const r of rows) {
    const entry = byCategory.get(r.slug) ?? { name: r.name, months: new Map() };
    entry.months.set(r.month, Number(r.total));
    byCategory.set(r.slug, entry);
  }

  const observed = flows.length;
  const out: IrregularCategory[] = [];

  for (const [slug, entry] of byCategory) {
    const amounts = [...entry.months.values()];
    const total = amounts.reduce((a, b) => a + b, 0);
    const largest = Math.max(...amounts);
    const active = amounts.length;

    /*
     * Lumpy enough to be worth saving for: it does not appear every month, or
     * one month carries most of the cost. Small totals are filtered out
     * because a $40 annual fee does not need a fund.
     */
    const concentrated = largest / total > 0.6;
    const intermittent = active < observed;
    if (total < 20_000) continue;
    if (!concentrated && !intermittent) continue;

    out.push({
      slug,
      name: entry.name,
      monthsActive: active,
      monthsObserved: observed,
      totalCents: total,
      largestMonthCents: largest,
      suggestedMonthlyCents: Math.round(total / observed),
    });
  }

  return out.sort((a, b) => b.totalCents - a.totalCents);
}

export type ChurnFinding = {
  savedCents: number;
  withdrawnCents: number;
  netCents: number;
  months: number;
};

/**
 * Saving on a schedule while liquidating to cover shortfalls.
 *
 * Worth naming on its own because it disguises itself: regular contributions
 * look like discipline in every monthly view, and only the net across several
 * months shows that more came back out than went in.
 */
export async function savingsChurn(
  through: MonthKey,
  monthsBack = 6,
): Promise<ChurnFinding | null> {
  /*
   * Scanned over a date range rather than over complete months.
   *
   * A liquidation is an event, not a rate. Restricting this to whole months
   * hid the single most important thing in the data — a $10,000 withdrawal —
   * because it happened in the month that had not finished yet, which is
   * exactly when someone would want to be told.
   */
  const { start } = monthBounds(shiftMonth(through, -(monthsBack - 1)));
  const { end } = monthBounds(through);

  const [row] = await db
    .select({
      saved: sql<string>`COALESCE(SUM(CASE WHEN ${categories.slug} = 'investments' THEN -${transactions.amountCents} ELSE 0 END), 0)`,
      withdrawn: sql<string>`COALESCE(SUM(CASE WHEN ${categories.slug} = 'investment-withdrawal' THEN ${transactions.amountCents} ELSE 0 END), 0)`,
      months: sql<string>`COUNT(DISTINCT to_char(${transactions.postedOn}, 'YYYY-MM'))`,
    })
    .from(transactions)
    .innerJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(gte(transactions.postedOn, start), lte(transactions.postedOn, end)),
    );

  const savedCents = Number(row?.saved ?? 0);
  const withdrawnCents = Number(row?.withdrawn ?? 0);
  if (withdrawnCents === 0) return null;

  return {
    savedCents,
    withdrawnCents,
    netCents: savedCents - withdrawnCents,
    months: Number(row?.months ?? 0),
  };
}


export type CategoryMedian = {
  slug: string;
  name: string;
  monthlyCents: number;
};

/**
 * Median monthly spend per category across the complete months.
 *
 * Median rather than mean for the same reason the baseline uses one: a single
 * project month should not define what a category normally costs. This is what
 * gets compared against a benchmark, so getting it wrong would misreport the
 * comparison in whichever direction the outlier fell.
 */
export async function categoryMedians(
  through: MonthKey,
  monthsBack = 6,
): Promise<CategoryMedian[]> {
  const flows = await recentFlows(through, monthsBack);
  if (flows.length === 0) return [];

  const first = monthBounds(flows[0]!.month).start;
  const last = monthBounds(flows[flows.length - 1]!.month).end;

  const rows = await db
    .select({
      slug: categories.slug,
      name: categories.name,
      month: sql<string>`to_char(${transactions.postedOn}, 'YYYY-MM')`,
      total: sql<string>`COALESCE(SUM(-${transactions.amountCents}), 0)`,
    })
    .from(transactions)
    .innerJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        gte(transactions.postedOn, first),
        lte(transactions.postedOn, last),
        sql`${transactions.amountCents} < 0`,
        eq(transactions.isTransfer, false),
      ),
    )
    .groupBy(categories.slug, categories.name, sql`3`);

  const byCategory = new Map<string, { name: string; amounts: number[] }>();
  for (const r of rows) {
    const entry = byCategory.get(r.slug) ?? { name: r.name, amounts: [] };
    entry.amounts.push(Number(r.total));
    byCategory.set(r.slug, entry);
  }

  const out: CategoryMedian[] = [];
  for (const [slug, entry] of byCategory) {
    /*
     * Months with no spending count as zero. Without them a category bought
     * once in six months reports its median as that single purchase, which
     * would compare a one-off against a monthly benchmark.
     */
    const padded = [
      ...entry.amounts,
      ...Array(Math.max(0, flows.length - entry.amounts.length)).fill(0),
    ];
    out.push({ slug, name: entry.name, monthlyCents: median(padded) });
  }

  return out.filter((c) => c.monthlyCents > 0);
}
