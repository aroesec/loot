import { FundScheduleForm } from "@/components/fund-schedule-form";
import { Card, Stat } from "@/components/ui";
import { formatCents } from "@/lib/money";
import type { allocationPlanning } from "@/lib/planning";
export function AllocationSummary({
  incomeCents,
  expensesCents,
  funds,
  month,
}: {
  month: string;
  incomeCents: number | null;
  expensesCents: number;
  funds: Awaited<ReturnType<typeof allocationPlanning>>;
}) {
  const total = expensesCents + funds.forecastCents;
  const left = incomeCents === null ? null : incomeCents - total;
  return (
    <Card className="mb-5">
      <h2 className="text-lg">Where this month’s money goes</h2>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
        Savings and investments are money you keep. They reduce what’s available
        to spend, not your income.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Stat
          label="Expenses"
          value={formatCents(expensesCents)}
          detail="Category budgets, recorded spending, and planned bills"
        />
        <Stat
          label="Savings"
          value={formatCents(funds.savingsCents)}
          detail="Net contributions plus remaining estimated transfers"
        />
        <Stat
          label="Investments"
          value={formatCents(funds.investmentCents)}
          detail="Net contributions plus remaining estimated transfers"
        />
      </div>
      {funds.byFund.length > 0 && (
        <ul className="mt-4 divide-y divide-[var(--color-border)]">
          {funds.byFund.map((fund) => (
            <li key={fund.id} className="py-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <span>
                  {fund.name} ·{" "}
                  {fund.kind === "savings" ? "Savings" : "Investments"}
                </span>
                <span className="figure">
                  {formatCents(fund.recordedCents)} recorded +{" "}
                  {formatCents(fund.remainingCents)} still planned
                </span>
              </div>
              <FundScheduleForm
                fundId={fund.id}
                name={fund.name}
                month={month}
                schedule={fund.schedule}
              />
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap justify-between gap-3 border-t border-[var(--color-border)] pt-4">
        <span>
          Total allocated{" "}
          <strong className="figure">{formatCents(total)}</strong>
        </span>
        <strong
          className={`figure ${left !== null && left < 0 ? "text-negative" : "text-positive"}`}
        >
          {left === null
            ? "Income forecast unavailable"
            : `${left < 0 ? "Projected shortfall" : "Left to spend"}: ${formatCents(Math.abs(left))}`}
        </strong>
      </div>
      {left !== null && left < 0 && (
        <p role="alert" className="mt-3 text-negative">
          Your expenses, savings, and investments exceed projected income by{" "}
          {formatCents(-left)}. Reduce the plan or add confirmed income.
        </p>
      )}
      <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
        Saved weekly schedules take priority. Otherwise, fund estimates use the
        last full month when contributions occurred in both previous months
        within 50% of each other. Recorded transfers replace the estimate.
        One-off or changed transfers and unbudgeted future purchases are not
        predicted. This is a forecast, not cash currently available.
      </p>
    </Card>
  );
}
