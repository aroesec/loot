import Link from "next/link";
import { Card, Stat } from "@/components/ui";
import { formatCents } from "@/lib/money";
import type { projectIncome } from "@/lib/income/logic";
export function IncomeSummary({ projection, spendCents, contributionCents, plannedSpendCents }: { projection: ReturnType<typeof projectIncome>; spendCents: number; contributionCents: number; plannedSpendCents?: number }) {
  const left = projection.projectedIncomeCents === null ? null : projection.projectedIncomeCents - (plannedSpendCents ?? spendCents) - contributionCents;
  return <Card className="mb-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg">Monthly income plan</h2><Link href="/settings#income-plan" className="btn">Manage income</Link></div>
    {projection.ambiguousCount > 0 ? <p role="alert" className="mt-3 text-sm">A deposit matches more than one source. Update the descriptions in Settings to see a reliable forecast.</p> : <div className="mt-4 grid gap-4 sm:grid-cols-3">
      <Stat label="Projected monthly income" value={formatCents(projection.projectedIncomeCents ?? 0)} detail={`${formatCents(projection.receivedIncomeCents)} received + ${formatCents(projection.remainingCents)} expected`} />
      <Stat label="Still expected" value={formatCents(projection.remainingCents)} detail="Payments not yet received" />
      <Stat label="Left after planned spending" value={formatCents(left ?? 0)} tone={(left ?? 0) < 0 ? "negative" : "positive"} detail="After category budgets, spending, approved bills, and recorded fund contributions" />
    </div>}
    <p className="mt-3 text-sm"><Link className="underline underline-offset-4" href="/budgets">Review category budgets and approve upcoming bills →</Link></p>
    <ul className="mt-4 divide-y divide-[var(--color-border)]">{projection.sources.map((source) => <li key={source.sourceId} className="py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-medium break-words">{source.name}</h3><span className="figure text-sm">{source.receivedCount} of {source.paymentsPerMonth} received</span></div>
      <progress className="mt-2 h-2 w-full accent-[var(--color-accent)]" max={source.paymentsPerMonth} value={source.receivedCount} aria-label={`${source.name} payments received`} />
      <p className="mt-2 text-sm text-[var(--color-ink-muted)]">{source.paymentsPerMonth} × {formatCents(source.amountCents)} planned · {formatCents(source.remainingCents)} still expected{source.extraCount > 0 ? ` · ${source.extraCount} additional deposit(s) received` : ""}</p>
      {source.payments.length > 0 && <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--color-ink-muted)]">{source.payments.map((payment) => <li key={payment.id}>{payment.postedOn}: {formatCents(payment.amountCents)} received</li>)}</ul>}
    </li>)}</ul>
    <p className="text-xs text-[var(--color-ink-muted)]">This is a monthly forecast, not your bank balance. Only approved recurring bills and saved category budgets are included for future expenses. Receipt progress updates when deposits are imported or recorded.</p>
  </Card>;
}
