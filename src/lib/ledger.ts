import { sql, and, eq, gte, lte, desc } from "drizzle-orm";
import { db } from "@/db";
import { transactions, categories, budgets } from "@/db/schema";

/**
 * All ledger math lives here so the dashboard, the year view and the insight
 * generator can never disagree about what a month's spending was.
 *
 * Two rules hold everywhere:
 *   - transfers are excluded (moving your own money is not income or spend)
 *   - spend is reported positive, even though it's stored negative
 */

export * from "./dates";
import { monthBounds, yearBounds, shiftMonth, type MonthKey } from "./dates";

export type CategoryTotal = {
  categoryId: string | null;
  slug: string;
  name: string;
  color: string | null;
  parentName: string | null;
  spendCents: number;
  incomeCents: number;
  transactionCount: number;
};

export type MonthSummary = {
  month: MonthKey;
  incomeCents: number;
  spendCents: number;
  netCents: number;
  savingsRate: number | null;
  transactionCount: number;
  byCategory: CategoryTotal[];
  topMerchants: Array<{ merchant: string; spendCents: number; count: number }>;
};

export async function monthSummary(month: MonthKey): Promise<MonthSummary> {
  const { start, end } = monthBounds(month);

  const rows = await db
    .select({
      categoryId: transactions.categoryId,
      slug: categories.slug,
      name: categories.name,
      color: categories.color,
      parentId: categories.parentId,
      spend: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.amountCents} < 0 THEN -${transactions.amountCents} ELSE 0 END), 0)`,
      income: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.amountCents} > 0 THEN ${transactions.amountCents} ELSE 0 END), 0)`,
      count: sql<string>`COUNT(*)`,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        gte(transactions.postedOn, start),
        lte(transactions.postedOn, end),
        eq(transactions.isTransfer, false),
      ),
    )
    .groupBy(
      transactions.categoryId,
      categories.slug,
      categories.name,
      categories.color,
      categories.parentId,
    );

  const parentNames = await parentNameMap();

  const byCategory: CategoryTotal[] = rows.map((r) => ({
    categoryId: r.categoryId,
    slug: r.slug ?? "uncategorized",
    name: r.name ?? "Uncategorized",
    color: r.color,
    parentName: r.parentId ? (parentNames.get(r.parentId) ?? null) : null,
    spendCents: Number(r.spend),
    incomeCents: Number(r.income),
    transactionCount: Number(r.count),
  }));

  const incomeCents = byCategory.reduce((a, c) => a + c.incomeCents, 0);
  const spendCents = byCategory.reduce((a, c) => a + c.spendCents, 0);
  const transactionCount = byCategory.reduce(
    (a, c) => a + c.transactionCount,
    0,
  );

  const merchants = await db
    .select({
      merchant: transactions.merchant,
      spend: sql<string>`COALESCE(SUM(-${transactions.amountCents}), 0)`,
      count: sql<string>`COUNT(*)`,
    })
    .from(transactions)
    .where(
      and(
        gte(transactions.postedOn, start),
        lte(transactions.postedOn, end),
        eq(transactions.isTransfer, false),
        sql`${transactions.amountCents} < 0`,
        sql`${transactions.merchant} IS NOT NULL`,
      ),
    )
    .groupBy(transactions.merchant)
    .orderBy(desc(sql`SUM(-${transactions.amountCents})`))
    .limit(8);

  return {
    month,
    incomeCents,
    spendCents,
    netCents: incomeCents - spendCents,
    savingsRate:
      incomeCents > 0 ? (incomeCents - spendCents) / incomeCents : null,
    transactionCount,
    byCategory: byCategory
      .filter((c) => c.spendCents > 0 || c.incomeCents > 0)
      .sort((a, b) => b.spendCents - a.spendCents),
    topMerchants: merchants.map((m) => ({
      merchant: m.merchant!,
      spendCents: Number(m.spend),
      count: Number(m.count),
    })),
  };
}

async function parentNameMap(): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories);
  return new Map(rows.map((r) => [r.id, r.name]));
}

