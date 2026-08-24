import Link from "next/link";
import { PeriodPicker } from "@/components/period-picker";
import { requireAuth } from "@/lib/auth";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import {
  budgetStatus,
  currentMonth,
  monthLabel,
  monthBounds,
  availableMonths,
  monthSummary,
} from "@/lib/ledger";
import { formatCents } from "@/lib/money";
import { PageHeader, Card, Bar, EmptyState } from "@/components/ui";
import { setBudgetAction } from "../actions";

export const dynamic = "force-dynamic";

const STATUS_COPY: Record<string, { label: string; className: string }> = {
  over: { label: "Over", className: "!border-[var(--color-negative)] !text-[var(--color-negative)]" },
  at_risk: { label: "Ahead of pace", className: "!border-[var(--color-warning)] !text-[var(--color-warning)]" },
  on_track: { label: "On track", className: "" },
  under: { label: "Under", className: "!border-[var(--color-positive)] !text-[var(--color-positive)]" },
};

export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  await requireAuth();
  const params = await searchParams;
  const months = await availableMonths();
  const month = params.month ?? months[0] ?? currentMonth();
  const bounds = monthBounds(month);

  const [status, budgetable, summary] = await Promise.all([
    budgetStatus(month),
    db
      .select({ id: categories.id, name: categories.name, slug: categories.slug })
      .from(categories)
      .where(and(eq(categories.budgetable, true), eq(categories.kind, "expense")))
      .orderBy(categories.sortOrder),
    monthSummary(month),
  ]);

  // Only leaf categories get budgets — a parent total would double-count.
  const allCats = await db
    .select({ id: categories.id, parentId: categories.parentId })
    .from(categories);
  const parentIds = new Set(
    allCats.map((c) => c.parentId).filter((v): v is string => Boolean(v)),
  );
  const assignable = budgetable.filter((c) => !parentIds.has(c.id));

  const budgeted = new Map(status.lines.map((l) => [l.categoryId, l]));
  const unbudgetedSpend = summary.byCategory
    .filter((c) => c.spendCents > 0 && c.categoryId && !budgeted.has(c.categoryId))
    .slice(0, 6);

  return (
    <>
      <PageHeader
        title="Budgets"
        subtitle={`${monthLabel(month)} · targets apply from the month you set them`}
        actions={
          months.length > 0 ? (
            <PeriodPicker
              name="month"
              value={month}
              label="Month"
              options={months.map((m) => ({ value: m, label: monthLabel(m) }))}
            />
          ) : undefined
        }
      />

      {status.lines.length > 0 ? (
        <>
          <div className="mb-4 grid gap-4 sm:grid-cols-3">
            <Card>
              <div className="text-xs uppercase tracking-wide text-[var(--color-ink-faint)]">Budgeted</div>
              <div className="figure mt-2 text-2xl">{formatCents(status.totalBudgetCents)}</div>
            </Card>
            <Card>
              <div className="text-xs uppercase tracking-wide text-[var(--color-ink-faint)]">Spent</div>
              <div className="figure mt-2 text-2xl">{formatCents(status.totalSpentCents)}</div>
            </Card>
            <Card>
              <div className="text-xs uppercase tracking-wide text-[var(--color-ink-faint)]">Remaining</div>
              <div className={`figure mt-2 text-2xl ${status.totalBudgetCents - status.totalSpentCents < 0 ? "text-negative" : "text-positive"}`}>
                {formatCents(status.totalBudgetCents - status.totalSpentCents, { signed: true })}
              </div>
            </Card>
          </div>

          <Card className="!p-0">
            <ul className="divide-y divide-[var(--color-border)]">
              {status.lines.map((line) => {
                const copy = STATUS_COPY[line.status] ?? STATUS_COPY.on_track!;
                return (
                  <li key={line.slug} className="px-5 py-4">
                    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                      <Link
                        href={`/transactions?category=${encodeURIComponent(line.slug)}&from=${bounds.start}&to=${bounds.end}`}
                        className="font-medium hover:underline focus-visible:underline focus-visible:outline-none"
                        aria-label={`See the ${line.name} transactions behind ${formatCents(line.spentCents)}`}
                      >
                        {line.name}
                      </Link>
                      <span className="flex items-center gap-2">
                        <span className={`chip ${copy.className}`}>{copy.label}</span>
                        <span className="figure text-sm">
                          {formatCents(line.spentCents)}
                          <span className="text-[var(--color-ink-faint)]"> / {formatCents(line.budgetCents)}</span>
                        </span>
                      </span>
                    </div>
                    <Bar fraction={line.usedFraction} over={line.status === "over"} color={line.color} />
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--color-ink-muted)]">
                      <span>
                        {line.remainingCents >= 0
                          ? `${formatCents(line.remainingCents)} left`
                          : `${formatCents(-line.remainingCents)} over`}
                        {line.paceRatio !== null
                          ? ` · ${line.paceRatio > 1 ? "spending faster than" : "tracking below"} the calendar`
                          : ""}
                      </span>
                      <form action={setBudgetAction} className="flex items-center gap-2">
                        <input type="hidden" name="categoryId" value={line.categoryId} />
                        <label htmlFor={`b-${line.slug}`} className="sr-only">
                          {line.name} budget
                        </label>
                        <input
                          id={`b-${line.slug}`}
                          name="amount"
                          type="number"
                          step="1"
                          min="0"
                          defaultValue={(line.budgetCents / 100).toFixed(0)}
                          className="field !w-24 !py-1 text-sm"
                        />
                        <button type="submit" className="btn !py-1">Save</button>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        </>
      ) : (
        <EmptyState title="No budgets set">
          Pick a category below and give it a monthly target. Budgets take
          effect from the current month, so past months keep the target they
          had at the time.
        </EmptyState>
      )}

      {unbudgetedSpend.length > 0 ? (
        <Card className="mt-4">
          <h2 className="mb-1 text-lg">Spending without a budget</h2>
          <p className="mb-3 text-sm text-[var(--color-ink-muted)]">
            These categories had activity in {monthLabel(month)} but no target.
          </p>
          <ul className="divide-y divide-[var(--color-border)]">
            {unbudgetedSpend.map((c) => (
              <li key={c.slug} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                <Link
                  href={`/transactions?category=${encodeURIComponent(c.slug)}&from=${bounds.start}&to=${bounds.end}`}
                  className="hover:underline focus-visible:underline focus-visible:outline-none"
                  aria-label={`See the ${c.name} transactions behind ${formatCents(c.spendCents)}`}
                >
                  {c.name}
                </Link>
                <span className="flex items-center gap-3">
                  <span className="figure text-[var(--color-ink-muted)]">{formatCents(c.spendCents)}</span>
                  <form action={setBudgetAction} className="flex items-center gap-2">
                    <input type="hidden" name="categoryId" value={c.categoryId!} />
                    <label htmlFor={`n-${c.slug}`} className="sr-only">Budget for {c.name}</label>
                    <input
                      id={`n-${c.slug}`}
                      name="amount"
                      type="number"
                      step="1"
                      min="0"
                      placeholder={(c.spendCents / 100).toFixed(0)}
                      className="field !w-24 !py-1 text-sm"
                    />
                    <button type="submit" className="btn !py-1">Set</button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="mt-4">
        <h2 className="mb-3 text-lg">Add a budget</h2>
        <form action={setBudgetAction} className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1">
            <label htmlFor="new-cat" className="mb-1 block text-xs font-medium">Category</label>
            <select id="new-cat" name="categoryId" className="field">
              {assignable.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="new-amt" className="mb-1 block text-xs font-medium">Monthly target</label>
            <input id="new-amt" name="amount" type="number" step="1" min="0" placeholder="400" className="field !w-32" />
          </div>
          <button type="submit" className="btn btn-primary">Add</button>
        </form>
      </Card>
    </>
  );
}
