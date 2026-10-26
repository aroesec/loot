"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { expenseAction } from "@/app/budgets/planning-actions";
import type { expensePlanning } from "@/lib/planning";
import type { ExpensePlan } from "@/lib/planning/logic";
import { formatCents } from "@/lib/money";
type Planning = Awaited<ReturnType<typeof expensePlanning>>;
function ExpenseForm({
  plan,
  month,
  suggested = false,
}: {
  plan: ExpensePlan;
  month: string;
  suggested?: boolean;
}) {
  const [state, action, pending] = useActionState(expenseAction, {});
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
  return (
    <form
      action={action}
      onChange={() => setDirty(true)}
      className="mt-3 space-y-3"
    >
      <input type="hidden" name="accountId" value={plan.accountId} />
      <input type="hidden" name="categoryId" value={plan.categoryId} />
      <input type="hidden" name="merchant" value={plan.merchant} />
      <input type="hidden" name="month" value={month} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs">
          Bill name
          <input
            className="field mt-1"
            name="name"
            defaultValue={plan.name}
            required
            maxLength={100}
            autoComplete="off"
          />
        </label>
        <label className="text-xs">
          Expected monthly amount ($)
          <input
            className="field mt-1"
            name="amount"
            defaultValue={(plan.amountCents / 100).toFixed(2)}
            inputMode="decimal"
            autoComplete="off"
            required
            pattern="[0-9]+(\.[0-9]{1,2})?"
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          className="btn btn-primary"
          name="intent"
          value="approve"
          disabled={pending}
        >
          {pending
            ? "Saving…"
            : suggested || !plan.enabled
              ? "Approve monthly bill"
              : "Save bill"}
        </button>
        <button
          className="btn"
          name="intent"
          value="dismiss"
          disabled={pending}
        >
          {suggested ? "Not recurring" : "Exclude from forecast"}
        </button>
      </div>
      <p
        ref={feedback}
        tabIndex={-1}
        role={state.error ? "alert" : "status"}
        className="text-sm"
      >
        {state.error ?? state.message}
      </p>
    </form>
  );
}
export function ExpenseApprovals({
  planning,
  month,
  categories,
}: {
  planning: Planning;
  month: string;
  categories: Array<{ id: string; name: string }>;
}) {
  const categoryName = (id: string) =>
    categories.find((row) => row.id === id)?.name ?? "Spending";
  return (
    <section id="recurring-approvals" className="scroll-mt-6 space-y-5">
      <div>
        <h2 className="text-lg">
          Recurring bills to review{" "}
          <span className="text-[var(--color-ink-muted)]">
            ({planning.suggestions.length})
          </span>
        </h2>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Similar charges in two recent months are suggestions only. Approve
          each bill and adjust its amount before it enters your forecast. This
          does not schedule or pay anything.
        </p>
      </div>
      {planning.suggestions.length === 0 && (
        <p className="text-sm text-[var(--color-ink-muted)]">
          No new two-month repeats to review. Approved bills continue each
          month.
        </p>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        {planning.suggestions.map((plan) => (
          <article key={plan.key} className="card p-5">
            <h3 className="font-medium break-words">{plan.name}</h3>
            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
              {categoryName(plan.categoryId)} · {plan.accountName} · proposed
              monthly
            </p>
            <ul className="figure mt-3 space-y-1 text-sm">
              {plan.evidence.map((row) => (
                <li key={row.id}>
                  {row.postedOn}: {formatCents(-row.amountCents)}
                </li>
              ))}
            </ul>
            <ExpenseForm plan={plan} month={month} suggested />
          </article>
        ))}
      </div>
      <div>
        <h2 className="text-lg">Approved monthly bills</h2>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Counted within category budgets. A matching recorded payment replaces
          its estimate.
        </p>
      </div>
      {planning.approved.length === 0 && (
        <p className="text-sm text-[var(--color-ink-muted)]">
          Nothing approved yet. Your forecast contains no assumed recurring
          bills.
        </p>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        {planning.approved.map((plan) => (
          <article key={plan.key} className="card p-5">
            <div className="flex flex-wrap justify-between gap-2">
              <h3 className="font-medium">{plan.name}</h3>
              <span className="figure text-sm">
                {formatCents(plan.amountCents)}/month
              </span>
            </div>
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
              {categoryName(plan.categoryId)} · {plan.accountName} ·{" "}
              {plan.payments.length
                ? `${formatCents(plan.recordedCents)} recorded this month`
                : `${formatCents(plan.remainingCents)} still expected`}
            </p>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm">
                Edit or exclude
              </summary>
              <ExpenseForm plan={plan} month={month} />
            </details>
          </article>
        ))}
      </div>
      {planning.dismissed.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm">
            Excluded suggestions and bills ({planning.dismissed.length})
          </summary>
          <div className="mt-3 grid gap-4 xl:grid-cols-2">
            {planning.dismissed.map((plan) => (
              <article
                key={JSON.stringify([
                  plan.accountId,
                  plan.categoryId,
                  plan.merchant,
                ])}
                className="card p-5"
              >
                <h3>{plan.name}</h3>
                <ExpenseForm plan={plan} month={month} />
              </article>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
