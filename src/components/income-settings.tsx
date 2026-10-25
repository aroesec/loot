"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { saveIncomeAction } from "@/app/settings/income-actions";
import type { IncomePlan } from "@/lib/income/logic";
import { formatCents } from "@/lib/money";

type Account = { id: string; name: string; kind: string; currency: string };
type Paycheck = { id: string; name: string | null; pattern: string; accountId: string; amountCents: number; postedOn: string };
function IncomeForm({ plan, accounts, month }: { plan: IncomePlan; accounts: Account[]; month: string }) {
  const [state, action, pending] = useActionState(saveIncomeAction, {});
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const feedback = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (state.error) feedback.current?.focus(); else if (state.message) setDirty(false); }, [state]);
  return <form action={action} onChange={() => setDirty(true)} className="mt-4 space-y-4 border-t border-[var(--color-border)] pt-4">
    <input type="hidden" name="sourceId" value={plan.sourceId} />
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <label className="text-sm">Income source<input className="field mt-1 w-full" name="name" required maxLength={80} defaultValue={plan.name} autoComplete="off" /></label>
      <label className="text-sm">Deposit account<select className="field mt-1 w-full" name="accountId" defaultValue={plan.accountId} required>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
      <label className="text-sm">Take-home per payment ($)<input className="field mt-1 w-full" name="amount" inputMode="decimal" required pattern="[0-9]+(\.[0-9]{1,2})?" defaultValue={(plan.amountCents / 100).toFixed(2)} autoComplete="off" /></label>
      <label className="text-sm">Payments each month<input className="field mt-1 w-full" name="paymentsPerMonth" type="number" min={1} max={12} step={1} required defaultValue={plan.paymentsPerMonth} /></label>
      <label className="text-sm">Apply from month<input className="field mt-1 w-full" name="effectiveMonth" type="month" required defaultValue={month} /></label>
      <label className="text-sm">Deposit description contains<input className="field mt-1 w-full" name="pattern" required minLength={4} maxLength={200} defaultValue={plan.pattern} autoComplete="off" /></label>
    </div>
    <p className="text-xs text-[var(--color-ink-muted)]">Use a distinctive payroll description. Only cleared deposits into this account mark a payment received. Changes apply from the selected month onward.</p>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={plan.enabled} />Include in monthly plan</label>
      <button className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : "Save income source"}</button>
    </div>
    <p ref={feedback} tabIndex={-1} role={state.error ? "alert" : "status"} className="text-sm">{state.error ?? state.message}</p>
  </form>;
}
export function IncomeSettings({ plans, paychecks, accounts, month, newSourceId }: { plans: IncomePlan[]; paychecks: Paycheck[]; accounts: Account[]; month: string; newSourceId: string }) {
  const [selected, setSelected] = useState("");
  const latest = plans.filter((plan, index) => plans.findIndex((other) => other.sourceId === plan.sourceId) === index);
  const eligible = accounts.filter((account) => ["checking", "savings", "cash"].includes(account.kind) && account.currency === "USD");
  const paycheck = paychecks.find((row) => row.id === selected);
  return <section id="income-plan" className="scroll-mt-6">
    <h2 className="text-lg">Monthly income plan</h2>
    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">Plan the full month from day one. Deposits replace expected payments automatically, so income is never counted twice.</p>
    <div className="mt-4 space-y-3">{latest.map((plan) => <details key={plan.sourceId} className="rounded-lg border border-[var(--color-border)] p-4">
      <summary className="cursor-pointer text-sm"><strong>{plan.name}</strong> · {plan.paymentsPerMonth} × {formatCents(plan.amountCents)}{!plan.enabled && " · Paused"}<span className="block mt-1 text-xs text-[var(--color-ink-muted)]">From {plan.effectiveMonth} · Edit plan</span></summary>
      <IncomeForm plan={plan} accounts={eligible} month={month < plan.effectiveMonth ? plan.effectiveMonth : month} />
    </details>)}</div>
    <label className="mt-5 block text-sm">Add from a recent paycheck<select className="field mt-1 w-full" value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Choose an imported paycheck…</option>{paychecks.map((row) => <option key={row.id} value={row.id}>{row.name ?? row.pattern} · {formatCents(row.amountCents)} · {row.postedOn}</option>)}</select></label>
    {!paychecks.length && <p className="mt-2 text-sm text-[var(--color-ink-muted)]">Import or record a deposit categorized as Salary &amp; Wages to create a plan.</p>}
    {paycheck && <IncomeForm key={paycheck.id} plan={{ sourceId: newSourceId, name: paycheck.name ?? paycheck.pattern, pattern: paycheck.pattern, accountId: paycheck.accountId, amountCents: paycheck.amountCents, paymentsPerMonth: 2, enabled: true, effectiveMonth: month }} accounts={eligible} month={month} />}
  </section>;
}
