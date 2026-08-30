import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import {
  bufferStatus,
  irregularCategories,
  savingsChurn,
  recentFlows,
  categoryMedians,
} from "@/lib/buffer";
import { compare } from "@/lib/benchmarks";
import { household } from "@/lib/mode";
import { availableMonths, currentMonth } from "@/lib/ledger";
import { formatCents } from "@/lib/money";
import { PageHeader, Card, Stat, EmptyState, Bar } from "@/components/ui";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { isNull } from "drizzle-orm";
import { netWorth, coverageNote } from "@/lib/net-worth";

export const dynamic = "force-dynamic";

/**
 * The cushion, and what it would take to have one.
 *
 * Everything on this page is arithmetic on the person's own history. A generic
 * "keep three months of expenses" is advice; "a normal month costs you $X, you
 * have $Y, that is Z weeks" is a measurement. Only the second belongs here.
 */
export default async function GoalsPage() {
  await requireAuth();

  const months = await availableMonths();
  const through = months[0] ?? currentMonth();

  const balanceRows = await db
    .select({ kind: accounts.kind, balanceCents: accounts.balanceCents })
    .from(accounts)
    .where(isNull(accounts.archivedAt));
  const worth = netWorth(balanceRows);
  const note = coverageNote(worth);

  const [buffer, flows, irregular, churn, medians, home] = await Promise.all([
    bufferStatus(through, 3),
    recentFlows(through, 6),
    irregularCategories(through, 6),
    savingsChurn(through, 6),
    categoryMedians(through, 6),
    household(),
  ]);

  const comparisons = compare(medians, home).filter((c) => c.ratio > 1.15);

  if (flows.length === 0) {
    return (
      <>
        <PageHeader title="Buffer & goals" />
        <EmptyState title="Not enough complete months yet">
          This needs at least one calendar month covered end to end. Import more
          history and it fills in.{" "}
          <Link href="/upload" className="text-[var(--color-accent)] underline underline-offset-4">
            Import a statement
          </Link>
          .
        </EmptyState>
      </>
    );
  }

  const weeks =
    buffer.monthsCovered === null ? null : buffer.monthsCovered * 4.345;

  return (
    <>
      <PageHeader
        title="Buffer & goals"
        subtitle={`Measured over ${flows.length} complete month${flows.length === 1 ? "" : "s"}`}
      />

      <Card className="mb-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg">Net worth</h2>
          <span className="figure text-2xl">
            {worth.unknown ? "Unknown" : formatCents(worth.netCents, { signed: true })}
          </span>
        </div>
        {worth.unknown ? null : (
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            {formatCents(worth.assetsCents)} owned less{" "}
            {formatCents(worth.liabilitiesCents)} owed, across{" "}
            {worth.accountsKnown} account{worth.accountsKnown === 1 ? "" : "s"}.
            Investments count here; the cash buffer below deliberately leaves
            them out.
          </p>
        )}
        {/*
          Coverage stated plainly rather than left to be inferred from a number
          that looks complete. An account with no balance is unknown, not
          empty — a linked current account beside an unlinked mortgage would
          otherwise read as a healthy net worth that is wrong by a house.
        */}
        {note ? (
          <p className="mt-2 text-sm text-[var(--color-ink-muted)]">{note}</p>
        ) : null}
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Liquid cash"
          value={
            buffer.liquidCents === null
              ? "Unknown"
              : formatCents(buffer.liquidCents)
          }
          tone={
            buffer.liquidCents !== null && buffer.liquidCents < 0
              ? "negative"
              : undefined
          }
          detail="Checking and savings, less card balances"
        />
        <Stat
          label="A normal month"
          value={formatCents(buffer.baselineMonthlyCents)}
          detail={`Median of ${buffer.monthsOfData} month${buffer.monthsOfData === 1 ? "" : "s"}`}
        />
        <Stat
          label="That covers"
          value={
            weeks === null
              ? "—"
              : weeks < 8
                ? `${weeks.toFixed(1)} weeks`
                : `${buffer.monthsCovered!.toFixed(1)} months`
          }
          tone={
            buffer.monthsCovered !== null && buffer.monthsCovered < 1
              ? "negative"
              : undefined
          }
          detail="If income stopped today"
        />
        <Stat
          label={`${buffer.targetMonths}-month buffer`}
          value={formatCents(buffer.targetCents)}
          detail={
            buffer.shortfallCents === null
              ? undefined
              : `${formatCents(buffer.shortfallCents)} to go`
          }
        />
      </div>

      {buffer.balancesUnknown ? (
        <Card className="mt-4">
          <p className="text-sm">
            No account has reported a balance, so the cushion cannot be
            measured. Connect a bank in{" "}
            <Link href="/settings" className="underline underline-offset-4">
              Settings
            </Link>{" "}
            and balances refresh on each sync.
          </p>
        </Card>
      ) : null}

      {churn ? (
        <Card className="mt-4 border-[var(--color-warning)] bg-[var(--color-warning-soft)]">
          <h2 className="text-lg">Saving and withdrawing at the same time</h2>
          <p className="mt-1 text-sm">
            Over {churn.months} months you moved{" "}
            <span className="figure">{formatCents(churn.savedCents)}</span> into
            savings and took{" "}
            <span className="figure">{formatCents(churn.withdrawnCents)}</span>{" "}
            back out — a net change of{" "}
            <span className="figure">
              {formatCents(churn.netCents, { signed: true })}
            </span>
            .
          </p>
          <p className="mt-2 text-sm">
            Regular contributions look like progress in any single month, which
            is what makes this worth naming: the withdrawals only show up when
            several months are added together.
          </p>
        </Card>
      ) : null}

      <Card className="mt-4">
        <h2 className="text-lg">Month by month</h2>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Earnings against ordinary consumption — excluding savings
          contributions, card payments and internal transfers, none of which are
          spending.
        </p>
        <ul className="mt-3 space-y-3">
          {flows.map((f) => {
            const max = Math.max(f.earnedCents, f.consumptionCents, 1);
            return (
              <li key={f.month}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                  <span>{f.month}</span>
                  <span
                    className={`figure ${f.netCents < 0 ? "text-[var(--color-negative)]" : "text-[var(--color-positive)]"}`}
                  >
                    {formatCents(f.netCents, { signed: true })}
                  </span>
                </div>
                <div className="space-y-1">
                  <Bar fraction={f.earnedCents / max} />
                  <Bar fraction={f.consumptionCents / max} over />
                </div>
                <div className="mt-1 flex justify-between text-xs text-[var(--color-ink-muted)]">
                  <span>earned {formatCents(f.earnedCents)}</span>
                  <span>spent {formatCents(f.consumptionCents)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card className="mt-4">
        <h2 className="text-lg">Money that arrives in lumps</h2>
        {irregular.length === 0 ? (
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            Not enough complete months to tell a lumpy expense from a regular
            one — that needs three, and there {flows.length === 1 ? "is" : "are"}{" "}
            {flows.length}. Saying nothing is better than recommending a fund
            for the rent.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
              These did not arrive evenly. Setting the monthly amount aside
              would have covered them without touching anything else.
            </p>
            <ul className="mt-3 divide-y divide-[var(--color-border)]">
              {irregular.map((i) => (
                <li key={i.slug} className="flex flex-wrap items-baseline justify-between gap-3 py-2 text-sm">
                  <span>
                    <Link
                      href={`/transactions?category=${encodeURIComponent(i.slug)}`}
                      className="hover:underline"
                    >
                      {i.name}
                    </Link>
                    <span className="ml-2 text-xs text-[var(--color-ink-muted)]">
                      {formatCents(i.totalCents)} across {i.monthsActive} of{" "}
                      {i.monthsObserved} months, biggest{" "}
                      {formatCents(i.largestMonthCents)}
                    </span>
                  </span>
                  <span className="figure">
                    {formatCents(i.suggestedMonthlyCents)}/mo
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card className="mt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg">Compared with published averages</h2>
          <span className="text-xs text-[var(--color-ink-muted)]">
            {home.adults} adult{home.adults === 1 ? "" : "s"}
            {home.children ? `, ${home.children} child${home.children === 1 ? "" : "ren"}` : ""}
            {" · "}
            <Link href="/settings" className="underline underline-offset-4">
              change
            </Link>
          </span>
        </div>

        {comparisons.length === 0 ? (
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            Nothing sits meaningfully above the published averages for a
            household this size.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
              Your median month against federal survey figures, scaled for
              household size. Reference points, not targets — region alone moves
              several of these a long way.
            </p>
            <ul className="mt-3 space-y-3">
              {comparisons.slice(0, 8).map((c) => (
                <li key={c.categorySlug}>
                  <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                    <Link
                      href={`/transactions?category=${encodeURIComponent(c.categorySlug)}`}
                      className="hover:underline"
                    >
                      {c.categoryName}
                    </Link>
                    <span className="figure">
                      {formatCents(c.actualCents)}
                      <span className="text-[var(--color-ink-muted)]">
                        {" "}vs {formatCents(c.benchmark.monthlyCents)}
                      </span>
                    </span>
                  </div>
                  <Bar fraction={Math.min(1, 1 / c.ratio)} />
                  <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                    {(c.ratio).toFixed(1)}× the average — {formatCents(c.overCents)}/mo
                    above. {c.benchmark.source} ({c.benchmark.asOf}).
                    {c.benchmark.note ? ` ${c.benchmark.note}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <p className="mt-4 text-xs text-[var(--color-ink-muted)]">
        These are measurements of your own history, not financial advice. The
        three-month figure is a common rule of thumb rather than a
        recommendation for your situation. The published averages are means
        rather than medians, are national rather than regional, and go stale —
        check them against the current releases before leaning on them.
      </p>
    </>
  );
}
