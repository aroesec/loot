# Changelog

Notable changes, newest first. This project follows
[semantic versioning](https://semver.org/) loosely: the major version stays at
0 until the schema settles.

## Unreleased

### Added
- Net worth on Buffer & goals, with how much of it is unknown stated alongside
  it. An account with no balance is counted as unknown rather than as zero, and
  the page says how many are missing — a linked current account beside an
  unlinked mortgage would otherwise read as a healthy figure that is wrong by
  the size of a house
- Balances can be typed in on Settings, so net worth does not require linking a
  bank. A balance is the one thing a statement cannot tell the ledger
- Budgets can carry their balance between months, per budget: carry what is
  left, carry both ways, or neither. Off by default, and switching it on is not
  retroactive
- A business mileage log, rated by the day each trip was driven. Rates change
  mid-year — 2026 ran at 72.5¢ through June and 76¢ after — so a year's miles
  are summed per trip rather than multiplied by one rate. Shown on Schedule C
  but not added to the deductible total, because the standard rate replaces
  deducting what the vehicle actually cost rather than adding to it
- Accounts and roster entries can be renamed and corrected after they are
  created

### Fixed
- **Security.** A theme value could break out of the `<style>` element it is
  rendered into and run script on every page, including `/login`, which is
  served before anyone signs in. Setting one needs a session, so this was a way
  to persist rather than a way in. Values are now checked against what a token
  can legitimately be, at render as well as on save
- **Security.** A password digest is now required to be the length the app
  produces. A hash truncated in transit was checked against a correspondingly
  shorter key and still accepted the password
- The budgets header subtracted spending from the sum of the targets while the
  lines below used the carried figure, so the page disagreed with itself once
  anything rolled over

### Changed
- The JSON export carries the mileage log and the balance history
  (`formatVersion` 4). Plaid does not hand history back, so an export without it
  would lose the record permanently

## 0.2.0

### Added
- Business logo, set during first run or from Settings, shown on business
  reports. PNG, JPEG or WebP up to 1MB
- A team roster for business mode: employees and contractors, with name, type
  and an optional email. It is a contact list for your own reference — nothing
  in it is linked to a transaction or a report
- Linking a bank is now offered during first run, not only afterwards in
  Settings

### Changed
- First-run setup asks personal-or-business as a choice you can switch at any
  point rather than a step you commit to. The fields below it change as you
  switch, so the other option is no longer behind a click
- The JSON export now carries the team roster (`formatVersion` 2). The format
  only ever grows by adding keys, so anything reading version 1 still finds
  what it knew about
- Only `main` deploys to Vercel now. A preview build needs `DATABASE_URL` and
  `SESSION_SECRET`, which are production-scoped and cannot be given to a fork,
  so the preview check had failed on every pull request this repo has had.
  `docs/deploy.md` explains how to turn previews back on with their own
  database

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
