# Contributing

## Getting it running

You need Node 22 or newer, pnpm, and a Postgres database. Nothing else. The
model and bank syncing are both optional, and the app runs fully without them.

```sh
pnpm install
cp .env.example .env.local     # set DATABASE_URL, APP_PASSWORD, SESSION_SECRET
pnpm db:migrate && pnpm db:seed
pnpm dev
```

That should be the whole setup. If it is not, please open an issue.

```sh
pnpm test        # no database needed
pnpm typecheck
pnpm build
```

CI runs those three, builds the Docker image, and applies every migration to a
clean database. All of it has to pass.

## Read CLAUDE.md first

It is the design document, and it is written as a list of invariants and the
bugs that produced them rather than a description of the code. Most of the
non-obvious decisions here are load-bearing for reasons you cannot see from the
code alone.

The short version, because breaking any of these makes a number wrong rather
than making something crash:

- Money is integer cents. Floats only at the formatting boundary.
- Negative means money out. A period's net cashflow is a plain `SUM`.
- `is_transfer` is the only thing that removes money from a total, which makes
  it the single point of failure for income. A rule may only set it on an
  inflow when the pattern names a payment or names the other account.
- `is_transfer` is not a category. Pinning the two together is what once made
  $6,000 of real spending disappear from a month.
- A manual classification is never overwritten. Every automated pass filters on
  `classification_source <> 'manual'`.
- Changing `normalize.ts` changes every `dedupe_hash`, so a re-uploaded
  statement inserts duplicates instead of no-ops.

## Tests

The suite is mostly regressions with the reason written down. When you fix
something, add the test that would have caught it and put the failure in the
comment: not what the code does, but what went wrong and what it cost. It makes
the suite readable a year later.

Pure logic belongs in a module that does not import `@/db`. Importing the
database pulls in the whole env schema and puts the code out of reach of a unit
test. `classify/match.ts`, `dates.ts` and `reconcile/coverage.ts` were all split
out for that reason.

## Changing the taxonomy

Rules only decide a category at classification time, so fixing a rule does
nothing to the history it already mislabelled.

```sh
pnpm db:seed            # upserts seed rules, prunes retired ones
pnpm db:reclassify      # re-runs the pipeline, skipping manual rows
pnpm db:reconcile-debt
```

Run all three. Reconciliation reads the state of the ledger to decide whether a
card payment is a transfer or a real debt payment, and a reclassify resets that
to whatever the rule says. Skip it and real spending disappears from the totals.

## Scope

This is a ledger for a household or a small business. Things that fit: better
classification, more institutions, more statement formats, reports, extra
notification channels, deployment targets.

Things that do not: multi-tenancy, anything that sends the ledger to a third
party, and features that need a hosted service to work. The premise is that the
data stays yours.

Adding a statement source, an AI provider, a notification channel or a benchmark
provider should not require touching anything else. Each one is a registry, and
`docs/extending.md` shows how.

## Pull requests

Small and focused, with the reasoning in the description. If it changes a number
a user sees, say which number and why it was wrong before.