// ---------------------------------------------------------------------------
// Yearly ledger
// ---------------------------------------------------------------------------

export type YearLedger = {
  year: number;
  months: Array<{
    month: MonthKey;
    incomeCents: number;
    spendCents: number;
    netCents: number;
  }>;
  totals: {
    incomeCents: number;
    spendCents: number;
    netCents: number;
    savingsRate: number | null;
  };
  byCategory: Array<{
    slug: string;
    name: string;
    color: string | null;
    parentName: string | null;
    /** 12 entries, index 0 = January. */
    monthlySpend: number[];
    totalSpendCents: number;
    averageMonthlyCents: number;
  }>;
  /** Same figures for the prior year, for the year-over-year column. */
  priorYear: { incomeCents: number; spendCents: number; netCents: number } | null;
};

export async function yearLedger(year: number): Promise<YearLedger> {
  const { start, end } = yearBounds(year);

  const monthRows = await db
    .select({
      month: sql<string>`to_char(${transactions.postedOn}, 'YYYY-MM')`,
      income: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.amountCents} > 0 THEN ${transactions.amountCents} ELSE 0 END), 0)`,
      spend: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.amountCents} < 0 THEN -${transactions.amountCents} ELSE 0 END), 0)`,
    })
    .from(transactions)
    .where(
      and(
        gte(transactions.postedOn, start),
        lte(transactions.postedOn, end),
        eq(transactions.isTransfer, false),
      ),
    )
    .groupBy(sql`to_char(${transactions.postedOn}, 'YYYY-MM')`);

  const monthMap = new Map(
    monthRows.map((r) => [
      r.month,
      { income: Number(r.income), spend: Number(r.spend) },
    ]),
  );

  const months = Array.from({ length: 12 }, (_, i) => {
    const key = `${year}-${String(i + 1).padStart(2, "0")}`;
    const found = monthMap.get(key) ?? { income: 0, spend: 0 };
    return {
      month: key,
      incomeCents: found.income,
      spendCents: found.spend,
      netCents: found.income - found.spend,
    };
  });

  const catRows = await db
    .select({
      slug: categories.slug,
      name: categories.name,
      color: categories.color,
      parentId: categories.parentId,
      month: sql<string>`to_char(${transactions.postedOn}, 'MM')`,
      spend: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.amountCents} < 0 THEN -${transactions.amountCents} ELSE 0 END), 0)`,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        gte(transactions.postedOn, start),
        lte(transactions.postedOn, end),
        eq(transactions.isTransfer, false),
        sql`${transactions.amountCents} < 0`,
      ),
    )
    .groupBy(
      categories.slug,
      categories.name,
      categories.color,
      categories.parentId,
      sql`to_char(${transactions.postedOn}, 'MM')`,
    );

  const parentNames = await parentNameMap();
  const catMap = new Map<
    string,
    {
      slug: string;
      name: string;
      color: string | null;
      parentName: string | null;
      monthlySpend: number[];
    }
  >();

  for (const r of catRows) {
    const slug = r.slug ?? "uncategorized";
    let entry = catMap.get(slug);
    if (!entry) {
      entry = {
        slug,
        name: r.name ?? "Uncategorized",
        color: r.color,
        parentName: r.parentId ? (parentNames.get(r.parentId) ?? null) : null,
        monthlySpend: Array(12).fill(0),
      };
      catMap.set(slug, entry);
    }
    const idx = Number(r.month) - 1;
    if (idx >= 0 && idx < 12) entry.monthlySpend[idx] = Number(r.spend);
  }

  const byCategory = [...catMap.values()]
    .map((c) => {
      const total = c.monthlySpend.reduce((a, b) => a + b, 0);
      const activeMonths = c.monthlySpend.filter((v) => v > 0).length || 1;
      return {
        ...c,
        totalSpendCents: total,
        averageMonthlyCents: Math.round(total / activeMonths),
      };
    })
    .sort((a, b) => b.totalSpendCents - a.totalSpendCents);

  const totalIncome = months.reduce((a, m) => a + m.incomeCents, 0);
  const totalSpend = months.reduce((a, m) => a + m.spendCents, 0);

  const prior = await db
    .select({
      income: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.amountCents} > 0 THEN ${transactions.amountCents} ELSE 0 END), 0)`,
      spend: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.amountCents} < 0 THEN -${transactions.amountCents} ELSE 0 END), 0)`,
      count: sql<string>`COUNT(*)`,
    })
    .from(transactions)
    .where(
      and(
        gte(transactions.postedOn, `${year - 1}-01-01`),
        lte(transactions.postedOn, `${year - 1}-12-31`),
        eq(transactions.isTransfer, false),
      ),
    );

  const priorRow = prior[0];
  const priorYear =
    priorRow && Number(priorRow.count) > 0
      ? {
          incomeCents: Number(priorRow.income),
          spendCents: Number(priorRow.spend),
          netCents: Number(priorRow.income) - Number(priorRow.spend),
        }
      : null;

  return {
    year,
    months,
    totals: {
      incomeCents: totalIncome,
      spendCents: totalSpend,
      netCents: totalIncome - totalSpend,
      savingsRate:
        totalIncome > 0 ? (totalIncome - totalSpend) / totalIncome : null,
    },
    byCategory,
    priorYear,
  };
}

// ---------------------------------------------------------------------------
// Budgets vs actuals
// ---------------------------------------------------------------------------

export type BudgetLine = {
  categoryId: string;
  slug: string;
  name: string;
  color: string | null;
  budgetCents: number;
  spentCents: number;
  remainingCents: number;
  /** 0-1+, where >1 means over budget. */
  usedFraction: number;
  /** How far through the month we are, 0-1. Only set for the current month. */
  monthProgress: number | null;
  /**
   * Spending pace vs calendar pace. Above 1 means you're burning the budget
   * faster than the month is elapsing.
   */
  paceRatio: number | null;
  status: "under" | "on_track" | "at_risk" | "over";
};

export async function budgetStatus(month: MonthKey): Promise<{
  month: MonthKey;
  lines: BudgetLine[];
  totalBudgetCents: number;
  totalSpentCents: number;
}> {
  const { start, end } = monthBounds(month);

  // The budget in force during this month.
  const budgetRows = await db
    .select({
      categoryId: budgets.categoryId,
      amountCents: budgets.amountCents,
      slug: categories.slug,
      name: categories.name,
      color: categories.color,
      effectiveFrom: budgets.effectiveFrom,
    })
    .from(budgets)
    .innerJoin(categories, eq(budgets.categoryId, categories.id))
    .where(
      and(
        lte(budgets.effectiveFrom, end),
        sql`(${budgets.effectiveTo} IS NULL OR ${budgets.effectiveTo} >= ${start})`,
      ),
    )
    .orderBy(desc(budgets.effectiveFrom));

  // Keep only the most recent version per category.
  const latest = new Map<string, (typeof budgetRows)[number]>();
  for (const row of budgetRows) {
    if (!latest.has(row.categoryId)) latest.set(row.categoryId, row);
  }

  const spendRows = await db
    .select({
      categoryId: transactions.categoryId,
      spend: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.amountCents} < 0 THEN -${transactions.amountCents} ELSE 0 END), 0)`,
    })
    .from(transactions)
    .where(
      and(
        gte(transactions.postedOn, start),
        lte(transactions.postedOn, end),
        eq(transactions.isTransfer, false),
      ),
    )
    .groupBy(transactions.categoryId);

  const spendMap = new Map(
    spendRows.map((r) => [r.categoryId ?? "", Number(r.spend)]),
  );

  // Pace only makes sense for a month in progress.
  const today = new Date().toISOString().slice(0, 10);
  const isCurrent = today >= start && today <= end;
  const monthProgress = isCurrent
    ? (Number(today.slice(8, 10)) / Number(end.slice(8, 10)))
    : null;

  const lines: BudgetLine[] = [...latest.values()].map((b) => {
    const spentCents = spendMap.get(b.categoryId) ?? 0;
    const usedFraction = b.amountCents > 0 ? spentCents / b.amountCents : 0;
    const paceRatio =
      monthProgress && monthProgress > 0 ? usedFraction / monthProgress : null;

    let status: BudgetLine["status"];
    if (usedFraction > 1) status = "over";
    else if (paceRatio !== null && paceRatio > 1.15) status = "at_risk";
    else if (!isCurrent && usedFraction <= 1) status = "under";
    else status = "on_track";

    return {
      categoryId: b.categoryId,
      slug: b.slug,
      name: b.name,
      color: b.color,
      budgetCents: b.amountCents,
      spentCents,
      remainingCents: b.amountCents - spentCents,
      usedFraction,
      monthProgress,
      paceRatio,
      status,
    };
  });

  lines.sort((a, b) => b.usedFraction - a.usedFraction);

  return {
    month,
    lines,
    totalBudgetCents: lines.reduce((a, l) => a + l.budgetCents, 0),
    totalSpentCents: lines.reduce((a, l) => a + l.spentCents, 0),
  };
}

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------

