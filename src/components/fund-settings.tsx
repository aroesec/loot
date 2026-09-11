"use client";
import { useActionState } from "react";
import { saveFundAction } from "@/app/settings/fund-actions";
import type { Fund } from "@/lib/funds/logic";

type Account = { id: string; name: string; kind: string };
function FundForm({ fund, accounts }: { fund?: Fund; accounts: Account[] }) {
  const [state, action, pending] = useActionState(saveFundAction, {});
  const prefix = fund?.id ?? "new-fund";
  return <form action={action} className="space-y-3 rounded-[var(--radius-token)] border border-[var(--color-border)] p-4">
    {fund && <input type="hidden" name="id" value={fund.id} />}
    <h3 className="font-medium">{fund?.name ?? "Add a fund"}</h3>
    <div className="grid gap-3 sm:grid-cols-2">
      <div><label htmlFor={`${prefix}-name`} className="text-sm">Fund name</label>
        <input id={`${prefix}-name`} name="name" className="field mt-1" required maxLength={80} defaultValue={fund?.name} placeholder="Emergency savings" /></div>
      <div><label htmlFor={`${prefix}-kind`} className="text-sm">Type</label>
        <select id={`${prefix}-kind`} name="kind" className="field mt-1" defaultValue={fund?.kind ?? "savings"}>
          <option value="savings">Savings</option><option value="investment">Investment</option>
        </select></div>
      <div><label htmlFor={`${prefix}-from`} className="text-sm">Funding account</label>
        <select id={`${prefix}-from`} name="fundingAccountId" className="field mt-1" required defaultValue={fund?.fundingAccountId ?? ""}>
          <option value="" disabled>Choose the account you transfer from</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select></div>
      <div><label htmlFor={`${prefix}-to`} className="text-sm">Fund account (optional)</label>
        <select id={`${prefix}-to`} name="destinationAccountId" className="field mt-1" defaultValue={fund?.destinationAccountId ?? ""}>
          <option value="">Not imported or linked</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select></div>
    </div>
    <div><label htmlFor={`${prefix}-patterns`} className="text-sm">Transfer descriptions</label>
      <textarea id={`${prefix}-patterns`} name="patterns" className="field mt-1" rows={2} required maxLength={1287}
        defaultValue={fund?.patterns.join("\n")} aria-describedby={`${prefix}-help`} />
      <p id={`${prefix}-help`} className="mt-1 text-xs text-[var(--color-ink-muted)]">Enter a distinctive part of the transfer description on your funding account, one per line (up to 8). Matching money out is a contribution; matching money back is a withdrawal. Use only transfers between your own accounts.</p></div>
    {state.error && <p role="alert" className="text-sm text-[var(--color-negative)]">{state.error}</p>}
    {state.message && <p role="status" className="text-sm text-[var(--color-positive)]">{state.message}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="submit" disabled={pending || accounts.length === 0} className="btn btn-primary">{pending ? "Saving…" : fund ? "Save fund" : "Add fund"}</button>
      {fund && <button type="submit" name="intent" value="remove" formNoValidate disabled={pending} className="btn">Remove fund</button>}
    </div>
  </form>;
}
export function FundSettings({ funds, accounts }: { funds: Fund[]; accounts: Account[] }) {
  const eligible = accounts.filter((a) => !["credit_card", "loan"].includes(a.kind));
  return <section id="funds">
    <h2 className="text-lg">Savings &amp; investments</h2>
    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">Keep money you set aside separate from expenses. Contributions and withdrawals appear on Overview; interest, dividends and fees remain in the ledger. Saving updates matching history and future imports, while keeping manual classifications.</p>
    <p className="mt-2 text-sm text-[var(--color-ink-muted)]">If you also import the fund account, select it so matching transfers are counted once. The funding account is the source of contribution totals.</p>
    {eligible.length === 0 && <p className="mt-3 text-sm">Add a funding account below before setting up a fund.</p>}
    <div className="mt-4 grid gap-4 xl:grid-cols-2">
      {funds.map((f) => <FundForm key={f.id} fund={f} accounts={eligible} />)}
      <FundForm accounts={eligible} />
    </div>
  </section>;
}
