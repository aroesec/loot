# Changelog

Notable changes, newest first. This project follows
[semantic versioning](https://semver.org/) loosely: the major version stays at
0 until the schema settles.

## Unreleased

## 0.1.1

- Correct the registry tag in the docs: the git tag `v0.1.0` publishes as
  `0.1.0`, and the released docs named a tag that does not exist
- Remove a city name that had been scrubbed from the repo and reappeared in a
  code comment

## 0.1.0

First tagged release. Images at `ghcr.io/aroesec/loot`.

### Ledger
- CSV and PDF statement import, with fingerprint deduplication so the same
  statement can be uploaded repeatedly without creating duplicates
- Three-pass classification: merchant rules, then a model, then a floor that
  files anything unresolved as Uncategorized rather than guessing
- Corrections teach rules and re-file matching history
- Credit card payments excluded from spending, with reconciliation back to the
  charges they settled
- Payments to cards the ledger cannot see are counted as debt rather than
  silently dropped
- Keyboard-driven review queue for transactions that need an answer

### Reports
- Monthly and yearly summaries, budgets, recurring detection, spending trends
- Cash buffer measured against the household's own median month
- Comparison against published national averages, adjusted for household size
  and region
- Business mode: profit and loss, quarterly periods, Schedule C summary with
  CSV export, and an estimated tax set-aside

### Getting data in and out
- Split a transaction across several categories, reversibly, with an audit that
  proves every split still sums to what it replaced
- Export the whole ledger as CSV or JSON, with no lock-in

### Platform
- Optional bank syncing through Plaid, with two years of history
- Alerts by web push or SMS, rate limited to what is worth an interruption
- MCP server for asking about spending and logging purchases by voice
- Verified `pg_dump` backups that refuse to keep a dump whose row count
  disagrees with the database
- Full data export as CSV or JSON
- Installable as a PWA, which is what makes notifications work on iOS
- Prebuilt Docker images published to GHCR on every push to `main`
- Dependabot, with majors held back until they are actually tested
