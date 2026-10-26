import Link from "next/link";
import { Card, Stat } from "@/components/ui";
import { formatCents } from "@/lib/money";
import type { incomeProjection } from "@/lib/income";
import type { monthlyActuals } from "@/lib/planning/actuals";

export function IncomeOverview({
  income,
  totals,
}: {
  income: Awaited<ReturnType<typeof incomeProjection>>;
  totals: Awaited<ReturnType<typeof monthlyActuals>>;
}) {
  return (
    <section
      aria-label="Income, savings and investments"
      className="mb-4 space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Income received"
          value={formatCents(income.receivedIncomeCents)}
          detail="Money that has landed this month. Cleared deposits only; transfers excluded."
        />
        <Stat
          label="Saved this month"
          value={formatCents(totals.savingsCents)}
          detail="Cleared savings contributions, net of withdrawals."
        />
        <Stat
          label="Invested this month"
          value={formatCents(totals.investmentCents)}
          detail="Cleared investment contributions, net of withdrawals. Not an account balance."
        />
      </div>
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg">Income streams</h2>
          <Link
            href="/settings#income-plan"
            className="text-sm underline underline-offset-4"
          >
            Manage income
          </Link>
        </div>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-sm">Expected salary income</span>
          <strong className="figure text-2xl">
            {formatCents(income.plannedIncomeCents)}
          </strong>
          <span className="text-xs text-[var(--color-ink-muted)]">
            Full month · configured salaries only
          </span>
        </div>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {income.sources.map((source) => (
            <li
              key={source.sourceId}
              className="rounded-lg border border-[var(--color-border)] p-3"
            >
              <div className="flex flex-wrap justify-between gap-2 text-sm">
                <h3 className="font-medium break-words">{source.name}</h3>
                <span>
                  {source.receivedCount} of {source.paymentsPerMonth} received
                </span>
              </div>
              <p className="mt-2 text-sm figure">
                {formatCents(source.receivedCents)} received ·{" "}
                {formatCents(source.remainingCents)} still expected
              </p>
              <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                {source.paymentsPerMonth} × {formatCents(source.amountCents)}{" "}
                planned for the month
              </p>
            </li>
          ))}
        </ul>
        {income.sources.length === 0 && (
          <p className="mt-3 text-sm">No salaries configured for this month.</p>
        )}
        {income.ambiguousCount > 0 && (
          <p role="alert" className="mt-3 text-sm text-warning">
            Some deposits match multiple income streams. Update their
            descriptions in Settings to correct receipt progress.
          </p>
        )}
        <details className="mt-4 border-t border-[var(--color-border)] pt-4">
          <summary className="cursor-pointer text-sm">
            Deposits received · {formatCents(income.receivedIncomeCents)}
          </summary>
          <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
            Every cleared incoming credit below adds to the received total.
            Business payments and refunds count here, but do not increase
            expected salary income.
          </p>
          <ul className="mt-3 divide-y divide-[var(--color-border)]">
            {income.receipts.map((receipt) => (
              <li
                key={receipt.id}
                className="flex items-baseline justify-between gap-3 py-2 text-sm [content-visibility:auto] [contain-intrinsic-size:auto_48px]"
              >
                <div className="min-w-0">
                  <p className="break-words">
                    {receipt.merchant || receipt.rawDescription}
                  </p>
                  <time
                    className="text-xs text-[var(--color-ink-muted)]"
                    dateTime={receipt.postedOn}
                  >
                    {receipt.postedOn}
                  </time>
                </div>
                <span className="figure shrink-0">
                  {formatCents(receipt.amountCents)}
                </span>
              </li>
            ))}
          </ul>
          {income.receipts.length === 0 && (
            <p className="mt-3 text-sm">No cleared income received yet.</p>
          )}
          <div className="mt-2 flex justify-between gap-3 border-t border-[var(--color-border)] pt-3 text-sm font-medium">
            <span>Total income received</span>
            <span className="figure">
              {formatCents(income.receivedIncomeCents)}
            </span>
          </div>
        </details>
      </Card>
    </section>
  );
}
