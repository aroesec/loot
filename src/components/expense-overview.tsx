import Link from "next/link";
import { Bar, Card, Stat } from "@/components/ui";
import { formatCents } from "@/lib/money";
import type { budgetPlanning } from "@/lib/planning";

export function ExpenseOverview({
  month,
  currentMonth,
  plan,
}: {
  month: string;
  currentMonth: string;
  plan: Awaited<ReturnType<typeof budgetPlanning>>;
}) {
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
            label="Upcoming recurring expenses"
            value={formatCents(plan.remainingBillsCents)}
            detail={
              <>
                {upcoming.length} approved{" "}
                {upcoming.length === 1 ? "bill" : "bills"} not yet recorded this
                month. Already recorded bills are excluded.
                <Link
                  href={`/recurring?month=${month}`}
                  className="mt-2 block underline underline-offset-4"
                >
                  Review upcoming bills
                </Link>
              </>
            }
          />
        </div>
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
