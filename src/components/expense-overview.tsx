import Link from "next/link";
import { Bar, Card, Stat } from "@/components/ui";
import { formatCents } from "@/lib/money";
import type { fundSummary } from "@/lib/funds";
import type { budgetPlanning } from "@/lib/planning";

export function ExpenseOverview({
  month,
  currentMonth,
  plan,
  funds,
}: {
  month: string;
  currentMonth: string;
  plan: Awaited<ReturnType<typeof budgetPlanning>>;
  funds: Awaited<ReturnType<typeof fundSummary>>;
}) {
  const contributions = funds.byFund.reduce(
    (sum, fund) => sum + fund.contributedCents,
    0,
  );
  const watch = plan.lines
    .filter(
      (line) =>
        line.availableCents > 0 &&
        line.spentCents >= line.availableCents * 0.75,
    )
    .sort(
      (a, b) =>
        b.spentCents / b.availableCents - a.spentCents / a.availableCents,
    );
  const upcoming = plan.recurring.approved.filter(
    (bill) => bill.remainingCents > 0,
  );
  return (
    <section aria-label="Monthly spending" className="space-y-4">
      {month >= currentMonth && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Stat
            label="Expenses to date"
            value={formatCents(plan.spentCents)}
            detail="Recorded purchases and bills, including pending charges. Savings transfers excluded."
          />
          <Stat
            label="Total money out"
            value={formatCents(plan.spentCents + contributions)}
            detail={
              <>
                {formatCents(plan.spentCents)} expenses +{" "}
                {formatCents(contributions)} savings &amp; investment transfers.
                Includes pending activity; not your checking balance.
              </>
            }
          />
        </div>
      )}
      {month >= currentMonth && (
        <Card>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-lg">Recurring bills</h2>
            <span className="figure text-xl">
              {formatCents(plan.remainingBillsCents)} upcoming
            </span>
          </div>
          <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
            Approved bills not yet recorded this month. Separate from total
            money out above.
          </p>
          {upcoming.length > 0 ? (
            <ul className="mt-3 divide-y divide-[var(--color-border)]">
              {upcoming.map((bill) => (
                <li
                  key={`${bill.accountId}-${bill.categoryId}-${bill.merchant}`}
                  className="flex items-baseline justify-between gap-3 py-2 text-sm"
                >
                  <span className="min-w-0 break-words">{bill.name}</span>
                  <span className="figure shrink-0">
                    {formatCents(bill.remainingCents)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm">
              No approved recurring bills left to record this month.
            </p>
          )}
          <Link
            href={`/recurring?month=${month}`}
            className="mt-3 inline-block text-sm underline underline-offset-4"
          >
            Review recurring bills
          </Link>
        </Card>
      )}
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg">Budget watch</h2>
          <Link
            href={`/budgets?month=${month}`}
            className="text-sm underline underline-offset-4"
          >
            View all budgets
          </Link>
        </div>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Categories at 75% or more of their monthly limit.
        </p>
        {watch.length === 0 ? (
          <p className="mt-4 text-sm">
            {plan.availableCents > 0
              ? "No categories are approaching their limits."
              : "Set category budgets to start tracking your limits."}
          </p>
        ) : (
          <ul className="mt-4 grid gap-x-8 gap-y-5 md:grid-cols-2">
            {watch.map((line) => {
              const over = line.spentCents > line.availableCents;
              return (
                <li key={line.id} className="min-w-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
                    <span className="font-medium">{line.name}</span>
                    <span className="figure text-xs text-[var(--color-ink-muted)]">
                      {formatCents(line.spentCents)} of{" "}
                      {formatCents(line.availableCents)}
                    </span>
                  </div>
                  <div className="my-2">
                    <Bar
                      fraction={line.spentCents / line.availableCents}
                      over={over}
                    />
                  </div>
                  <p
                    className={`text-xs ${over ? "text-negative" : "text-warning"}`}
                  >
                    {over
                      ? `Over by ${formatCents(line.spentCents - line.availableCents)}`
                      : line.spentCents === line.availableCents
                        ? "At limit"
                        : "Approaching limit"}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </section>
  );
}
