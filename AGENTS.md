# Loot — guide for coding agents

Next.js 15 App Router monorepo-of-one, Postgres via Drizzle, pnpm as the package
manager (Node 22+). Deployed on Vercel, but nothing in the code is specific to
it: any Node host and any Postgres works, and Docker Compose is a first-class
target.

This file holds repo-wide conventions. [DESIGN.md](DESIGN.md) holds the
reasoning behind them, written as invariants and the bugs that produced them —
read it before changing anything in `src/lib/classify` or `src/lib/reconcile`.
[TESTING.md](TESTING.md) governs all test design.

**This app computes numbers people make decisions with.** The dominant failure
mode is not a crash. It is a total that is quietly wrong and looks fine. Most
rules below exist because a specific number was wrong for a specific reason.

## Layout

- `src/app` — App Router pages and route handlers. Server components by default
- `src/app/api` — route handlers: upload, Plaid, push, MCP, cron, Schedule C CSV
- `src/components` — React components. `"use client"` only where a component
  needs state, effects or event handlers
- `src/lib` — all business logic. Nothing here imports React
- `src/db` — schema, migrations, and the operational scripts behind `pnpm db:*`
- `test` — Vitest. DB-free by construction, see [TESTING.md](TESTING.md)
- `docs` — operator and contributor documentation

## Invariants

Break one of these and a number goes wrong without anything erroring.

| Invariant | Consequence of breaking it |
|---|---|
| Money is integer cents (`bigint` in the schema, `number` in TS). Floats only at the formatting boundary | Rounding drift no test will show you |
| Negative means money out. A period's net cashflow is a plain `SUM(amount_cents)` | Per-row branching, and totals that disagree by page |
| `is_transfer` is the only thing that removes money from a total | It is the single point of failure for income |
| A rule may set `is_transfer` on an **inflow** only when its pattern names a payment or names the other account | A bare issuer name deletes cashback and refunds from income |
| `is_transfer` is not a category, and never a substitute for one | $6,000 of real spending once vanished from a month |
| A payment rail (Venmo, Zelle, Cash App) is never a transfer | Money leaving for a person is spending |
| Manual classifications are never overwritten. Every automated pass filters on `classification_source <> 'manual'` | The next reclassify silently discards the user's answers |
| `dedupe_hash` = sha256(account, date, amount, normalized description) | Changing `normalize.ts` changes every hash, so re-uploads insert duplicates |
| Category slugs are globally unique across both charts of accounts | The second seed silently overwrites the first |
| Owner's draw is not an expense | Understates profit and overstates deductions on a tax return |
| A split's parts sum exactly to what they replaced | Nothing downstream re-checks it, so a month's total moves silently |

`pnpm db:audit-income` and `pnpm db:audit-period [YYYY-MM]` exist to check the
first four from the outside. Run them after touching classification.

## Commands

`package.json` scripts are the source of truth. Every `db:*` script loads
`.env.local` via `tsx --env-file`, because `dotenv.config()` at the top of an ESM
module runs *after* every import has already evaluated.

```bash
pnpm dev                      # Next dev server
pnpm build                    # production build
pnpm test                     # Vitest, no database required
pnpm typecheck                # tsc --noEmit

pnpm db:generate              # drizzle-kit generate after a schema edit
pnpm db:migrate               # apply pending migrations
pnpm db:seed                  # chart of accounts + seed rules (idempotent)
pnpm db:reclassify            # re-run the pipeline, skipping manual rows
pnpm db:reconcile-debt        # MUST follow any import or reclassify
pnpm db:backup                # verified pg_dump into backups/
pnpm db:audit-income          # prove no inflow is excluded from income
pnpm db:audit-period 2026-08  # reconcile one month four independent ways
pnpm db:audit-splits          # prove every split still sums to what it replaced
pnpm db:plaid-status          # what is linked and each account's sync boundary
pnpm icons                    # re-render app icons from the theme
pnpm auth:hash '<password>'   # generate APP_PASSWORD_HASH
```

**After any taxonomy change, all three in order:** `db:seed`, `db:reclassify`,
`db:reconcile-debt`. Reconciliation reads the state of the ledger to decide
whether a card payment is a transfer or a real debt payment, and a reclassify
resets that to whatever the rule says. Skip it and real spending disappears.

