import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { expensePlanning, planningCategories } from "@/lib/planning";
import { currentMonth, monthLabel } from "@/lib/dates";
import { incomeMonth } from "@/lib/income/logic";
import { availableMonths } from "@/lib/ledger";
import { PageHeader, Stat } from "@/components/ui";
import { PeriodPicker } from "@/components/period-picker";
import { ExpenseApprovals } from "@/components/expense-approvals";
import { formatCents } from "@/lib/money";
export const dynamic = "force-dynamic";
export default async function RecurringPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  await requireAuth();
  const params = await searchParams;
  const month = incomeMonth.safeParse(params.month).success
    ? params.month!
    : currentMonth();
  const [planning, categories, history] = await Promise.all([
    expensePlanning(month),
    planningCategories(),
    availableMonths(),
  ]);
  const months = [...new Set([month, currentMonth(), ...history])]
    .sort()
    .reverse();
  return (
    <>
      <PageHeader
        title="Recurring expenses"
        subtitle={`${monthLabel(month)} · Review first, then include in your plan`}
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
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Stat
          label="Awaiting approval"
          value={String(planning.suggestions.length)}
          detail="Not included in projected expenses"
        />
        <Stat
          label="Approved monthly bills"
          value={formatCents(
            planning.approved.reduce((sum, row) => sum + row.amountCents, 0),
          )}
          detail={`${planning.approved.length} ${planning.approved.length === 1 ? "bill" : "bills"}`}
        />
        <Stat
          label="Still expected this month"
          value={formatCents(
            planning.approved.reduce((sum, row) => sum + row.remainingCents, 0),
          )}
          detail="Recorded payments replace their estimates"
        />
      </div>
      <p className="mb-6 text-sm">
        <Link
          href={`/budgets?month=${month}`}
          className="underline underline-offset-4"
        >
          View all category budgets and totals →
        </Link>
      </p>
      <ExpenseApprovals
        planning={planning}
        categories={categories}
        month={month}
      />
    </>
  );
}
