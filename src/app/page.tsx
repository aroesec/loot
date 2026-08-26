import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import {
  monthSummary,
  budgetStatus,
  categoryTrends,
  availableMonths,
  currentMonth,
  monthLabel,
  monthBounds,
  shiftMonth,
} from "@/lib/ledger";
import { formatCents } from "@/lib/money";
import { db } from "@/db";
import { transactions, recurringSeries } from "@/db/schema";
import { sql, eq, and, ne, desc } from "drizzle-orm";
import { Card, Stat, Money, PageHeader, EmptyState, Bar } from "@/components/ui";
import { PeriodPicker } from "@/components/period-picker";
import { REVIEW_THRESHOLD } from "@/lib/classify";
import { ledgerMode, vocabulary } from "@/lib/mode";
import { unreconciledByIssuer } from "@/lib/reconcile/debt";

export const dynamic = "force-dynamic";

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  await requireAuth();

  /*
   * First run goes to the setup questions instead of an empty dashboard.
   *
   * Checked here rather than in middleware, which runs on the edge and cannot
   * reach the database, and in the layout, which also renders /welcome itself
   * and would redirect into a loop.
   */
  const { onboardingState } = await import("@/lib/onboarding");
  if ((await onboardingState()).needed) redirect("/welcome");

  const params = await searchParams;
  const months = await availableMonths();
  const month = params.month ?? months[0] ?? currentMonth();

  const [summary, budgets, trends, reviewCount, activeSubs, recent] =
    await Promise.all([
      monthSummary(month),
      budgetStatus(month),
      categoryTrends(month, 3),
      db
        .select({ count: sql<string>`count(*)` })
        .from(transactions)
        .where(
          and(
            sql`${transactions.classificationConfidence} < ${REVIEW_THRESHOLD}`,
            ne(transactions.classificationSource, "manual"),
          ),
        ),
      db
        .select({
          count: sql<string>`count(*)`,
          annual: sql<string>`COALESCE(SUM(${recurringSeries.annualizedCents}), 0)`,
        })
        .from(recurringSeries)
        .where(eq(recurringSeries.status, "active")),
      db
        .select({
          id: transactions.id,
          postedOn: transactions.postedOn,
          merchant: transactions.merchant,
          rawDescription: transactions.rawDescription,
          amountCents: transactions.amountCents,
        })
        .from(transactions)
        .orderBy(desc(transactions.postedOn), desc(transactions.createdAt))
        .limit(8),
    ]);

  if (months.length === 0) {
    return (
      <>
        <PageHeader title="Overview" />
        <EmptyState title="Nothing here yet">
          Import a statement to get started — a CSV export from your bank, or a
          PDF statement. Everything else on this page builds itself from there.
          <div className="mt-4">
            <Link href="/upload" className="btn btn-primary">
              Import a statement
            </Link>
          </div>
        </EmptyState>
      </>
    );
  }

  const needsReview = Number(reviewCount[0]?.count ?? 0);
  const subCount = Number(activeSubs[0]?.count ?? 0);
  const subAnnual = Number(activeSubs[0]?.annual ?? 0);
  const prior = months.indexOf(month) + 1;
  const priorMonth = months[prior] ?? shiftMonth(month, -1);
  const priorSummary = await monthSummary(priorMonth);
  const spendDelta = summary.spendCents - priorSummary.spendCents;

  const topSpend = summary.byCategory.filter((c) => c.spendCents > 0).slice(0, 8);
  const maxSpend = topSpend[0]?.spendCents ?? 1;
  const bounds = monthBounds(month);
  // A business has no savings rate and a person has no net margin. Showing
  // the wrong word invites reading a number that does not mean what it says.
  const words = vocabulary(await ledgerMode());
  // Surfaced here rather than only on /cards: a card nobody has linked is the
  // largest silent gap a ledger can have, and it will not be found by someone
  // who does not already suspect it.
  const unreconciled = await unreconciledByIssuer();

  return (
    <>
      <PageHeader
        title={monthLabel(month)}
        subtitle={`${summary.transactionCount} transactions, excluding transfers`}
        actions={
          <PeriodPicker
            name="month"
            value={month}
            label="Month"
            options={months.map((m) => ({ value: m, label: monthLabel(m) }))}
          />
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label={words.income}
          value={formatCents(summary.incomeCents)}
          tone="positive"
        />
        <Stat
          label={words.spending}
          value={formatCents(summary.spendCents)}
          tone="negative"
          detail={
            priorSummary.spendCents > 0 ? (
              <>
                {spendDelta >= 0 ? "▲" : "▼"} {formatCents(Math.abs(spendDelta))}{" "}
                vs {monthLabel(priorMonth).split(" ")[0]}
              </>
            ) : null
          }
        />
        <Stat
          label={words.net}
          value={formatCents(summary.netCents, { signed: true })}
          tone={summary.netCents >= 0 ? "positive" : "negative"}
        />
        <Stat
          label={words.ratio}
          value={
            summary.savingsRate === null
              ? "—"
              : `${(summary.savingsRate * 100).toFixed(0)}%`
          }
          detail={
            summary.savingsRate === null
              ? "No income recorded this month"
              : "Share of income you kept"
          }
        />
      </div>

      {unreconciled.length > 0 ? (
        <Card className="mt-4 border-[var(--color-warning)] bg-[var(--color-warning-soft)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              <strong>
                {unreconciled.map((c) => c.issuer).join(", ")}
              </strong>{" "}
              {unreconciled.length === 1 ? "is" : "are"} not linked, so{" "}
              {unreconciled.length === 1 ? "its" : "their"} purchases are not in
              your totals.{" "}
              {formatCents(
                unreconciled.reduce((a, c) => a + c.paymentsCents, 0),
              )}{" "}
              of payments {unreconciled.length === 1 ? "is" : "are"} counted as
              debt instead — real money, but no idea what it bought.
            </p>
            <Link href="/cards" className="btn">
              Fix this
            </Link>
          </div>
        </Card>
      ) : null}

      {needsReview > 0 ? (
        <Card className="mt-4 border-[var(--color-warning)] bg-[var(--color-warning-soft)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              <strong>{needsReview}</strong>{" "}
              {needsReview === 1 ? "transaction was" : "transactions were"}{" "}
              categorized with low confidence. Confirming them teaches the rules.
            </p>
            <Link href="/transactions?review=1" className="btn">
              Review
            </Link>
          </div>
        </Card>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-4 text-lg">Where it went</h2>
          {topSpend.length === 0 ? (
            <p className="text-sm text-[var(--color-ink-muted)]">
              No spending recorded this month.
            </p>
          ) : (
            <ul className="space-y-3">
              {topSpend.map((c) => (
                <li key={c.slug}>
                  {/*
                    Scoped to the month being viewed, so the figure on the bar
                    and the rows the link lands on are the same money.
                  */}
                  <Link
                    href={`/transactions?category=${encodeURIComponent(c.slug)}&from=${bounds.start}&to=${bounds.end}`}
                    className="-mx-2 block rounded px-2 py-1 transition-colors hover:bg-[var(--color-bg-subtle)] focus-visible:bg-[var(--color-bg-subtle)] focus-visible:outline-none"
                    aria-label={`See the ${c.name} transactions behind ${formatCents(c.spendCents)}`}
                  >
                    <div className="mb-1 flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm">
                        {c.name}
                        {c.parentName ? (
                          <span className="ml-1.5 text-xs text-[var(--color-ink-faint)]">
                            {c.parentName}
                          </span>
                        ) : null}
                      </span>
                      <span className="figure shrink-0 text-sm">
                        {formatCents(c.spendCents)}
                      </span>
                    </div>
                    <Bar fraction={c.spendCents / maxSpend} color={c.color} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <h2 className="mb-3 text-lg">Recurring</h2>
            {subCount === 0 ? (
              <p className="text-sm text-[var(--color-ink-muted)]">
                No subscriptions detected yet. Three or more regular charges
                from the same merchant will show up here.
              </p>
            ) : (
              <>
                <p className="figure text-2xl">{formatCents(subAnnual)}</p>
                <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                  a year across {subCount} active{" "}
                  {subCount === 1 ? "subscription" : "subscriptions"}
                </p>
                <Link
                  href="/recurring"
                  className="mt-3 inline-block text-sm text-[var(--color-accent)] underline underline-offset-4"
                >
                  See them all
                </Link>
              </>
            )}
          </Card>

          {budgets.lines.length > 0 ? (
            <Card>
              <h2 className="mb-3 text-lg">Budgets</h2>
              <ul className="space-y-2.5">
                {budgets.lines.slice(0, 5).map((b) => (
                  <li key={b.slug}>
                    <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate">{b.name}</span>
                      <span className="figure shrink-0 text-xs text-[var(--color-ink-muted)]">
                        {formatCents(b.spentCents)} / {formatCents(b.budgetCents)}
                      </span>
                    </div>
                    <Bar
                      fraction={b.usedFraction}
                      over={b.status === "over"}
                      color={b.color}
                    />
                  </li>
                ))}
              </ul>
              <Link
                href="/budgets"
                className="mt-3 inline-block text-sm text-[var(--color-accent)] underline underline-offset-4"
              >
                Manage budgets
              </Link>
            </Card>
          ) : null}
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-lg">Biggest changes</h2>
          {trends.length === 0 ? (
            <p className="text-sm text-[var(--color-ink-muted)]">
              Not enough history yet to compare months.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {trends.slice(0, 6).map((t) => (
                <li
                  key={t.slug}
                  className="flex items-baseline justify-between gap-3 py-2 text-sm first:pt-0"
                >
                  <span className="truncate">{t.name}</span>
                  <span className="flex shrink-0 items-baseline gap-2">
                    <span className="figure text-xs text-[var(--color-ink-muted)]">
                      {formatCents(t.averageCents)} avg
                    </span>
                    <Money cents={-t.deltaCents} signed className="text-sm" />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-lg">Latest</h2>
          <ul className="divide-y divide-[var(--color-border)]">
            {recent.map((t) => (
              <li
                key={t.id}
                className="flex items-baseline justify-between gap-3 py-2 text-sm first:pt-0"
              >
                <span className="min-w-0">
                  <span className="block truncate">
                    {t.merchant ?? t.rawDescription}
                  </span>
                  <span className="figure text-xs text-[var(--color-ink-faint)]">
                    {t.postedOn}
                  </span>
                </span>
                <Money cents={t.amountCents} className="shrink-0 text-sm" />
              </li>
            ))}
          </ul>
          <Link
            href="/transactions"
            className="mt-3 inline-block text-sm text-[var(--color-accent)] underline underline-offset-4"
          >
            All transactions
          </Link>
        </Card>
      </div>
    </>
  );
}
