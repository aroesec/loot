# Category budgets and approved recurring bills

Budgets lists every leaf spending category in the active ledger, including those
with no activity or allocation. Parent categories are section headings rather
than separately counted budgets. Every row has its own monthly allocation,
spending progress, share of the allocated budget, and optional rollover. Totals
at the bottom include all recorded spending, including spending that cannot yet
be allocated to a leaf category. Savings/investment transfers stay separate.

In-page alerts begin at 75% of available budget; reaching and exceeding the limit
have distinct messages. These are dashboard alerts, not new email/SMS/push sends.
Saving applies to the selected month onward until the next existing budget
revision. Zero clears the allocation without reviving an earlier budget. Past
and future revisions are preserved, including edits made out of chronological
order. Rollover retains the existing opt-in semantics.

Recurring expenses shows proposals from two consecutive recent months. It looks
at the selected month and its two preceding months so a bill due later this
month can be proposed from the previous two completed months. Proposals require
one cleared outflow in each observed month, matching account, merchant, and
category; a 24–38 day gap; and amounts within a 1.5 ratio. Transfers, income,
frequent merchant purchases, and pending observations do not generate proposals.
Two observations are evidence to review, not proof of a recurring obligation.

Nothing enters the expense forecast without explicit approval. A proposed bill
shows the observed dates and amounts; users can edit its name and monthly amount
before approval or dismiss it. Dismissals can be reversed. Approvals and pauses
are month-effective revisions. Automatic scans never update these decisions.
This workflow currently supports monthly bills; quarterly/annual bills and
multiple distinct bills with the same account/merchant/category need separate
future scheduling support. Existing legacy subscription records are retained.

For each category, forecast spending is max(available budget, recorded spending
+ approved bills not yet recorded). Summing those categories avoids adding a
bill on top of the budget intended to cover it. A matching recorded outflow
replaces the estimate even when its actual amount differs. Pending outflows
already count in the ledger's spending total, so they also replace the estimate
and are labeled recorded, not paid. Unbudgeted future purchases remain unknown.

Overview uses the same forecast as Budgets. The remaining amount subtracts
recorded fund contributions separately and is not a bank balance. No transaction
is created by a budget, a suggestion, or an approval; no payments are scheduled.

Apply generated migration 0021 before code. JSON export version 7 includes all
expense-plan revisions. No user's recurring bills or budgets are pre-approved or
seeded. Unit tests and test/integration/planning.ts verify approval, replacement,
month-effective revisions, removal, and category budget overlap.


## Cash allocation and automatic budgets

Overview and Budgets show expenses, savings, and investments separately. Income is unchanged; left to spend subtracts all three. A negative result has an explicit shortfall warning.

The explicit “Budget detected recurring bills” action includes the currently detected monthly bills and creates budgets only for categories without an effective budget. Existing budgets (including deliberate zero budgets) and excluded bills are preserved. Retrying does not duplicate bills or budgets. Recorded charges replace bill estimates.

Fund estimates use each fund’s gross contributions in the previous two complete calendar months. Both must be positive and within 50% of one another; the most recent month supplies the estimate. Current contributions replace that estimate, and withdrawals reduce the net allocation. Only the configured funding account is counted, so the receiving side does not double count. One-off and changing contributions have no inferred future amount. Estimates are explicitly labeled and are not a bank balance or a guarantee of future transfers.


Saved weekly fund schedules override the inferred monthly contribution for that fund. Set an amount and weekday on Budgets or Overview. Revisions apply from the selected month forward. Each calendar occurrence reserves one transfer; a same-amount funding-account transfer in the selected month within three days replaces it, once. Extra one-off contributions remain recorded contributions and do not consume weekly occurrences. Pausing a schedule keeps recorded contributions and removes future reservations. No bank transfer is scheduled or changed. Reconcile transfers posted across month boundaries or with changed amounts manually before relying on the forecast.
