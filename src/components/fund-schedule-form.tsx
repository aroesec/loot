"use client";
import { useActionState, useEffect, useState } from "react";
import { fundScheduleAction } from "@/app/budgets/planning-actions";
import type { FundSchedule } from "@/lib/planning/fund-schedule";
export function FundScheduleForm({
  fundId,
  name,
  month,
  schedule,
}: {
  fundId: string;
  name: string;
  month: string;
  schedule: FundSchedule | null;
}) {
  const [state, action, pending] = useActionState(fundScheduleAction, {});
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (state.message) setDirty(false);
  }, [state]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer">Weekly plan for {name}</summary>
      <form
        action={action}
        onChange={() => setDirty(true)}
        className="mt-3 space-y-3"
      >
        <input type="hidden" name="fundId" value={fundId} />
        <input type="hidden" name="month" value={month} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            Weekly amount ($)
            <input
              className="field mt-1"
              name="amount"
              inputMode="decimal"
              autoComplete="off"
              required
              aria-label={`${name} weekly amount`}
              defaultValue={
                schedule ? (schedule.amountCents / 100).toFixed(2) : ""
              }
            />
          </label>
          <label>
            Transfer day
            <select
              className="field mt-1"
              name="weekday"
              aria-label={`${name} transfer day`}
              defaultValue={schedule?.weekday ?? 2}
            >
              {[
                "Sunday",
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
              ].map((day, index) => (
                <option key={day} value={index}>
                  {day}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex gap-2">
          <input
            name="enabled"
            type="checkbox"
            defaultChecked={schedule?.enabled ?? true}
          />
          Include weekly transfers in the forecast
        </label>
        <p className="text-xs text-[var(--color-ink-muted)]">
          Applies from {month}. Matching transfers of this amount within three
          days replace scheduled occurrences. Extra deposits do not cancel
          future weekly transfers. This only changes your plan.
        </p>
        <button className="btn" disabled={pending}>
          {pending ? "Saving…" : `Save ${name} schedule`}
        </button>
        <p role={state.error ? "alert" : "status"}>
          {state.error ?? state.message}
        </p>
      </form>
    </details>
  );
}
