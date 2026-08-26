# Loot

A personal finance ledger you host yourself. Upload bank and card statements,
or connect an account, and it works out where the money went and what the month
actually cost.

Single user, one household, one database. Nothing leaves your deployment.

```
Income          $9,140.22
Spending        $8,712.55
Net               $427.67

Groceries       $1,204.11   ▇▇▇▇▇▇▇▇▇▇▇▇
Mortgage        $4,500.00   ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇
Restaurants       $612.40   ▇▇▇▇▇▇
```

## Features

* Reads CSV statements from any bank, and PDF statements if a model is
  configured
* Classifies every transaction with merchant rules first, a model second, and
  never a guess
* Credit card payments are not counted as spending, so a charge and its
  payment do not both hit the budget
* Optional bank syncing through Plaid, with two years of history
* Budgets, recurring detection, spending trends, and a cash buffer that
  measures how long your money would last
* Compares categories against published national averages, adjusted for
  household size and region
* Business mode, with a P&L, quarterly periods and Schedule C lines
* Alerts by web push or SMS, only when something is actually worth saying
* An MCP server, so you can ask Claude what you spent and log purchases by
  voice
* Export everything as CSV or JSON, whenever you want, with no lock-in

## Setup

Requires Node 22 or newer, pnpm, and a Postgres database.

```sh
git clone https://github.com/aroesec/loot.git
cd loot
pnpm install
cp .env.example .env.local
```

Three variables are required:

```sh
DATABASE_URL="postgres://user:pass@host:5432/loot"
APP_PASSWORD="something long"
SESSION_SECRET="at least 32 characters"
```

Then:

```sh
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open http://localhost:3000 and sign in with `APP_PASSWORD`. Upload a CSV from
your bank to get started.

Everything else is optional. Without an API key the classifier runs on rules
only. Without Plaid credentials you upload statements by hand. The app is fully
usable either way.

| Optional | Set |
|---|---|
| Model-backed classification and PDF statements | `AI_API_KEY`, `AI_PROVIDER`, `AI_MODEL` |
| Bank syncing | `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`, `PLAID_TOKEN_KEY` |
| Push alerts | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` |
| SMS alerts | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `ALERT_PHONE` |
| Scheduled sync | `CRON_SECRET` |

`.env.example` documents all of them.

## Deploying

Any Node host and any Postgres. Docker Compose and Vercel are both covered in
[docs/deploy.md](docs/deploy.md).

```sh
docker compose up -d
```

## Documentation

| | |
|---|---|
| [deploy.md](docs/deploy.md) | Hosting, Docker, migrations |
| [security.md](docs/security.md) | Authentication, rate limiting, proxies |
| [classification.md](docs/classification.md) | How transactions get categorized |
| [backups.md](docs/backups.md) | Taking and restoring dumps |
| [notifications.md](docs/notifications.md) | Push, SMS, installing on iOS |
| [plaid.md](docs/plaid.md) | Bank syncing |
| [ai.md](docs/ai.md) | Model providers, including local ones |
| [extending.md](docs/extending.md) | Adding sources, providers and channels |
| [AGENTS.md](AGENTS.md) | Conventions and invariants, for humans and coding agents |
| [DESIGN.md](DESIGN.md) | Why the design is the way it is |
| [TESTING.md](TESTING.md) | What is worth testing here, and what is not |

## Commands

| | |
|---|---|
| `pnpm dev` `build` `test` `typecheck` | the usual |
| `pnpm auth:hash '<password>'` | generate `APP_PASSWORD_HASH` |
| `pnpm db:migrate` then `db:seed` | schema, then the chart of accounts |
| `pnpm db:reclassify` | re-run the pipeline, skipping manual rows |
| `pnpm db:reconcile-debt` | after any import or reclassify |
| `pnpm db:backup` | verified `pg_dump` into `backups/` |
| `pnpm db:audit-period [YYYY-MM]` | reconcile a month four ways |
| `pnpm icons` | re-render app icons from the theme |

## Stack

Next.js 15 with the App Router, Postgres via Drizzle, Tailwind. The Anthropic
and Plaid SDKs are optional at runtime and sit behind interfaces, so neither is
required to run the app.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) covers setup and the invariants worth
knowing before changing anything. [DESIGN.md](DESIGN.md) explains why the
design is the way it is, usually by naming the bug that caused it.

Security reports go through
[private advisories](https://github.com/aroesec/loot/security/advisories/new)
rather than public issues. See [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
