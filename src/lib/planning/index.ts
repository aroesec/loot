import {
  fundScheduleInput,
  weeklyFundForecast,
  type FundSchedule,
} from "./fund-schedule";
import { and, asc, eq, gte, isNull, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  funds,
  fundSchedules,
  budgets,
  categories,
  expensePlans,
  transactions,
} from "@/db/schema";
import { monthBounds, shiftMonth } from "@/lib/dates";
import { ledgerMode } from "@/lib/mode";
import { budgetStatus, monthSummary } from "@/lib/ledger";
import {
  expenseKey,
  expensePlanInput,
  latestExpensePlans,
  suggestExpenses,
  projectExpenses,
  categoryForecast,
  type ExpensePlan,
} from "./logic";
import { incomeMonth } from "@/lib/income/logic";
import { z } from "zod";

export class PlanningError extends Error {}
export async function planningCategories() {
  const mode = await ledgerMode();
  const rows = await db
    .select()
    .from(categories)
    .where(eq(categories.mode, mode))
    .orderBy(asc(categories.sortOrder), asc(categories.name));
  const parents = new Set(rows.map((row) => row.parentId).filter(Boolean));
  return rows
    .filter((row) => row.kind === "expense" && !parents.has(row.id))
    .map((row) => ({
      ...row,
      group: rows.find((parent) => parent.id === row.parentId)?.name ?? "Other",
    }));
}
export async function expensePlanning(month: string) {
  incomeMonth.parse(month);
  const bounds = monthBounds(month),
    start = monthBounds(shiftMonth(month, -2)).start;
  const mode = await ledgerMode();
  const [plans, rows, accountRows] = await Promise.all([
    db
      .select()
      .from(expensePlans)
      .innerJoin(categories, eq(categories.id, expensePlans.categoryId))
      .where(
        and(lte(expensePlans.effectiveMonth, month), eq(categories.mode, mode)),
      )
      .then((rows) => rows.map((row) => row.expense_plans)),
    db
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        categoryId: transactions.categoryId,
        merchant: transactions.merchant,
        amountCents: transactions.amountCents,
        postedOn: transactions.postedOn,
        isTransfer: transactions.isTransfer,
        status: transactions.status,
      })
      .from(transactions)
      .innerJoin(categories, eq(categories.id, transactions.categoryId))
      .where(
        and(
          gte(transactions.postedOn, start),
          lte(transactions.postedOn, bounds.end),
          lt(transactions.amountCents, 0),
          eq(transactions.isTransfer, false),
          eq(categories.kind, "expense"),
          eq(categories.mode, mode),
        ),
      ),
    db.select({ id: accounts.id, name: accounts.name }).from(accounts),
  ]);
  const latest = latestExpensePlans({ month, plans });
  const known = new Set(latest.map(expenseKey));
  const withAccount = <T extends { accountId: string }>(row: T) => ({
    ...row,
    accountName:
      accountRows.find((account) => account.id === row.accountId)?.name ??
      "Account unavailable",
  });
  return {
    suggestions: suggestExpenses({ month, rows })
      .filter((row) => !known.has(row.key))
      .map(withAccount),
    approved: projectExpenses({ month, plans, rows }).map(withAccount),
    dismissed: latest.filter((row) => !row.enabled).map(withAccount),
  };
}
export async function budgetPlanning(month: string) {
  const [cats, status, summary, recurring] = await Promise.all([
    planningCategories(),
    budgetStatus(month),
    monthSummary(month),
    expensePlanning(month),
  ]);
  const lines = cats.map((category) => {
    const budget = status.lines.find((line) => line.categoryId === category.id);
    const spentCents =
      summary.byCategory.find((row) => row.categoryId === category.id)
        ?.spendCents ?? 0;
    const bills = recurring.approved.filter(
      (row) => row.categoryId === category.id,
    );
    const recurringCents = bills.reduce((sum, row) => sum + row.amountCents, 0);
    const recurringRemainingCents = bills.reduce(
      (sum, row) => sum + row.remainingCents,
      0,
    );
    const availableCents = budget?.availableCents ?? 0;
    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      group: category.group,
      spentCents,
      budgetCents: budget?.budgetCents ?? 0,
      availableCents,
      carriedCents: budget?.carriedCents ?? 0,
      rollover: budget?.rollover ?? "none",
      recurringCents,
      recurringRemainingCents,
      forecastCents: categoryForecast({
        spentCents,
        availableCents,
        recurringRemainingCents,
      }),
    };
  });
  const otherSpentCents = Math.max(
    0,
    summary.spendCents - lines.reduce((sum, row) => sum + row.spentCents, 0),
  );
  return {
    lines,
    recurring,
    otherSpentCents,
    spentCents: summary.spendCents,
    budgetCents: lines.reduce((sum, row) => sum + row.budgetCents, 0),
    availableCents: lines.reduce((sum, row) => sum + row.availableCents, 0),
    forecastCents:
      otherSpentCents + lines.reduce((sum, row) => sum + row.forecastCents, 0),
    remainingBillsCents: recurring.approved.reduce(
      (sum, row) => sum + row.remainingCents,
      0,
    ),
  };
}
export async function saveExpensePlan(input: ExpensePlan) {
  const plan = expensePlanInput.parse(input);
  const cats = await planningCategories();
  if (!cats.some((row) => row.id === plan.categoryId))
    throw new PlanningError("Choose a spending category in this ledger.");
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, plan.accountId), isNull(accounts.archivedAt)));
  if (!account) throw new PlanningError("Choose an active account.");
  const sourceKey = expenseKey(plan);
  await db
    .insert(expensePlans)
    .values({ ...plan, sourceKey })
    .onConflictDoUpdate({
      target: [expensePlans.sourceKey, expensePlans.effectiveMonth],
      set: plan,
    });
}
export const budgetInput = z.object({
  categoryId: z.uuid(),
  month: incomeMonth,
  amountCents: z.number().int().min(0).max(100_000_000),
  rollover: z.enum(["none", "under", "both"]),
});
export async function saveCategoryBudget(
  input: z.infer<typeof budgetInput>,
  onlyIfUnset = false,
) {
  const value = budgetInput.parse(input);
  if (!(await planningCategories()).some((row) => row.id === value.categoryId))
    throw new PlanningError("Choose a spending category in this ledger.");
  const effectiveFrom = monthBounds(value.month).start;
  const dayBefore = (date: string) =>
    new Date(Date.parse(date) - 86_400_000).toISOString().slice(0, 10);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${71_839_212})`);
    const versions = await tx
      .select()
      .from(budgets)
      .where(eq(budgets.categoryId, value.categoryId))
      .orderBy(asc(budgets.effectiveFrom));
    if (
      onlyIfUnset &&
      versions.some(
        (row) =>
          row.effectiveFrom <= monthBounds(value.month).end &&
          (!row.effectiveTo || row.effectiveTo >= effectiveFrom),
      )
    )
      return false;
    const current = versions.find((row) => row.effectiveFrom === effectiveFrom);
    const next = versions.find((row) => row.effectiveFrom > effectiveFrom);
    const previous = versions
      .filter((row) => row.effectiveFrom < effectiveFrom)
      .at(-1);
    const values = {
      amountCents: value.amountCents,
      rollover: value.rollover,
      effectiveTo: next ? dayBefore(next.effectiveFrom) : null,
    };
    if (current)
      await tx.update(budgets).set(values).where(eq(budgets.id, current.id));
    else
      await tx
        .insert(budgets)
        .values({ ...values, categoryId: value.categoryId, effectiveFrom });
    if (
      previous &&
      (!previous.effectiveTo || previous.effectiveTo >= effectiveFrom)
    )
      await tx
        .update(budgets)
        .set({ effectiveTo: dayBefore(effectiveFrom) })
        .where(eq(budgets.id, previous.id));
    return true;
  });
}

/** Explicit user action; never writes plans while rendering a page. */
export async function populateRecurringBudgets(month: string) {
  incomeMonth.parse(month);
  const recurring = await expensePlanning(month);
  for (const suggestion of recurring.suggestions)
    await saveExpensePlan(suggestion);
  const plan = await budgetPlanning(month);
  const { start, end } = monthBounds(month);
  const existing = await db
    .select()
    .from(budgets)
    .where(
      and(
        lte(budgets.effectiveFrom, end),
        sql`(${budgets.effectiveTo} is null or ${budgets.effectiveTo} >= ${start})`,
      ),
    );
  let created = 0;
  for (const line of plan.lines) {
    // A deliberately cleared budget is a user decision too.
    if (
      line.recurringCents <= 0 ||
      existing.some((row) => row.categoryId === line.id)
    )
      continue;
    const saved = await saveCategoryBudget(
      {
        categoryId: line.id,
        month,
        amountCents: line.recurringCents,
        rollover: "none",
      },
      true,
    );
    if (saved) created++;
  }
  return { approved: recurring.suggestions.length, created };
}

export async function allocationPlanning(month: string) {
  incomeMonth.parse(month);
  const { fundSummary } = await import("@/lib/funds");
  const { fundForecast } = await import("./logic");
  const [current, previous, earlier] = await Promise.all([
    fundSummary(month),
    fundSummary(shiftMonth(month, -1)),
    fundSummary(shiftMonth(month, -2)),
  ]);
  const schedules = await db
    .select()
    .from(fundSchedules)
    .where(lte(fundSchedules.effectiveMonth, month))
    .orderBy(asc(fundSchedules.effectiveMonth));
  const active = new Map(schedules.map((row) => [row.fundId, row]));
  const bounds = monthBounds(month);
  const movements = await db
    .select({
      id: transactions.id,
      fundId: transactions.fundId,
      amountCents: transactions.amountCents,
      postedOn: transactions.postedOn,
    })
    .from(transactions)
    .innerJoin(
      funds,
      and(
        eq(transactions.fundId, funds.id),
        eq(transactions.accountId, funds.fundingAccountId),
      ),
    )
    .where(
      and(
        eq(transactions.isTransfer, true),
        gte(transactions.postedOn, bounds.start),
        lte(transactions.postedOn, bounds.end),
      ),
    );
  const byFund = current.byFund.map((fund) => {
    const schedule = active.get(fund.id);
    const forecast = schedule
      ? weeklyFundForecast({
          month,
          schedule,
          contributedCents: fund.contributedCents,
          withdrawnCents: fund.withdrawnCents,
          rows: movements.filter((row) => row.fundId === fund.id),
        })
      : fundForecast({
          contributedCents: fund.contributedCents,
          withdrawnCents: fund.withdrawnCents,
          previousCents:
            previous.byFund.find((row) => row.id === fund.id)
              ?.contributedCents ?? 0,
          earlierCents:
            earlier.byFund.find((row) => row.id === fund.id)
              ?.contributedCents ?? 0,
        });
    return { ...fund, ...forecast, schedule: schedule ?? null };
  });
  return {
    byFund,
    savingsCents: byFund
      .filter((row) => row.kind === "savings")
      .reduce((sum, row) => sum + row.forecastCents, 0),
    investmentCents: byFund
      .filter((row) => row.kind === "investment")
      .reduce((sum, row) => sum + row.forecastCents, 0),
    remainingCents: byFund.reduce((sum, row) => sum + row.remainingCents, 0),
    recordedCents: current.netCents,
    forecastCents: byFund.reduce((sum, row) => sum + row.forecastCents, 0),
  };
}

export async function saveFundSchedule(input: FundSchedule) {
  const value = fundScheduleInput.parse(input);
  if ((await ledgerMode()) !== "personal")
    throw new PlanningError("Fund schedules are available in personal mode.");
  const [fund] = await db
    .select()
    .from(funds)
    .where(eq(funds.id, value.fundId));
  if (!fund) throw new PlanningError("Choose an existing fund.");
  await db
    .insert(fundSchedules)
    .values(value)
    .onConflictDoUpdate({
      target: [fundSchedules.fundId, fundSchedules.effectiveMonth],
      set: value,
    });
}
