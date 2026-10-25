# Monthly income plan

In personal mode, Settings → Monthly income plan creates an expectation from an
imported Salary & Wages deposit. Confirm the take-home amount, receiving account,
and distinctive description. Two payments per month is the default. Set the
first month to include. No artificial ledger transactions are created.

Overview shows cleared income received plus the remaining expected payments.
Each matching positive, cleared, non-transfer deposit fulfills one expected
payment. Pending deposits do not count as received. Extra payments and differing
actual amounts are included once at their actual value. Refunds, reimbursements
and reversals do not fulfill payroll expectations. Income plans should describe
one payroll deposit per payment; split payroll should use separate account plans.

Progress resets each calendar month. New monthly expectations exist without a
cron job or an import. Editing or pausing a source creates a month-effective
revision; earlier months retain their previous assumptions. Edit the same source
when pay changes. Unchecking Include in monthly plan pauses it from the chosen
month. A missing receipt is still expected until the plan is corrected; a
forecast is not a bank balance and excludes future unrecorded expenses.

Receipt tracking follows the ledger: import or record the real deposit once,
and do not add a second receipt just to mark the expected payment paid. Deleting
or correcting a deposit updates receipt progress on the next page load.

Deploy the additive 0020 migration before deploying code. The income plan builds
on the funds feature (0019). Source amounts are private configuration and are
never seeded in migrations. Configure payroll sources in Settings after deploy.
JSON exports include all month-effective income plan revisions (format 6).

Validation: `npm test`, `npm run typecheck`, `npm run build`. Integration:
`node --env-file=.env.local --import tsx test/integration/income.ts`, against a
migrated, seeded, disposable local database only. CI runs the integration test.
