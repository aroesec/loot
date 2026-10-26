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
  if (month >= currentMonth) return null;
  return (
    <Card className="mb-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl">Month-end summary</h2>
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
      <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
        Cleared transactions only. Savings are net fund transfers; payroll
        savings are not included.
        {totals.leftCents < 0 &&
          ` Expenses and savings exceeded received income by ${formatCents(-totals.leftCents)}.`}
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