## Deployment

- Vercel and Docker Compose are both documented in
  [docs/deploy.md](docs/deploy.md). Nothing in the code is specific to either.
- **Pin base images to a patch.** `node:22-alpine` is a moving tag, and an
  upstream rebuild dropped corepack, so `corepack enable` began failing with
  exit 127 in a build that had changed nothing. pnpm is installed with `npm
  install -g pnpm@$PNPM_VERSION`, kept in step with `packageManager`. That break
  lands on a stranger's machine, on the path they use to self-host.
- **Schema deploys separately from code, and the schema goes first.**
  `db:migrate` and `db:seed` run from a developer machine against the database
  directly, so a live deployment can be running old code against a new schema.
  Additive migrations make that window safe. Deploy immediately after changing
  classifier behaviour rather than eventually.
- **Vercel deployment protection must stay off** if MCP is used. MCP clients
  cannot complete an SSO flow. New Vercel projects enable it by default, and the
  failure looks like the app being broken rather than a platform setting.
- `vercel env pull` returns `[SENSITIVE]` rather than the value for sensitive
  variables, so secrets cannot be round-tripped back out.

## Library use

**Defer to the libraries already here. Do not hand-roll what one already does.**

| Domain | Library |
|---|---|
| Schema, migrations, queries | `drizzle-orm` + `drizzle-kit`. The query builder, not raw SQL |
| Validation | `zod`, at every external boundary. `src/lib/env.ts` is the model |
| Auth | `jose` for session JWTs, `node:crypto` scrypt for passwords. No auth framework |
| Model calls | The provider interface in `src/lib/ai`. Never import a vendor SDK directly outside it |
| Bank syncing | `plaid`, isolated behind `src/lib/plaid` |
| Push | `web-push`. SMS is one `fetch` to Twilio, not their SDK |
| Dates | `src/lib/dates.ts`. No date library; the app needs month boundaries, not a calendar |
| Images | `sharp`, dev-only, for `pnpm icons` |

Adding a dependency needs a reason in the PR: what gap it fills, why what is
here does not, and its maintenance profile. This app is meant to be cloned and
run by strangers, so every dependency is also a supply-chain decision.

## Database access

- All runtime queries go through Drizzle's query builder. Reach for
  `db.execute(sql\`…\`)` only for things the builder cannot express.
- **A Drizzle column reference inside a raw `sql` fragment renders unqualified.**
  `${accounts.id}` becomes `"id"`, so inside a subquery over `transactions` it
  silently resolves to the *transaction's* id. This produced a wrong answer
  rather than an error. Prefer a join and a `GROUP BY` over a correlated
  subquery in a `sql` template.
- **Schema-qualify raw table names** (`public.transactions`). An unqualified name
  depends on `search_path`, and a resuming serverless compute handed back a
  session where `current_schema()` was null.
- Use the client singleton in `src/db/index.ts`. Do not construct clients
  per-file.
- Result shapes differ by driver: postgres-js returns an array-like RowList,
  node-postgres returns `{ rows }`. Reading the wrong one yields `undefined`
  rather than throwing, which silently disables whatever check depended on it.

## Migrations

Everything under `drizzle/` is generated by drizzle-kit. The `.sql` files,
`meta/_journal.json` and `meta/*_snapshot.json` must stay in sync.

- **Never hand-edit generated DDL.** Change the schema and regenerate.
- **Never delete or rewrite an applied migration.** Add a new one on top.
- Drizzle skips migrations by the journal's `when` timestamp, **not** by content
  hash. Editing an applied migration's body therefore does not re-run it — which
  is what makes a careful correction safe, and what makes an accidental edit
  invisible.
- A hand-written data migration is legitimate for a backfill. Add the `.sql` and
  a journal entry whose `when` is greater than the previous one.
- **Upgrade is not first run.** A column added for a new feature is NULL on every
  existing deployment. If code branches on it, backfill in the same migration.
- `date_trunc` is not immutable for `date` arguments, so it cannot be used in an
  index expression (42P17).
- An enum parameter inside `CASE` needs an explicit `::type` cast.

## Conventions

### Splits replace, they do not nest