export type CategoryTrend = {
  slug: string;
  name: string;
  currentCents: number;
  averageCents: number;
  deltaCents: number;
  deltaPct: number | null;
};

/**
 * Compares a month against the average of the N months before it. This is what
 * drives "you spent 40% more on restaurants than usual" — a single prior month
 * is too noisy to make that claim from.
 */
export async function categoryTrends(
  month: MonthKey,
  lookback = 3,
): Promise<CategoryTrend[]> {
  const current = await monthSummary(month);

  /*
   * Only compare against months the ledger actually covers.
   *
   * Averaging over a fixed window counts months with no data as months of zero
   * spending. On a ledger that starts in January, comparing March against a
   * three-month window silently includes December and halves every baseline —
   * which produced insights like "internet jumped from a $60.00 baseline" when
   * the real prior months were $90.00 and $90.00.
   */
  const covered = new Set(await availableMonths());
  const priorMonths: MonthKey[] = [];
  for (let i = 1; i <= lookback; i++) {
    const key = shiftMonth(month, -i);
    if (covered.has(key)) priorMonths.push(key);
  }

  // With no prior coverage there is no baseline to speak of, and reporting a
  // change against zero would be an invented finding.
  if (priorMonths.length === 0) return [];

  const priors = await Promise.all(priorMonths.map((m) => monthSummary(m)));

  const priorTotals = new Map<string, number>();
  for (const p of priors) {
    for (const c of p.byCategory) {
      if (c.spendCents <= 0) continue;
      priorTotals.set(c.slug, (priorTotals.get(c.slug) ?? 0) + c.spendCents);
    }
  }

  const trends: CategoryTrend[] = [];
  for (const c of current.byCategory) {
    if (c.spendCents <= 0) continue;
    // Divide by the months actually covered. A category absent in a covered
    // month still counts as a real zero for that month — that part is honest.
    const averageCents = Math.round(
      (priorTotals.get(c.slug) ?? 0) / priorMonths.length,
    );
    const deltaCents = c.spendCents - averageCents;
    trends.push({
      slug: c.slug,
      name: c.name,
      currentCents: c.spendCents,
      averageCents,
      deltaCents,
      deltaPct:
        averageCents > 0 ? (deltaCents / averageCents) * 100 : null,
    });
  }

  return trends.sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents));
}

/** Months that actually contain data, newest first. Drives period pickers. */
export async function availableMonths(): Promise<MonthKey[]> {
  const rows = await db
    .select({
      month: sql<string>`to_char(${transactions.postedOn}, 'YYYY-MM')`,
    })
    .from(transactions)
    .groupBy(sql`to_char(${transactions.postedOn}, 'YYYY-MM')`)
    .orderBy(desc(sql`to_char(${transactions.postedOn}, 'YYYY-MM')`));
  return rows.map((r) => r.month);
}
