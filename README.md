# Loot

[![Release](https://img.shields.io/github/v/release/aroesec/loot?sort=semver)](https://github.com/aroesec/loot/releases)
[![CI](https://github.com/aroesec/loot/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/aroesec/loot/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/aroesec/loot)](LICENSE)

A finance ledger you host yourself. Upload bank and card statements, or connect
an account, and it works out where the money went — for a household, or for a
sole proprietorship that has to answer to a tax return.

Single user, one database, nothing leaving your deployment. No account to make,
no subscription, no company between you and your own transactions.

```
Income          $9,140.22
Spending        $8,712.55
Net               $427.67

Groceries       $1,204.11   ▇▇▇▇▇▇▇▇▇▇▇▇
Mortgage        $4,500.00   ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇
Restaurants       $612.40   ▇▇▇▇▇▇
```

## Why it exists

Most of this code is not about showing you a number. It is about the number
being right when nothing looks wrong.

A ledger fails quietly. It does not crash — it reports $5,000 of spending in a
month that really cost $16,600, because two payment rails were flagged as
transfers and $6,000 paid to a contractor stopped counting. It tells a family of
four they overspend on everything, because nobody asked how many people live
there. It files a $1,430 card payment as fuel because the pattern `mobil` also
sits inside `MOBILE PMT`.

Every one of those happened here, and each one is now an invariant with a test
and a paragraph in [DESIGN.md](DESIGN.md) naming the bug that produced it. That
is the actual design of this project: owner's draw is not an expense, an account
with no balance is unknown rather than zero, mileage is rated by the day it was
driven because the IRS revises the rate mid-year. The features are ordinary. The
care about which figure is wrong, and in which direction, is not.

## Features

* CSV from any bank; PDF statements and screenshots when a model is configured
* Merchant rules first, a model second, and never a guess — whatever stays
  unresolved is filed as Uncategorized rather than assigned
* Corrections teach rules, and re-file the history that matches them
* Card payments never count as spending, and a payment to a card the ledger
  cannot see is counted as debt rather than quietly dropped
* Budgets, recurring detection, trends, and a cash buffer measured against your
  own median month rather than a rule of thumb
* Budgets can carry what you did not spend into the next month, per budget, so
  a lumpy cost saved for over three months is a plan rather than three wins and
  a failure
* Net worth, with how much of it is unknown said out loud — an account with no
  balance is unknown, not empty
* Comparisons with published national averages, scaled by household size and
  region
* Split a transaction across categories, reversibly
* Optional bank syncing through Plaid; optional push and SMS alerts
* An MCP server: ask Claude what you spent, or log a purchase by voice
* Export everything as CSV or JSON, whenever you want

### Business mode

The same ledger asking a different question — what the profit is, and what is
deductible. Its own chart of accounts, and its own reports.

```
Revenue        $48,200.00
Cost of sales  $11,340.00
Gross profit   $36,860.00   76% margin

Operating      $14,905.00
Net profit     $21,955.00

Set aside       $7,591.00   $3,102 self-employment + $4,489 income tax
```

* Profit and loss by month or quarter, with gross margin kept separate from net
* A Schedule C summary by tax line, face value and deductible share side by
  side, exportable as CSV
* Self-employment tax computed exactly from profit. Income tax uses a rate you
  supply, because it depends on your filing status and the rest of your return
  — the app will not invent one and present it next to an exact figure
* Owner's draw is not an expense. Counting it as one understates profit and
  overstates deductions, which on a tax return is not a cosmetic error
* Quarterly estimate dates, which do not line up with the quarters they cover
* A mileage log rated by the day each trip was driven, because the IRS revises
  the rate mid-year and a year's miles at one rate is wrong for half of it
* Your business name and logo on reports, and a roster of the employees and
  contractors you pay

## Choosing this, or not

There is good self-hosted finance software already —
[Actual Budget](https://actualbudget.org) and
[Firefly III](https://www.firefly-iii.org) are both mature, and if envelope
budgeting or a long-established tool is what you want, start there.

What this one leans on:

- **Statements in, answers out.** Point it at a CSV — or a PDF, or a photo of
  one — and it classifies what it finds, learns from your corrections, and asks
  rather than guesses when it cannot tell.
- **A business mode that reaches a tax form.** Profit and loss, Schedule C by
  line, self-employment tax, quarterly dates, a mileage log.
- **It talks to Claude.** An MCP server, so you can ask what you spent and log a
  purchase out loud.
- **It is genuinely one household.** Not multi-tenant software running for one
  person — there is no tenant, no account, and nothing to send anywhere.

What it is not: a shared budget for a couple, a mobile app, or a service. It is
one deployment, one password, and your own Postgres.

## Setup

Just want it running? Docker Compose brings up the app and a Postgres beside it:

```sh
git clone https://github.com/aroesec/loot.git
cd loot
cp .env.example .env      # then set the values docs/deploy.md lists
docker compose up -d
```

[docs/deploy.md](docs/deploy.md) covers the rest, including the migrations. To
work on it instead of just running it, you need Node 22 or newer, pnpm, and a
Postgres database.

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
pnpm db:migrate && pnpm db:seed
pnpm dev
```

Sign in at http://localhost:3000 with `APP_PASSWORD`. First run asks whether
the ledger is personal or a business — it picks the chart of accounts, and is
switchable later. Upload a CSV and it starts classifying.

Everything else is optional and the app is fully usable without it: no API key
means the classifier runs on rules alone, and no Plaid credentials means you
upload statements by hand.

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

A prebuilt image is published to GitHub Container Registry on every push to
`main` and every release tag:

```sh
docker pull ghcr.io/aroesec/loot:0.3.0
```

Note that `docker-compose.yml` builds from source rather than using it, so the
image is for your own compose file or orchestrator. Pin to `0.3.0` or a `sha-`
tag for anything you care about: `latest` moves, and registry tags carry no `v`
prefix even though the git tags do.

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
| [CHANGELOG.md](CHANGELOG.md) | What changed in each release |

## Commands

| | |
|---|---|
| `pnpm dev` `build` `test` `typecheck` | the usual |
| `pnpm auth:hash '<password>'` | generate `APP_PASSWORD_HASH` |
| `pnpm db:migrate` then `db:seed` | schema, then the chart of accounts |
| `pnpm db:reclassify` then `db:reconcile-debt` | re-file history; always in that order, or real spending disappears |
| `pnpm db:backup` | verified `pg_dump` into `backups/` |
| `pnpm db:audit-income` `db:audit-period` `db:audit-splits` | prove the totals from outside the code |

`package.json` is the source of truth for the rest.

## Stack

Next.js 15 with the App Router, Postgres via Drizzle, Tailwind. The Anthropic
and Plaid SDKs sit behind interfaces and are optional at runtime, so neither is
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
