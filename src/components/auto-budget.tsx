"use client";
import { useActionState } from "react";
import { populateAction } from "@/app/budgets/planning-actions";
export function AutoBudget({ month }: { month: string }) {
  const [state, action, pending] = useActionState(populateAction, {});
  return (
    <form action={action} className="mt-4">
      <input type="hidden" name="month" value={month} />
      <button className="btn btn-primary" disabled={pending}>
        {pending ? "Building budgets…" : "Budget detected recurring bills"}
      </button>
      <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
        Include detected monthly bills and fill unset expense budgets from their
        amounts. Your existing budgets and excluded bills stay unchanged.
      </p>
      <p role={state.error ? "alert" : "status"} className="mt-2 text-sm">
        {state.error ?? state.message}
      </p>
    </form>
  );
}
