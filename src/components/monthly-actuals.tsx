import Link from "next/link";
import { Card, Stat } from "@/components/ui";
import { formatCents } from "@/lib/money";
import { monthLabel, monthBounds } from "@/lib/dates";
import type { monthlyActuals } from "@/lib/planning/actuals";
export function MonthlyActuals({
  month,
  currentMonth,
  totals,
  hasAccountGaps,
}: {
  month: string;
  currentMonth: string;
  totals: Awaited<ReturnType<typeof monthlyActuals>>;
  hasAccountGaps: boolean;
}) {
  const ended = month < currentMonth;
  return (
    <Card className="mb-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl">
          {ended ? "Month-end actuals" : "Actuals so far"}
        </h2>
        <span className="text-sm text-[var(--color-ink-muted)]">
          {monthLabel(month)} · Cleared transactions
        </span>
      </div>
      <p className="mt-2 text-sm">
        Income actually received:{" "}
        <strong className="figure">{formatCents(totals.incomeCents)}</strong>
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Stat
          label="Actually spent"
          value={formatCents(totals.spentCents)}
          detail="Cleared expenses; savings transfers excluded"
        />
        <Stat
          label="Actually saved & invested"
          value={formatCents(totals.savedCents)}
          detail={`${formatCents(totals.savingsCents)} savings + ${formatCents(totals.investmentCents)} investments, net of withdrawals`}
        />
        <Stat
          label="Left to save further"
          value={formatCents(totals.furtherSavingsCents)}
          tone={totals.leftCents < 0 ? "warning" : "positive"}
          detail="Received income minus actual expenses and net contributions"
        />
      </div>
      {totals.leftCents < 0 && (
        <p className="mt-3 text-sm text-[var(--color-warning)]">
          Recorded expenses and contributions exceed income received this month
          by {formatCents(-totals.leftCents)}. There is no additional surplus
          from this month’s received income yet. Earlier cash balances can fund
          that difference; this is not an overdraft calculation.
        </p>
      )}
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer">How these totals reconcile</summary>
        <dl className="mt-3 grid grid-cols-2 gap-2">
          <dt>Income received</dt>
          <dd className="figure text-right">
            {formatCents(totals.incomeCents)}
          </dd>
          <dt>Expenses</dt>
          <dd className="figure text-right">
            −{formatCents(totals.spentCents)}
          </dd>
          <dt>Fund contributions</dt>
          <dd className="figure text-right">
            −{formatCents(totals.contributedCents)}
          </dd>
          <dt>Fund withdrawals</dt>
          <dd className="figure text-right">
            +{formatCents(totals.withdrawnCents)}
          </dd>
          <dt className="font-medium">Unallocated monthly cash flow</dt>
          <dd className="figure text-right font-medium">
            {formatCents(totals.leftCents)}
          </dd>
        </dl>
      </details>
      <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
        {ended
          ? "The calendar month has ended. These totals update when missing transactions are imported or corrected."
          : "This month is still in progress; the month-end summary appears here automatically once it ends."}{" "}
        Budgets, expected paychecks, scheduled transfers, and untracked payroll
        savings are excluded. Savings means net transfers to your configured
        funds, not investment gains or net-worth growth.
      </p>
      {(totals.pendingCount > 0 || hasAccountGaps) && (
        <p className="mt-3 text-sm text-[var(--color-warning)]">
          {totals.pendingCount > 0
            ? `${totals.pendingCount} pending transaction(s) excluded. `
            : ""}
          {hasAccountGaps
            ? "Some card purchases are not imported; totals may be incomplete. "
            : ""}
          <Link
            className="underline underline-offset-4"
            href={
              hasAccountGaps
                ? "/cards"
                : `/transactions?from=${monthBounds(month).start}&to=${monthBounds(month).end}`
            }
          >
            Review recorded activity
          </Link>
        </p>
      )}
      {totals.recordedCount === 0 && (
        <p className="mt-3 text-sm">
          No transactions recorded for this month. Import the statements before
          treating these zeros as final.
        </p>
      )}
    </Card>
  );
}
