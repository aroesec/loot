import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { availableMonths } from "@/lib/ledger";
import { currentMonth, monthLabel } from "@/lib/dates";
import { incomeMonth } from "@/lib/income/logic";
import { allocationPlanning, budgetPlanning } from "@/lib/planning";
import { incomeProjection } from "@/lib/income";
import { AllocationSummary } from "@/components/allocation-summary";
import { AutoBudget } from "@/components/auto-budget";
import { PageHeader, Card, Stat } from "@/components/ui";
import { PeriodPicker } from "@/components/period-picker";
import { BudgetPlanner } from "@/components/budget-planner";
import { formatCents } from "@/lib/money";
export const dynamic = "force-dynamic";
export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  await requireAuth();
  const params = await searchParams;
  const month = incomeMonth.safeParse(params.month).success
    ? params.month!
    : currentMonth();
  const [plan, income, funds, history] = await Promise.all([
    budgetPlanning(month),
    incomeProjection(month),
    allocationPlanning(month),
    availableMonths(),
  ]);
  const months = [...new Set([month, currentMonth(), ...history])]
    .sort()
    .reverse();
  const left =
    income.projectedIncomeCents === null
      ? null
      : income.projectedIncomeCents - plan.forecastCents - funds.forecastCents;
  return (
    <>
      <PageHeader
        title="Monthly budget"
        subtitle={`${monthLabel(month)} · Give every spending category a plan`}
        actions={
          <PeriodPicker
            name="month"
            label="Month"
            value={month}
            options={months.map((value) => ({
              value,
              label: monthLabel(value),
            }))}
          />
        }
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Budget allocated"
          value={formatCents(plan.budgetCents)}
          detail={`${plan.lines.filter((row) => row.budgetCents > 0).length} of ${plan.lines.length} categories budgeted`}
        />
        <Stat label="Recorded spending" value={formatCents(plan.spentCents)} />
        <Stat
          label="Planned monthly spending"
          value={formatCents(plan.forecastCents)}
          detail="Budgets, recorded spending, and approved bills combined without overlap"
        />
        <Stat
          label="Left after the plan"
          value={left === null ? "—" : formatCents(left)}
          tone={left !== null && left < 0 ? "negative" : "positive"}
          detail="Projected income minus planned spending and planned savings and investments"
        />
      </div>
      <AllocationSummary
        month={month}
        incomeCents={income.projectedIncomeCents}
        expensesCents={plan.forecastCents}
        funds={funds}
      />
      <Card className="mb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg">Review recurring expenses</h2>
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
              {plan.recurring.suggestions.length} suggestions awaiting approval
              · {formatCents(plan.remainingBillsCents)} in approved bills still
              expected this month.
            </p>
          </div>
          <Link href={`/recurring?month=${month}`} className="btn btn-primary">
            Review bills
          </Link>
        </div>
        <AutoBudget month={month} />
        <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
          The plan uses the larger of each category’s budget or its spending
          plus unpaid approved bills. Unbudgeted purchases and unapproved future
          bills remain unknown. This is not your bank balance.
        </p>
      </Card>
      <BudgetPlanner plan={plan} month={month} />
    </>
  );
}
