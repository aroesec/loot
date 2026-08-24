import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { yearLedger, availableMonths } from "@/lib/ledger";
import { formatCents, pctChange } from "@/lib/money";
import { PageHeader, Card, Stat, EmptyState } from "@/components/ui";
import { PeriodPicker } from "@/components/period-picker";

export const dynamic = "force-dynamic";

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default async function YearPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  await requireAuth();
  const params = await searchParams;

  const months = await availableMonths();
  if (months.length === 0) {
    return (
      <>
        <PageHeader title="Year" />
        <EmptyState title="Nothing to tally yet">
          Import a statement and the yearly ledger builds itself.
        </EmptyState>
      </>
    );
  }

  const years = [...new Set(months.map((m) => Number(m.slice(0, 4))))].sort((a, b) => b - a);
  const year = Number(params.year) || years[0]!;
  const ledger = await yearLedger(year);

  const maxMonthly = Math.max(...ledger.months.map((m) => Math.max(m.spendCents, m.incomeCents)), 1);
  const spendYoY = ledger.priorYear ? pctChange(ledger.priorYear.spendCents, ledger.totals.spendCents) : null;
  const incomeYoY = ledger.priorYear ? pctChange(ledger.priorYear.incomeCents, ledger.totals.incomeCents) : null;

  // Only categories with meaningful activity — a long tail of $3 rows makes the
  // matrix unreadable without telling you anything.
  const topCategories = ledger.byCategory.filter((c) => c.totalSpendCents > 0).slice(0, 20);

  return (
    <>
      <PageHeader
        title={String(year)}
        subtitle="Every month, every category, tallied."
        actions={
          <PeriodPicker
            name="year"
            value={String(year)}
            label="Year"
            options={years.map((y) => ({ value: String(y), label: String(y) }))}
          />
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Income"
          value={formatCents(ledger.totals.incomeCents)}
          tone="positive"
          detail={incomeYoY !== null ? `${incomeYoY >= 0 ? "▲" : "▼"} ${Math.abs(incomeYoY).toFixed(0)}% vs ${year - 1}` : undefined}
        />
        <Stat
          label="Spending"
          value={formatCents(ledger.totals.spendCents)}
          tone="negative"
          detail={spendYoY !== null ? `${spendYoY >= 0 ? "▲" : "▼"} ${Math.abs(spendYoY).toFixed(0)}% vs ${year - 1}` : undefined}
        />
        <Stat
          label="Net"
          value={formatCents(ledger.totals.netCents, { signed: true })}
          tone={ledger.totals.netCents >= 0 ? "positive" : "negative"}
        />
        <Stat
          label="Savings rate"
          value={ledger.totals.savingsRate === null ? "—" : `${(ledger.totals.savingsRate * 100).toFixed(0)}%`}
          detail="Share of the year's income you kept"
        />
      </div>

      <Card className="mt-6">
        <h2 className="mb-4 text-lg">Month by month</h2>
        <div className="scroll-x">
          <div className="flex min-w-[640px] items-end gap-2" style={{ height: "180px" }}>
            {ledger.months.map((m, i) => (
              <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex w-full flex-1 items-end justify-center gap-1">
                  <div
                    className="w-1/2 rounded-t-sm bg-[var(--color-positive)] opacity-70"
                    style={{ height: `${(m.incomeCents / maxMonthly) * 100}%` }}
                    title={`Income ${formatCents(m.incomeCents)}`}
                  />
                  <div
                    className="w-1/2 rounded-t-sm bg-[var(--color-negative)] opacity-70"
                    style={{ height: `${(m.spendCents / maxMonthly) * 100}%` }}
                    title={`Spending ${formatCents(m.spendCents)}`}
                  />
                </div>
                <span className="text-[10px] text-[var(--color-ink-faint)]">{MONTH_ABBR[i]}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-3 flex gap-4 text-xs text-[var(--color-ink-muted)]">
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-sm bg-[var(--color-positive)] opacity-70" /> Income
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-sm bg-[var(--color-negative)] opacity-70" /> Spending
          </span>
        </div>
      </Card>

      <Card className="mt-6 !p-0">
        <h2 className="px-5 pt-5 text-lg">Category ledger</h2>
        <div className="scroll-x mt-3">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-xs text-[var(--color-ink-faint)]">
                <th scope="col" className="px-5 py-2 text-left font-medium">Category</th>
                {MONTH_ABBR.map((m) => (
                  <th key={m} scope="col" className="px-2 py-2 text-right font-medium">{m}</th>
                ))}
                <th scope="col" className="px-5 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {topCategories.map((c) => (
                <tr key={c.slug} className="border-b border-[var(--color-border)] last:border-0">
                  <th scope="row" className="max-w-[180px] truncate px-5 py-2 text-left font-normal">
                    {/* Scoped to the year in view, matching the row's total. */}
                    <Link
                      href={`/transactions?category=${encodeURIComponent(c.slug)}&from=${year}-01-01&to=${year}-12-31`}
                      className="inline-flex items-center gap-2 rounded hover:underline focus-visible:outline-none focus-visible:underline"
                      aria-label={`See the ${c.name} transactions for ${year}`}
                    >
                      <span aria-hidden className="inline-block size-2 shrink-0 rounded-full" style={{ background: c.color ?? "var(--color-ink-faint)" }} />
                      <span className="truncate">{c.name}</span>
                    </Link>
                  </th>
                  {c.monthlySpend.map((v, i) => (
                    <td key={i} className="figure px-2 py-2 text-right text-xs">
                      {v === 0 ? (
                        <span className="text-[var(--color-ink-faint)]">–</span>
                      ) : (
                        formatCents(v, { compact: true })
                      )}
                    </td>
                  ))}
                  <td className="figure px-5 py-2 text-right font-medium">{formatCents(c.totalSpendCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[var(--color-border-strong)]">
                <th scope="row" className="px-5 py-2.5 text-left">Total</th>
                {ledger.months.map((m) => (
                  <td key={m.month} className="figure px-2 py-2.5 text-right text-xs">
                    {formatCents(m.spendCents, { compact: true })}
                  </td>
                ))}
                <td className="figure px-5 py-2.5 text-right font-medium">
                  {formatCents(ledger.totals.spendCents)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </>
  );
}
