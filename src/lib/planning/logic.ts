import { z } from "zod";
import { shiftMonth } from "@/lib/dates";
import { incomeMonth } from "@/lib/income/logic";

export const expensePlanInput = z.object({
  accountId: z.uuid(),
  categoryId: z.uuid(),
  merchant: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(100),
  amountCents: z.number().int().min(1).max(100_000_000),
  effectiveMonth: incomeMonth,
  enabled: z.boolean(),
});
export type ExpensePlan = z.infer<typeof expensePlanInput>;
export type ExpenseRow = {
  id: string;
  accountId: string | null;
  categoryId: string | null;
  merchant: string | null;
  amountCents: number;
  postedOn: string;
  isTransfer: boolean;
  status: string;
};
export const merchantKey = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, " ");
export const expenseKey = (row: {
  accountId: string | null;
  categoryId: string | null;
  merchant: string | null;
}) =>
  JSON.stringify([
    row.accountId,
    row.categoryId,
    merchantKey(row.merchant ?? ""),
  ]);
export function latestExpensePlans({
  month,
  plans,
}: {
  month: string;
  plans: ExpensePlan[];
}) {
  const latest = new Map<string, ExpensePlan>();
  for (const plan of plans) {
    const key = expenseKey(plan),
      previous = latest.get(key);
    if (
      plan.effectiveMonth <= month &&
      (!previous || previous.effectiveMonth < plan.effectiveMonth)
    )
      latest.set(key, plan);
  }
  return [...latest.values()];
}
export function suggestExpenses({
  month,
  rows,
}: {
  month: string;
  rows: ExpenseRow[];
}) {
  const previous = shiftMonth(month, -1),
    earliest = shiftMonth(month, -2);
  const groups = new Map<string, ExpenseRow[]>();
  for (const row of new Map(rows.map((row) => [row.id, row])).values()) {
    if (
      !row.accountId ||
      !row.categoryId ||
      !row.merchant ||
      row.amountCents >= 0 ||
      row.isTransfer ||
      row.status !== "cleared" ||
      ![earliest, previous, month].includes(row.postedOn.slice(0, 7))
    )
      continue;
    const key = expenseKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()]
    .flatMap(([key, group]) => {
      const sorted = [...group].sort((a, b) =>
        a.postedOn.localeCompare(b.postedOn),
      );
      const [first, last] = sorted.slice(-2);
      if (
        !first ||
        !last ||
        first.postedOn.slice(0, 7) !==
          shiftMonth(last.postedOn.slice(0, 7), -1) ||
        !last.accountId ||
        !last.categoryId ||
        !last.merchant
      )
        return [];
      if (
        sorted.filter(
          (row) => row.postedOn.slice(0, 7) === first.postedOn.slice(0, 7),
        ).length !== 1 ||
        sorted.filter(
          (row) => row.postedOn.slice(0, 7) === last.postedOn.slice(0, 7),
        ).length !== 1
      )
        return [];
      const gap =
        (Date.parse(last.postedOn) - Date.parse(first.postedOn)) / 86_400_000;
      const amounts = [first, last].map((row) => -row.amountCents);
      if (
        gap < 24 ||
        gap > 38 ||
        Math.max(...amounts) / Math.min(...amounts) > 1.5
      )
        return [];
      return [
        {
          key,
          accountId: last.accountId,
          categoryId: last.categoryId,
          merchant: last.merchant,
          name: last.merchant,
          amountCents: -last.amountCents,
          evidence: [first, last],
          effectiveMonth: month,
          enabled: true,
        },
      ];
    })
    .sort((a, b) => b.amountCents - a.amountCents);
}
export function projectExpenses({
  month,
  plans,
  rows,
}: {
  month: string;
  plans: ExpensePlan[];
  rows: ExpenseRow[];
}) {
  return latestExpensePlans({ month, plans })
    .filter((plan) => plan.enabled)
    .map((plan) => {
      const payments = [
        ...new Map(rows.map((row) => [row.id, row])).values(),
      ].filter(
        (row) =>
          row.amountCents < 0 &&
          !row.isTransfer &&
          row.postedOn.slice(0, 7) === month &&
          expenseKey(row) === expenseKey(plan),
      );
      return {
        ...plan,
        key: expenseKey(plan),
        payments,
        recordedCents: payments.reduce((sum, row) => sum - row.amountCents, 0),
        remainingCents: payments.length ? 0 : plan.amountCents,
      };
    });
}
export function categoryForecast({
  spentCents,
  availableCents,
  recurringRemainingCents,
}: {
  spentCents: number;
  availableCents: number;
  recurringRemainingCents: number;
}) {
  return Math.max(availableCents, spentCents + recurringRemainingCents);
}
export function budgetAlert({
  spentCents,
  availableCents,
  hasBudget,
}: {
  spentCents: number;
  availableCents: number;
  hasBudget: boolean;
}) {
  if (!hasBudget) return "No budget set";
  if (spentCents > availableCents) return "Over budget";
  if (spentCents === availableCents) return "At the limit";
  if (spentCents >= availableCents * 0.75) return "Approaching the limit";
  return "Within budget";
}

/** Reserve a repeat monthly contribution once; recorded transfers replace it. */
export function fundForecast({
  contributedCents,
  withdrawnCents,
  previousCents,
  earlierCents,
}: {
  contributedCents: number;
  withdrawnCents: number;
  previousCents: number;
  earlierCents: number;
}) {
  const recurringCents =
    previousCents > 0 &&
    earlierCents > 0 &&
    Math.max(previousCents, earlierCents) /
      Math.min(previousCents, earlierCents) <=
      1.5
      ? previousCents
      : 0;
  const remainingCents = Math.max(0, recurringCents - contributedCents);
  return {
    recurringCents,
    remainingCents,
    recordedCents: contributedCents - withdrawnCents,
    forecastCents: contributedCents + remainingCents - withdrawnCents,
  };
}
