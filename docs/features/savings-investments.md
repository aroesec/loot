# Savings and investment funds

In **Settings → Savings & investments**, add each fund with its name, type,
funding account, and a distinctive transfer description. A fund can have up to
8 description patterns. This is an ownership declaration: use only transfers
between your own accounts. Savings and investment accounts do not need to be
linked to track transfers from checking.

Overview shows contributions, withdrawals and separate net savings/investment
contributions for the selected month. "Left after contributions" is income minus
spending minus net contributions, not a bank balance or portfolio valuation.
Configured contributions are transfers, not expenses; withdrawals are not new
income. Interest, dividends, fees and loan descriptions retain ordinary
classification. Other institutions still use the existing classification rules.

Select the optional destination account if it is imported. A unique opposite
transfer within three days can be paired; ambiguous matches and manual
classifications are not changed. Only the funding side contributes to the fund
summary. Import the funding account to populate these totals.

Saving changes applies them to matching history and future imports. Removing a
fund restores ordinary automatic classifications and queues unmatched rows for
review. It does not delete bank transactions. Changes are transactional, and
repeated classification is idempotent. The current limits are 20 funds and
20,000 relevant automatic transactions per refresh.

## Delivery and validation

- Acceptance: editable Settings funds, separate Overview totals, expense/income
  exclusion, saved history and future import handling, withdrawal accounting,
  counterpart deduplication, manual preservation, validation/error states.
- Non-goals: bank linking, trade tracking, tax calculations, account balance or
  investment-return estimates, general-purpose transfer reconciliation.
- Apply migration `0019_familiar_ares` before deploying code. It adds the funds
  table and nullable transaction reference, without rewriting existing rows.
- Keep the additive schema if rolling back code. Remove fund settings with the
  current app before rollback if restoring prior classification is desired;
  then deploy the previous version. Do not drop the new table to undo the data.
- Unit coverage: `npm test` / `pnpm test`; types: `npm run typecheck`; production
  build: `npm run build`. These invoke the repository's existing scripts.
- Database checks: migrations from empty, seed twice, and
  `tsx test/integration/funds.ts` against a disposable local PostgreSQL database.
  CI runs this after migration and seeding.
- Real local HTTP forms verified login, fund creation, reload persistence,
  Overview navigation, type edits and invalid-account validation. The in-app
  browser's login POST sent an invalid `Origin: null`; direct HTTP with a normal
  origin passed. This is not claimed as a completed browser interaction test.