A split turns one transaction into siblings that sum to it. It was built that
way rather than as a parent with children because 54 places build their own
transactions query and 17 filter transfers by hand: a parent row that all of
them must remember to exclude double-counts the moment one forgets.

The first sibling is the original row, kept in place with a reduced amount, so
`dedupe_hash` and `plaid_transaction_id` stay claimed. New rows get hashes
derived from the original. Splitting a **pending** row is refused, because Plaid
rewrites a pending amount when it settles and that rewrite would land on one
sibling, leaving the parts no longer summing to the whole.

### Pure logic lives outside modules that import the database

Importing `@/db` pulls in the whole env schema, which needs a live
`DATABASE_URL` to load and puts everything in that module out of reach of a unit
test. When logic is worth testing, it goes in a DB-free file and is re-exported.

Already split for this reason: `classify/match.ts`, `dates.ts`,
`reconcile/coverage.ts`, `db/dump-text.ts`, `review-suggest.ts`,
`http/client-address.ts`, `tax-lines.ts`, `tax-math.ts`.

### Client components

- A client component must not import `@/lib/classify` or anything else that
  reaches the database. Shared constants live in `classify/constants.ts`.
- Server components are the default. Add `"use client"` only for state, effects
  or event handlers.

### Colors

Nothing hardcodes a color. Every surface reads `var(--color-*)` or a Tailwind
token mapped in `globals.css`; the values live as JSON in the `settings` row and
are injected per request. Light and dark are separate token sets.

Consumers that need a concrete string rather than a CSS variable — the web
manifest, the browser chrome color, the rendered icon — go through
`themeToken()`.

### Errors and user-facing copy

- Never surface an internal code (SQLSTATE, a stack trace, a provider payload)
  to a user. Map it at the boundary.
- **Scrub credentials out of anything that can be logged.** `pg_dump` echoes its
  connection string on failure and `execFile` repeats the command it ran, which
  printed a live database password in full. See `scrubError` in `db/backup.ts`.
- Distinguish "the check failed" from "the check found a problem". They mean
  opposite things, and conflating them sends people hunting a data bug that does
  not exist.

### Rate limiting and client addresses

Limits are cost ceilings, not access control; `guardApi()` has already run.
They are in-process and therefore per-instance, which is a deliberate trade
against requiring Redis.

`X-Forwarded-For` is a chain each proxy **appends** to, so the leftmost entry is
whatever the caller wrote. Entries are counted from the right, and
`TRUST_PROXY_HOPS` says how many to believe. Reading `[0]` let an attacker take
a fresh bucket per request, or push a chosen victim's bucket into lockout.

### The model never does arithmetic

`insights.ts` computes every figure deterministically and converts to dollars
before the model sees it. Sending cents and asking for conversion leaked a raw
`$10130` into user-facing prose.

Model-backed features degrade to rules-only rather than erroring when no API key
is set. That path must keep working: it is how most people will first run this.

## Working on changes

- Branch, commit, push, open a PR. Small and focused, reasoning in the
  description. If it changes a number a user sees, say which number and why it
  was wrong before.
- `pnpm test`, `pnpm typecheck` and `pnpm build` all have to pass. CI also builds
  the Docker image and applies every migration to a clean database.
- **Verify against a real run, not against your own reasoning.** Several bugs in
  this codebase's history passed review and a green test suite: a forgeable
  client address, a backup check that passed on an empty database, a suggestion
  list that silently excluded every income category. Each was found by running
  the thing and reading the output.
- **Never apply a mechanical text transform to prose or code you have not
  re-read.** A regex pass over the docs turned `cp .env.example .env.local` into
  `cp.env.example.env.local` and shipped it into the contributor setup steps.

## Do not

- Add multi-tenancy. One household, one deployment, one database.
- Send ledger data to a third party, or add a feature that needs a hosted service
  to work.
- Put a credential in the export. Plaid tokens, push subscriptions and MCP token
  hashes are excluded on purpose; none of them is the person's ledger.
- Cache financial pages in the service worker. It would serve a stale balance
  after logout.
- Commit anything from `.env.local`, `backups/`, or `.vercel/`.
- Put real statement data in a test fixture, a comment, or a commit message.
  Reference numbers, card last-fours, employer names and salary figures have all
  had to be scrubbed out of this repo once already.
