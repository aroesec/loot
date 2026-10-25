"use client";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { budgetAction } from "@/app/budgets/planning-actions";
import { budgetAlert } from "@/lib/planning/logic";
import type { budgetPlanning } from "@/lib/planning";
import { formatCents } from "@/lib/money";
import { monthBounds } from "@/lib/dates";
import { ROLLOVER_MODES } from "@/lib/budget-rollover";
import { Bar } from "@/components/ui";
type Plan = Awaited<ReturnType<typeof budgetPlanning>>;
function BudgetRow({
  line,
  month,
  total,
}: {
  line: Plan["lines"][number];
  month: string;
  total: number;
}) {
  const [state, action, pending] = useActionState(budgetAction, {});
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const feedback = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.error) feedback.current?.focus();
    else if (state.message) setDirty(false);
  }, [state]);
  const alert = budgetAlert({
    spentCents: line.spentCents,
    availableCents: line.availableCents,
    hasBudget: line.budgetCents > 0,
  });
  const bounds = monthBounds(month);
  return (
    <li
      className="px-5 py-5"
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 190px" }}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Link
              className="font-medium hover:underline"
              href={`/transactions?category=${encodeURIComponent(line.slug)}&from=${bounds.start}&to=${bounds.end}`}
            >
              {line.name}
            </Link>
            <span
              className={`text-xs ${alert === "Over budget" ? "text-[var(--color-negative)]" : alert === "Approaching the limit" || alert === "At the limit" ? "text-[var(--color-warning)]" : "text-[var(--color-ink-muted)]"}`}
            >
              {alert}
            </span>
          </div>
          <p className="figure mt-2 text-sm">
            {formatCents(line.spentCents)} spent
            {line.budgetCents > 0
              ? ` of ${formatCents(line.availableCents)} this month`
              : " this month · no budget set"}
          </p>
          <div className="mt-2">
            <Bar
              fraction={
                line.availableCents > 0
                  ? line.spentCents / line.availableCents
                  : 0
              }
              over={
                line.spentCents > line.availableCents && line.budgetCents > 0
              }
            />
          </div>
          <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
            {total > 0
              ? `${((line.budgetCents / total) * 100).toFixed(1)}% of allocated budget`
              : "Not allocated yet"}
            {line.recurringCents > 0
              ? ` · ${formatCents(line.recurringCents)} in approved monthly bills`
              : ""}
            {line.carriedCents
              ? ` · ${formatCents(line.carriedCents)} carried in`
              : ""}
          </p>
          {line.recurringCents > line.budgetCents && line.budgetCents > 0 && (
            <p className="mt-1 text-xs text-[var(--color-warning)]">
              Approved bills exceed this category’s budget.
            </p>
          )}
        </div>
        <form
          action={action}
          onChange={() => setDirty(true)}
          className="min-w-0"
        >
          <input type="hidden" name="categoryId" value={line.id} />
          <input type="hidden" name="month" value={month} />
          <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1 text-xs">
              Monthly budget ($)
              <input
                aria-label={`${line.name} monthly budget`}
                name="amount"
                className="field mt-1"
                inputMode="decimal"
                autoComplete="off"
                required
                pattern="[0-9]+(\.[0-9]{1,2})?"
                defaultValue={(line.budgetCents / 100).toFixed(2)}
              />
            </label>
            <button
              className="btn"
              disabled={pending}
              aria-label={`Save ${line.name} budget`}
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
          <label className="mt-2 block text-xs text-[var(--color-ink-muted)]">
            Rollover
            <select
              name="rollover"
              className="field mt-1 !py-1 text-xs"
              defaultValue={line.rollover}
              aria-label={`${line.name} rollover`}
            >
              {ROLLOVER_MODES.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
          </label>
          <p
            ref={feedback}
            tabIndex={-1}
            role={state.error ? "alert" : "status"}
            className="mt-1 text-xs"
          >
            {state.error ?? state.message}
          </p>
        </form>
      </div>
    </li>
  );
}
export function BudgetPlanner({ plan, month }: { plan: Plan; month: string }) {
  const groups = [...new Set(plan.lines.map((line) => line.group))];
  return (
    <section className="card overflow-hidden">
      <div className="border-b border-[var(--color-border)] p-5">
        <h2 className="text-lg">All spending categories</h2>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Set each monthly allocation below. Changes apply from {month} onward;
          enter 0 to leave a category unbudgeted. Alerts begin at 75% of the
          available budget.
        </p>
      </div>
      {groups.map((group) => (
        <section key={group} aria-label={group}>
          <h3 className="border-y border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-5 py-2 text-xs font-medium uppercase tracking-wide">
            {group}
          </h3>
          <ul className="divide-y divide-[var(--color-border)]">
            {plan.lines
              .filter((line) => line.group === group)
              .map((line) => (
                <BudgetRow
                  key={`${line.id}-${month}`}
                  line={line}
                  month={month}
                  total={plan.budgetCents}
                />
              ))}
          </ul>
        </section>
      ))}
      {plan.otherSpentCents > 0 && (
        <p className="border-t border-[var(--color-border)] p-5 text-sm">
          Other recorded spending: {formatCents(plan.otherSpentCents)}. Review
          uncategorized or parent-category transactions to allocate this
          spending.
        </p>
      )}
      <footer className="border-t-2 border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-5">
        <h3 className="font-medium">Total across all categories</h3>
        <dl className="mt-3 grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-[var(--color-ink-muted)]">
              Monthly budget allocated
            </dt>
            <dd className="figure mt-1 text-xl">
              {formatCents(plan.budgetCents)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-ink-muted)]">
              Spent this month
            </dt>
            <dd className="figure mt-1 text-xl">
              {formatCents(plan.spentCents)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-ink-muted)]">
              Budget available, including rollover
            </dt>
            <dd className="figure mt-1 text-xl">
              {formatCents(plan.availableCents)}
            </dd>
          </div>
        </dl>
      </footer>
    </section>
  );
}
