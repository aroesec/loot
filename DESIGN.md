# Loot — design notes

Why the code is the way it is, mostly by naming the bug that caused it. Read
[AGENTS.md](AGENTS.md) first for the conventions; this file is the reasoning
behind them.

Personal finance ledger. Next.js 15 (App Router) + Postgres/Drizzle + Claude,
deployed on Vercel. Single user, password auth.

## Invariants — break these and downstream numbers go wrong

**Money is integer cents.** `bigint` in the schema, `number` in TS. Floats only
at the formatting boundary (`formatCents`). Never store or sum a float.

**Sign convention: negative = money out.** Applied in parsing, storage, ledger
math and UI. A period's net cashflow is a plain `SUM(amount_cents)` — no
per-row branching. Spend totals are reported positive via `spendOf`.

**Income is only ever lost through `is_transfer`.** Totals split by sign, so a
positive amount counts whatever category it lands in — an imperfect category
still counts, and a classification failure costs nothing. That makes the
transfer flag the single point of failure for income, so a rule may only set it
on an inflow when its pattern *names a payment* ("payment thank you", "mobile
pmt") or *names the other account* ("chk ...", "card ending in"). A bare
institution name earns neither: money arriving from an issuer is cashback, a
refund or interest. `capital one` was unscoped and would have deleted a
cashback deposit from income on the strength of the word "Capital"; it is
`appliesTo: "debit"` now, and `test/classify-rules.test.ts` asserts the rule
over the whole seed set rather than case by case.

`pnpm db:audit-income` lists every inflow, whether it counted, and every rule
currently able to exclude one.

**The other way to lose income is the CSV sign flip.** A spending-positive
export has to be negated wholesale, and doing that to a deposit-heavy month
turns every paycheck into spending in one step. The threshold depends on the
account, which is why `parseCsvStatement` takes `accountKind`: a credit card
flips on a clear majority, a checking or savings account never flips and warns
instead, and an unknown account flips only when there is not a single outflow
in the file.

**Transfers are excluded from every income/spend total.** `is_transfer = true`
means the same dollar is already counted elsewhere in this ledger — the
matching side of a move between two of the user's own accounts, where the
description names the other account. Every ledger query filters on it. A wrong
transfer flag distorts everything downstream.

**`is_transfer` is not a category, and never a substitute for one.** Every
transaction carries a real `category_id` regardless of the flag. Pinning the
two together is what produced the worst bug this codebase has had: Venmo and
Zelle were seeded as `isTransfer`, so $6,000 paid to a person for contract work
vanished from every total and August reported $5,000.00 of spending against
$16,600.00 of real outflow. A payment rail describes how money moved, never
where it went. Money leaving for someone else is spending — Venmo, Zelle, Cash
App, ATM withdrawals and card payments are all categorized and counted.
`test/classify-rules.test.ts` pins this.

**A credit card payment is a transfer, not spending.** The swipe is the
expense; the payment only settles the balance. Counting both charges the same
dollar twice and makes budgets useless. The payment appears in a complete
ledger twice — as a debit on the checking statement ("Payment to Chase card
ending in 4321") and as a *positive* credit on the card's own ("PAYMENT THANK
YOU"), which would otherwise read as income. Both sides are flagged; the
`card-payment` category keeps them visible without counting them.

The corollary: card spending only enters the ledger when the card's own
statement is imported. A month with card payments but no card statement
under-reports, and nothing detects that.

**Manual classifications are never overwritten.** Every automated pass filters
on `classification_source <> 'manual'`. The user's answer outranks any rule or
model output.

**Dedupe is by fingerprint, not by statement.** `dedupe_hash` =
sha256(account, date, amount, normalized description), with a unique index.
This is what makes "upload any statement at any time" safe.

**The account is part of that fingerprint, so an unfiled import is unsafe.**
Rows imported without an account hash the literal `"no-account"` and share one
namespace: a $5.00 Starbucks on a card, on the same day as a $5.00 Starbucks on
checking, produces an identical hash and the second is dropped with no error. A
CSV cannot say which account it came from, so `/api/upload` refuses an unfiled
statement once more than one account is open. Assigning `account_id` to an
existing row also means re-deriving its hash — otherwise the next re-upload
misses and inserts a full duplicate set (`src/db/backfill-accounts.ts`).

## Classification pipeline (`src/lib/classify/`)

Three passes, in `index.ts`:

1. `rules.ts` — deterministic merchant matching, sorted by priority desc then
   pattern length desc (longer = more specific, so "uber eats" beats "uber").
   Seeds sit at priority 100, learned rules at 200. The matching itself is in
   `match.ts`, which has no DB import so tests and client code can reach it.
2. `llm.ts` — batches of 40 to `claude-opus-5`, structured output, taxonomy in
   a `cache_control` system prompt. Effort `low`; thinking stays on.
3. Floor — anything unresolved goes to Uncategorized, never a guess.

`learnFromCorrection` in `rules.ts` is the learning loop: a manual correction
writes a rule and back-applies it to non-manual history.

### The seed institution list is deliberately broad

It ships ~35 banks, card issuers and brokerages, not the handful any one
household uses. Two reasons, and only one of them is privacy: a shipped list
that mirrors the author's own accounts tells everyone who reads the repo where
they bank, and — more importantly — an unmatched card payment gets counted as
spending twice while nothing about the resulting total looks wrong.

Breadth raises the stakes on the income invariant, because reading the list
case by case stopped being possible. `test/classify-rules.test.ts` asserts the
properties over the whole set instead:

- nothing sets `is_transfer` on an inflow unless the pattern names a payment or
  an account — this is what forces the issuer rules that name only a *card*
  ("wells fargo credit card") to be `appliesTo: "debit"`, while the ones naming
  a payment ("amex epayment") are safe unscoped
- no payment rail is ever a transfer
- no unanchored pattern hides inside a word real statements contain — the
  `mobil`/`MOBILE PMT` class, checked against a list of such words rather than
  by pattern length, since "aldi" and "lyft" are short and perfectly safe
- a pattern never means one thing on debits and the opposite on credits

Adding an issuer rule does **not** conflict with `reconcile/debt.ts`. The rule
supplies the default — a payment is a transfer — and reconciliation then reads
the state of the ledger and promotes it to `debt-payment` when the card's
charges are missing. Run `db:reconcile-debt` after any reclassify, or that
promotion is lost and real spending disappears.

### Two things a rule can be besides a category

**Merchant-only** (`category: null`). Names the merchant and hands the category
question on — to the model by default, or to the user when `queueForReview` is
set.

**Queued** (`queueForReview: true`). Writes the rule's category but records
`classification_source = 'unclassified'` at confidence 0, which is what the
review queue selects on, and never reaches the model.

Queueing is **independent of whether the rule supplied a category**, because
"where does this money count" and "what was it for" are separate questions.
Payment rails answer the first and not the second: a Venmo payment is spending
the moment it leaves, so it lands in `person-to-person` — a real, budgetable
expense category — and is queued at the same time. Filing it and asking are not
alternatives. An unanswered question must never quietly cost the month's total,
which is what parking these in the unbudgetable Uncategorized bucket did.

Rails are queued rather than sent to the model because their descriptions
*structurally* cannot carry a purpose: `Zelle payment to JORDAN 10000000006` is
a name and a reference number, and the model answers Uncategorized every time.
Queueing reaches the same place without the call and says why in
`classification_reason`, so the review row explains itself.

This is distinct from the pass-3 floor, which is what's left when the model was
*asked* and had no confident answer. Queueing is knowing not to ask.

`reapplyAllRules` refreshes the merchant on a queued row and touches nothing
else — writing source `rule` at confidence 1 would silently lift it out of the
queue.

**Direction-scoped** (`appliesTo: "debit" | "credit"`). The same description
means opposite things by sign: `FID BKG SVC LLC MONEYLINE` is a contribution
going out and a withdrawal coming back. A scoped rule only fires on its sign,
and `learnFromCorrection`'s backfill is scoped the same way so correcting one
direction can't rewrite the other. `matchRule` needs the amount to resolve
these — pass it.

**A learned rule is scoped to the direction of the correction that taught it.**
`learnFromCorrection` infers `appliesTo` from the corrected transaction's sign,
so callers must pass `amountCents`. Defaulting to `any` meant a correction on
an outgoing Zelle also classified incoming ones — the user only ever said what
the outgoing one was. Being too narrow is the safe way to be wrong: the other
direction goes to the model, which classifies it and counts it.

`derivePattern` takes two leading words normally but four on a payment rail,
because "zelle payment" is not a merchant. Correcting one $1,000 Zelle for contract
work would otherwise have refiled every future Zelle as home maintenance. When the
rail carries no counterparty the reference number lands in the pattern and the
rule never fires again — deliberately, since under-matching costs a
re-correction and over-matching silently rewrites history.

`seed()` upserts seed rules in place and deletes retired ones, scoped to
`source = 'seed'` so corrections (promoted to `learned`) survive. It used to
`onConflictDoNothing`, which meant a wrong seed could never be fixed —
the Venmo/Zelle transfer rules would have survived every reseed.

After changing the taxonomy, run `pnpm db:seed` then `pnpm db:reclassify`.
Rules only decide a category at classification time; fixing a rule does nothing
to the history it already mislabelled.

### Normalization is load-bearing

`normalize.ts` prefers **leaving a word in over taking one out**. Rules match on
`contains`, so a leftover city name costs nothing, but eating a real word
silently breaks every rule that depended on it.

Two regressions are pinned by tests in `test/normalize.test.ts`:
- `UBER EATS 800... CA` once became `uber` (city-stripper ate "eats") → food
  delivery filed as rideshare.
- `CHECKCARD STARBUCKS` once became `starbuc` (KS read as Kansas).

The city-strip step only runs when a state code was actually found, skips
codes that double as business suffixes (`CO`, `IN`, …), and requires two
tokens to survive.

**Changing `normalize.ts` changes every `dedupe_hash`.** The hash is built from
the normalized description, so re-uploading an already-imported statement after
a normalization change inserts duplicates instead of no-ops. Write rule
patterns against what the normalizer already produces rather than adjusting it
— that is why the internal-transfer seed matches `"chk ..."`, the remains of
`Online Transfer to CHK ...1234` after `LEADING_NOISE` strips the verb.

A `contains` pattern matches inside words. `"mobil"` also sits in `MOBILE PMT`,
which filed a $1,430.00 Capital One card payment as Gas & Fuel and made a gas
station the month's top merchant. Short patterns that are prefixes of common
words need `matchType: "regex"` with `\b` anchors.

## Business mode (`src/lib/mode.ts`, `taxonomy-business.ts`, `pl.ts`)

A deployment is `personal` or `business` (`settings.ledger_mode`). Both charts
of accounts live in the same tables keyed by `mode`, so switching re-points the
classifier and the reports rather than discarding history. Switching does not
reclassify — a year of answered questions should not be thrown away by a
toggle. Run `db:reclassify` if you want history re-filed.

**Only the active mode's categories and rules are loaded.** `loadRules` and
`loadCategoryOptions` both filter on it. Several patterns exist in both charts
— "internal transfer" means the same thing to a person and a business but
points at a different category — which is why `mode` is part of the rule
uniqueness key `(pattern, match_type, applies_to, mode)`.

**Category slugs are globally unique across both charts.** They share one
table and one unique index, so a slug that appears in both makes the second
seed silently overwrite the first. `education` did exactly that: the household
category was converted into a business one, with a deductible percentage and a
Schedule C line attached. Business slugs are prefixed (`biz-education`,
`biz-software`) where the personal taxonomy already owns the name, and
`test/business.test.ts` asserts the two sets never intersect.

**Owner's draw is not an expense**, and it is the business analogue of
`is_transfer`. Paying yourself is profit being withdrawn, not a cost of earning
it; filing it as an expense understates profit and overstates deductions, which
on a tax return is not cosmetic. Owner-equity categories carry
`pl_section = 'owner_equity'`, never a `deductible_pct`, and are excluded from
the P&L while still being reported separately.

`deductible_pct` is a percentage, not a flag, because the interesting cases are
not binary — meals are commonly 50%, a home office is a share of the property.
These are defaults for organizing records, not tax advice.

`pl.ts` computes `revenue - cogs = gross profit`, `gross profit - opex = net
profit`, plus quarterly periods because US estimated tax is paid on that
cadence and is owed on profit rather than cashflow.

**The logo is base64 in two `settings` columns**, not a file path or an object
store. A logo is a few hundred kilobytes, and the alternatives each add
something this app refuses to require: a writable filesystem it does not
otherwise need, or a hosted bucket that would put the deployment's data
somewhere else. It is rendered as a `data:` URI, so no route serves it and no
request can leak it to someone unauthenticated. It is stored exactly as
uploaded — `sharp` is a build-time tool here (see `db/icons.ts`), and a resize
at request time is a dependency that breaks on a stranger's host for no gain.
Only the mime type and a 1MB cap are enforced.

**The `people` roster is a contact list, not an account system.** Employees
and contractors are rows the owner types for their own reference: no login, no
payroll, and — importantly — no foreign key from any transaction. The pull
toward linking them is obvious and was declined deliberately. Per-contractor
payment totals are a 1099 feature, and a 1099 feature that is *nearly* right is
worse than none, because the number looks authoritative on a form. It would
also need the classification path, which the invariants above guard closely.
Archiving retires a row rather than deleting it, so a name that appears in a
past export still resolves.

## Tax reporting (`src/lib/tax.ts`, `tax-lines.ts`, `tax-math.ts`)

`/schedule-c` groups a business year by the Schedule C line each category
already carried. The data was modelled from the start and nothing surfaced it.

**Two numbers, and the difference between them is the point.**
Self-employment tax is *computed*: 15.3% of 92.35% of profit, with Social
Security capped at the wage base and Medicare uncapped. Income tax is *not
computable here* — it depends on filing status, a spouse's income, other
deductions and the rest of the return — so it is a rate the person supplies.
Showing a guessed figure beside an exact one makes both look equally
authoritative, so the UI labels which is which every time.

**The wage base is hardcoded per year** because it cannot be derived. An
unlisted year falls back to the most recent known figure and reports
`wageBaseExact: false` so the UI can say the cap is approximate. Ignoring the
cap entirely overstates the bill by thousands for exactly the person most
likely to rely on it.

**Quarterly due dates are a literal table.** The periods are uneven — Q2 covers
two months, Q4 is paid the following January — so deriving them from the
quarter number gives three wrong answers.

**Categories with no Schedule C line are reported, not absorbed.** Folding them
into "other expenses" would invent an answer; the page shows the total and says
it is excluded from the deductible figure.

Owner's draw never reaches the form. Deducting it understates tax owed on a
return, which is worse than mislabelling a report.

`tax-lines.ts` holds the types, `lineOrder` and the CSV writer because `tax.ts`
imports `@/db`.

## Onboarding (`src/lib/onboarding.ts`, `/welcome`)

First run asks personal or business before anything else, because that choice
picks the chart of accounts and a month spent in the wrong one is a month filed
against categories the reports never read. Previously it was a control in
Settings that nothing pointed at.

It is a **persistent choice, not a step**. The original flow gated the
mode-specific fields behind a Continue button, which meant deciding before
seeing what either answer asked for. The two field sets are mutually exclusive
by mode, so the gate bought nothing that switching a tab does not: the picker
stays on screen and the fields below it re-render. The form underneath is
unchanged — one `<form>`, one hidden `mode` input, one submit — because the
choice is client state and there is still only one thing to write.

The business step also offers a logo and a bank connection, since both were
otherwise things you had to know to go looking for in Settings afterwards. The
bank block is hidden entirely when Plaid is unconfigured: `PlaidLinkButton`
degrades by naming the environment variables to set, which is the right answer
on a settings page and noise during a first run — and running without Plaid
credentials is how most people meet this app.

`onboarded_at` records that the questions were **asked**, not how they were
answered. Inferring setup from the presence of transactions would re-open the
flow for anyone who deleted their last row and skip it for anyone who imported
first.

The redirect lives in `app/page.tsx`: middleware runs on the edge and cannot
reach the database, and the layout renders `/welcome` itself so it would
redirect into a loop.

`profileGaps` is mode-aware for the same reason — household size and state only
mean something when comparing against household averages, and a business
deployment was being asked "How many people are in your household?" above its
P&L on every page.

## Ledger (`src/lib/ledger.ts`)

All month/year/budget math lives here so no two pages can disagree.

`categoryTrends` averages **only over months the ledger covers**. Averaging a
fixed window treats missing months as zero-spend months, which halves baselines
and produces confident nonsense (it once reported an internet bill rising "from
a $60.00 baseline" when the real prior months were $90.00 and $90.00).

## Insights (`src/lib/insights.ts`)

Two stages. Deterministic facts first (price hikes, budget overruns, spikes),
then Claude writes them up. **The model never does arithmetic** — it receives
figures already computed here, converted to dollars before they're sent.
Sending cents and asking for conversion leaked a raw `$12345` into user-facing
prose once.

When the model covers a category, the bare deterministic `spending_spike` for
that category is dropped so the feed doesn't double-report.

## Theme (`src/lib/theme.ts`)

Every color resolves through CSS custom properties stored as JSON in the
`settings` row and injected into `<head>` per request. Light and dark are
separate token sets (`dark-` prefix). **Nothing in the codebase hardcodes a
color** — use `var(--color-*)` or the Tailwind tokens mapped in `globals.css`.

Only tokens that differ from `THEME_DEFAULTS` are persisted, so future default
changes still reach anyone who hasn't overridden that token.

## Card payment reconciliation (`src/lib/reconcile/card-payments.ts`)

Charges are counted when they happen and the payment is excluded, which is the
only way to avoid counting the same money twice. The cost is that a large
payment leaving the account has no visible destination, and the spending it
settled is spread across earlier months under a dozen categories. This puts the
two back together **without changing either number** — it is a view, not an
adjustment.

Attribution runs on the **card side**, not the checking side. Every payment
appears twice, and only the card copy sits on the account whose charges it
settled; matching the checking copy would mean parsing a last-4 out of a
description and hoping.

A payment is attributed to the charges since the *previous payment*. That
approximates a statement cycle rather than reproducing one, so coverage is
reported rather than assumed: well above 100% means an older balance was
cleared too, well below means a balance was carried. Neither is a bug.

`unsettledCharges` is the other half — charges counted as spending whose money
has not left a bank account yet.

## Debt payments: when a card payment counts

A card payment means two different things depending on what else is in the
ledger, which is why this cannot be a classification rule. A rule reads a
description; `reconcile/debt.ts` reads the state of the ledger.

**The card's charges are imported** → the payment is a transfer. The purchases
are the spending, and counting the payment too counts it twice.

**The card's charges are not imported** → the payment is a `debt-payment`, and
it counts. Nothing else represents where that money went, and excluding it
deletes real spending. It is a stand-in for unknown purchases: better than
zero, worse than the truth.

The second state is a **prompt, not a resting place**. The reason written onto
each row says what made it a debt payment and what reverses it, and both the
dashboard and `/cards` urge linking the account — because "$1,430 of debt" is
an admission that the ledger cannot say whether the money went on flights or
groceries.

**Detection works from the payments outward, not the accounts inward.** The
first version enumerated card accounts looking for ones with no charges, which
cannot see a card that was never created as an account at all — an
`APPLECARD GSBANK PAYMENT` sat excluded across two months with nothing behind
it, because there was no Apple Card row to enumerate. A payment is reconciled
only when it resolves to an account that actually holds charges; unresolvable
is treated the same as unlinked.

`reconcileCardPayments()` runs **both directions**. Forward is obvious; the
reverse matters more, because importing a card whose payments are counted as
debt would otherwise count that money twice. Run `db:reconcile-debt` after any
import or sync.

**A Drizzle column reference inside a raw `sql` fragment renders unqualified.**
`${accounts.id}` becomes `"id"`, and inside a subquery over `transactions` that
resolves to the *transaction's* id — so a correlated subquery silently became
`t.account_id = t.id` and reported zero charges for every card. It produced a
wrong answer rather than an error. Prefer a join and a `GROUP BY` over a
correlated subquery in a `sql` template.

## Buffer and goals (`src/lib/buffer.ts`)

The ledger is built entirely from flows, which let it say "you spent more than
you earned" without being able to say whether that mattered. A buffer is a
**stock**, which is why `accounts.balance_cents` exists and is refreshed on
every Plaid sync.

**Everything here is arithmetic on the person's own history.** "Keep three
months of expenses" is advice; "a normal month costs you $X and you hold $Y" is
a measurement. Only the second is defensible without being a financial adviser,
and the UI says so.

**A month counts only when the ledger covers both its edges.** Checking only
the trailing edge produced two wrong answers at once: the first month of
history began on the 26th, so it showed a fortnight of spending against a full
paycheck and looked like a large surplus — and because most bills had not been
paid in that stub, every ordinary monthly expense looked intermittent and got
recommended as a sinking fund.

**Baseline uses the median, not the mean.** One $6,000 project pulls a
three-month mean up by $2,000 and prices the buffer off a month that does not
repeat.

**`available` is not a balance on a credit card.** Plaid reports it as the
remaining credit *line*. Using it subtracted several thousand dollars of unused
borrowing capacity as though it were debt and turned a positive cushion into
−$7,300. Use `current`, and note that on a deposit account `available` would
double-count pending rows the ledger already holds.

**Irregular-expense detection needs three complete months and says so
otherwise.** With two, a bill paid in one and not the other is
indistinguishable from a genuine lump, and the list fills with rent and
insurance. Saying nothing beats recommending a sinking fund for the mortgage.

**`savingsChurn` scans a date range, not complete months.** A liquidation is an
event, not a rate — restricting it to whole months hid a $10,000 withdrawal
because it happened in the month that had not finished, which is exactly when
it is worth knowing.

## Data quality (`src/lib/quality.ts`)

Unclassified rows announce themselves. **Misclassified ones do not** — they sit
in a total, look ordinary, and move a number someone then decides on. A $4,500
mortgage payment filed as Restaurants does not error.

Every check is a **disagreement check**, not a judgement. None decides what a
transaction should be; each finds a place where the ledger contradicts itself,
which is a fact rather than an opinion:

- one merchant filed under several categories, with most rows agreeing and a
  few not — the strongest available signal, since it is the ledger disagreeing
  with itself
- a row twenty times the median of its own category
- money arriving in an expense category, or leaving an income one
- rows with no account, which share one dedupe namespace and can collide

Ordered by **amount, not count**: fifty miscategorized coffees matter less than
one misfiled mortgage payment, and it is the second that moves a decision.

`profileGaps` covers the other silent failure — a missing household size makes
every benchmark comparison wrong for a single person while nothing looks
broken. Both are surfaced in the layout, on every page, because neither will be
found by someone who does not already suspect it.

## Alerts (`src/lib/notify/`)

Web Push, not a hosted service: a browser standard with no third party between
the deployment and the devices, which behaves identically self-hosted. Routing a
household's spending alerts through someone else's infrastructure would be a
strange thing for an app whose premise is that the data stays yours.

**Choosing what to send is the hard half.** Sending is solved; deciding what
justifies an interruption is not, and getting it wrong ends the feature —
people do not tune noisy alerts, they switch them off, and then the useful one
never arrives either. Three rules in `alerts.ts`: only what is actionable or
genuinely surprising, once per logical event rather than per run, and silence
is a valid output.

**Dedupe keys encode the event, not the moment.** `buffer-low-2026-08`, not a
timestamp — so a daily job says it once a month. The key is claimed *before*
sending, so a crash mid-send suppresses a repeat rather than causing one: a
missed alert is recoverable, a notification loop is not.

**Thresholds come from the household's own history.** A large charge is ten
times their median transaction, not a constant — $500 is unremarkable for one
person and alarming for another. Pace is compared against the *pace* of prior
months, since comparing the 8th against a full month would fire every time.

Delivery is **channel-based** — push and SMS are peers, registered rather than
hardcoded, so a deployment can add email, ntfy or Slack without touching the
code that decides *what* to send. That decision is the hard part and should not
be entangled with delivery. The dedupe key is claimed once for all channels, so
an alert is not texted and pushed on one run and texted again on the next.

SMS costs money per message, which changes what belongs on it. The rules
already refuse anything routine; that restraint matters more when noise has a
bill attached.

A subscription belongs to a browser install, not an account, so the toggle
reads its state from the browser: a permission revoked in browser settings
leaves the server's row looking healthy. The permission prompt is only ever
raised from a click, because asking on load is the reliable way to earn a
permanent block.

The service worker deliberately does not cache. A worker caching financial
pages would serve a stale balance after logout.

## Auditing a period

`pnpm db:audit-period [YYYY-MM]` reconciles a month four independent ways
(category-grouped, raw rows, per-account, and a plain count) and itemizes every
excluded row. It exists because the August total moved a great deal while real
bugs were being fixed, and "the number changed again" is indistinguishable from
"the number is wrong" without a way to check.

Correct exclusions come in **pairs** — the debit leaving one account and the
credit arriving in the other — which is what makes them verifiable rather than
merely asserted.

## Pure logic lives outside modules that import the database

Ten modules have been split out for this, the first three being `match.ts` from
`rules.ts`, `dates.ts` from `ledger.ts`, and `reconcile/coverage.ts` from
`card-payments.ts`. [TESTING.md](TESTING.md) keeps the current list. Importing
`@/db` pulls in the whole env schema, which puts anything in that module out of
reach of unit tests. Put testable logic in a DB-free file and re-export it.

The second payoff is that a DB-free module is safe to import from a client
component, so a form can read the exact constant the server validates against
rather than repeating it.

## Gotchas hit while building this

- **ESM hoisting**: `dotenv.config()` at the top of a script runs *after* all
  imports evaluate. Scripts use `tsx --env-file=.env.local` instead.
- **`date_trunc` is not immutable** for `date` args, so it can't be used in an
  index expression. Postgres rejects it with 42P17.
- **Enum params inside `CASE`** need an explicit `::series_status` cast, or
  Postgres can't infer the type of the bound parameter.
- Client components must not import `@/lib/classify` (pulls in the DB) — shared
  constants live in `classify/constants.ts`.

## Commands

`pnpm dev` · `pnpm build` · `pnpm test` · `pnpm typecheck`
`pnpm db:generate` → `pnpm db:migrate` → `pnpm db:seed` (seed is idempotent)
`pnpm db:reclassify` re-runs the pipeline over the whole ledger, skipping
manual rows. Needed after any taxonomy or seed-rule change.
`pnpm db:audit-income` verifies no inflow is being excluded from income.

## Reconciliation — the second dedupe layer

`dedupe_hash` handles re-uploaded statements (byte-identical rows). It cannot
handle a purchase logged by voice against the statement row that later
represents it, so `lib/reconcile/match.ts` scores those fuzzily.

**The two failure modes do not cost the same, and the rule follows from that.**

A miss double-counts — real money. A wrong merge costs only a *label*: the
pending entry can only be consumed once, so the purchase it should have matched
still inserts and the total holds. There is a test asserting exactly this.

So the rule is permissive: **amount and date agree, unless something
contradicts.** Positive corroboration is required only where the amount itself
is inexact (the tip case), because there the tip reading is an inference.

**Category disagreement blocks; merchant disagreement does not** (except on a
tip-adjusted amount). Category is trustworthy because both sides run through
the same classifier. Merchant is not: the logged side is prose, and naming what
you bought rather than where — "new headphones" against `BEST BUY` — reads as a
conflict when it is nothing of the sort. Making merchant conflict decisive
caused misses; `test/reconcile.test.ts` pins both directions.

**The log direction is deliberately stricter than the ingest direction.**
Refusing to add deletes a possibly-real purchase with nothing to show for it,
so a match resting on nothing but amount and date returns `possible_duplicate`
and asks, rather than silently dropping the entry. `confirmNew` overrides.

Manual entries are `pending` / `entry_source = manual`. A statement row that
matches one **absorbs it in place**: statement facts win (date, amount,
description, and a recomputed `dedupe_hash` so re-uploads still no-op), the
user's hand-set category wins, and `logged_amount_cents` keeps what they said
so a wrong merge is visible and reversible at `/review`.

`consumed` in the ingest loop stops one pending entry settling two statement
rows.

## Bank syncing (`src/lib/plaid/`)

Off unless `PLAID_CLIENT_ID`, `PLAID_SECRET` and `PLAID_TOKEN_KEY` are all set
(`hasPlaid`) — credentials without the key would mean storing access tokens in
the clear. Statement upload is unaffected either way; the two sources write to
the same `transactions` table.

**Plaid signs amounts the other way round.** For Plaid a *positive* amount is
money leaving the account. `toLedgerCents` flips it once, at the boundary. Get
this backwards and nothing errors — every purchase becomes income.

**`plaid_transaction_id` is an identity, `dedupe_hash` is a fingerprint.** Plaid
rewrites both the description and the amount when a pending charge settles, so
the hash cannot recognize it; the id can. Sync updates that row in place, which
keeps its category and anything the user answered.

**The overlap guard is a date cutoff, not fuzzy matching.** A linked account
starts syncing the day after its last *statement-imported* transaction. Plaid's
description for a charge rarely normalizes to the same string as the CSV's, so
`dedupe_hash` would not catch the overlap and the month would double. The hash
still runs as a second line of defence.

**Linking adopts an existing account by `last4`** rather than creating a second
one — a split account would put one history in two dedupe namespaces.

Access tokens are AES-256-GCM encrypted (`crypto.ts`), not hashed: unlike MCP
tokens they have to be replayed to Plaid, so they must be recoverable. Rotating
`PLAID_TOKEN_KEY` invalidates every link.

The cursor is committed **per page**, so an interrupted sync resumes rather
than replaying or skipping.

**`transactions/sync` reads Plaid's cache, not the bank.** Plaid refreshes an
Item on its own schedule — often once or twice a day — so a sync without
`transactions/refresh` first faithfully returns yesterday's data and looks like
it worked. That is what "why aren't today's transactions showing" turns out to
be, and nothing about the sync report reveals it.

The refresh is asynchronous, so `refreshFromBank` polls `last_successful_update`
until it advances, bounded at 25s: a slow bank must not hold the sync open, and
syncing stale data beats not syncing. `refreshed` is reported so a stale run is
visible. A backfill skips it — old history gains nothing from a fresh pull.

**Ask for history explicitly.** `days_requested` defaults to **90 days** when
omitted from `linkTokenCreate`, and nothing reports it — the Item links,
transactions arrive, and only a report needing several complete months reveals
that history stops three months back. `HISTORY_DAYS` is 730.

**Extending an existing Item needs Link update mode.** A connection created
under the 90-day default stays at 90 days however many times it syncs, so
"Extend history" is offered on healthy connections and not only broken ones.
The follow-up sync must reset the cursor: older transactions are not *changes*,
so `transactions/sync` would never send them.

**Develop against `PLAID_ENV=sandbox`.** The free Trial plan counts Production
Items on a *lifetime* basis — deleting one does not return the quota — so
re-linking while iterating permanently burns the allowance. `ITEM_LOGIN_REQUIRED`
sets `needs_reauth`, and the Reconnect button opens Link in update mode, which
repairs the Item instead of consuming another.

## Review queue (`src/lib/review-queue.ts`, `review-suggest.ts`)

`/review/queue` answers the two kinds of row that need a person: **queued**
rails (a rule filed them somewhere real and asked anyway) and **low
confidence** (the model was asked and was not sure). Both already count toward
the totals — answering decides attribution, not whether the money exists, and
the page says so.

Ordered by **amount, largest first**, on the same reasoning as `quality.ts`:
someone who answers five and stops should have answered the five that move a
decision.

**`suggestFor` is the whole feature.** A keyboard queue beats a dropdown only
if the answer is usually in the first few keys — current category, then what
this merchant has been before, then what money of this direction usually is.
Sign filters the offers: an income category cannot be the answer for money
going out. The current category is exempt, because a sign mismatch is one of
the things worth reviewing and hiding it would hide the question.

**Do not filter suggestion candidates on `budgetable`.** Every income category
is `budgetable = false` — income is not something you budget — so that filter
silently removed the entire income half of the chart and left every deposit
with nothing but its own current guess. Exclude parents and `uncategorized`
instead.

`applyCorrection` (`classify/correct.ts`) is shared with the transactions
table so there is one place that knows a correction must write
`classification_source = 'manual'` and pass `amountCents` to scope the learned
rule to the corrected direction.

Answering writes a rule **and back-applies it to non-manual history** by
default, which is most of the value and also the risk — the toggle exists so a
one-off (a $6,000 Zelle for contract work) does not refile every future Zelle.

## Install and icons (`src/app/manifest.ts`, `src/lib/icon.ts`)

**The manifest is what makes push work on iOS**, not a nicety. Safari withholds
`Notification.requestPermission` until the site is installed to the Home
Screen, so `display: standalone` plus icons is load-bearing for the whole
alerts feature. `PushToggle` distinguishes iOS-not-yet-installed from genuinely
unsupported and gives the three-tap instruction — reporting "unsupported" there
was wrong and dead-ended the feature on the device most likely to want it.

Requires iOS 16.4+. iPadOS reports itself as `MacIntel`, so `maxTouchPoints`
is what separates it from a desktop.

**Icons are rendered from theme tokens** (`pnpm icons` → `src/db/icons.ts`),
not committed artwork, because nothing here hardcodes a color and a fork
changing the accent should get its own icon. The maskable variant is the same
drawing at a larger inset — a platform crops it to a shape of its choosing, and
listing one file for both purposes clips the mark on Android.

`sw.js` referenced `/icon.png`, which was never generated, so every
notification rendered with the browser default. It also has an **empty** fetch
listener: present so browsers offering install see one, and empty because
calling `respondWith` would put the worker in front of pages full of balances.

`themeToken` exists because `ThemeTokens` is an open record and indexing it
types as `string | undefined`. Only for consumers that need a real string — the
manifest, the chrome color, the icon renderer. CSS reads `var(--color-*)`.

## Rate limiting (`src/lib/http/`)

In-process, because Postgres is the only hard dependency and requiring Redis to
run a personal ledger is a worse trade than the accuracy it buys. Limits are
**cost ceilings, not access control** — `guardApi` has already run.

**Everything here rests on `clientAddress`.** `X-Forwarded-For` is a chain that
each proxy *appends* to, so the leftmost entry is whatever the caller wrote and
only the rightmost `TRUST_PROXY_HOPS` entries mean anything. Reading `[0]` —
which `loginAction` did — let an attacker take a fresh bucket per request to
evade the lockout entirely, or send the owner's address to lock the owner out
from anywhere. Entries are counted from the right; a chain shorter than the
configured hop count is refused rather than partially trusted.

`trustedHops` defaults to 1 on Vercel and 0 elsewhere. Too high is the
dangerous direction, so a non-Vercel deployment must opt in.

Colon *count* decides port-stripping, not the presence of a colon and a dot:
`::ffff:203.0.113.5` has both and was truncated to nothing.

**Credential limits count failures only** (`badCredential`), so a working MCP
client making hundreds of calls never touches them while a token-guesser gets
ten tries per address per quarter hour. `POLICIES.mcp` is the separate
runaway-loop ceiling, keyed on the token so one client cannot shed another's.

**MCP 429s must be JSON-RPC shaped.** Every response on that endpoint is parsed
as JSON-RPC, so the plain `{error}` body used elsewhere reads as a protocol
violation rather than "slow down".

Per-instance means a serverless deployment multiplies every limit by its
instance count. Accepted: the numbers bound the damage even multiplied, and no
secret depends on this alone.

## Backups (`src/db/backup.ts`)

`pnpm db:backup` → gzipped `pg_dump` in `backups/`, last 14 kept, timestamped so
a bad day never overwrites a good one.

**A dump is verified before it is kept.** `pg_dump` against a wiped database
exits zero and writes a valid file with every `CREATE TABLE` and no rows, so the
schema check alone passes on exactly the case that matters. The dumped
`transactions` count is compared to the live count.

`countCopyRows` lives in `dump-text.ts` — `backup.ts` imports `@/lib/env`, which
needs a real database URL to load, and the parsing is the part worth testing.
Its terminator scan is line-by-line on purpose: searching for `\n\.\n` cannot
match a terminator at the start of an empty table's body, so an empty
`transactions` counted the *next* table's rows and passed.

**Errors out of this module are scrubbed** (`scrubError`). The URI must be argv
— libpq only honours `sslmode` from a full connection string — and both
`execFile` and pg_dump echo it, so an ordinary version mismatch printed the
database password in full.

pg_dump refuses to dump a server newer than itself; `checkVersions` turns that
into an install instruction rather than an opaque abort.

**The verification query is schema-qualified.** An unqualified name depends on
`search_path`, and a resuming Neon compute once handed back a session where
`current_schema()` was null — the count failed with "relation transactions does
not exist" against a database that plainly had one, and a perfectly good dump
was discarded. It retries once, and a *failed* check is reported differently
from a *mismatched* one: the first means the dump might be fine, the second
means it is not.

**The Plaid crypto salt is not the project name.** `moneybags.plaid.v1` in
`plaid/crypto.ts` survived the rename to Loot deliberately: it derives the AES
key from `PLAID_TOKEN_KEY`, so changing it makes every stored access token
undecryptable and forces a re-link of every bank — which on Plaid's Trial plan
permanently consumes Item quota.

## MCP

`/api/mcp`, stateless Streamable HTTP, bearer tokens hashed with SHA-256 in
`mcp_tokens`. Fourteen tools: read, log, correct. **No delete tool** — a
misheard instruction must not be able to destroy a record.

Tool descriptions are written for the calling model: they say *when* to reach
for the tool, not just what it does. That is what makes "I just bought coffee"
route to `log_purchase` rather than a search.

`predictCategorySlug` is rules-only on purpose: reconciliation runs inside the
import loop, and a model call per row would make importing unusably slow.

## Deployment

Any Node host plus any Postgres. Vercel + Neon and Docker Compose are both
documented in `docs/deploy.md`; nothing in the code is specific to either.

**Code and schema deploy separately, and the schema goes first.** `db:migrate`
and `db:seed` run against the database directly from a developer machine, so a
live deployment can be running old code against a new schema. That is how a
correction made in the app once wrote a classification rule using a superseded
`derivePattern` after the fix was already written locally. Additive migrations
make the window safe, but deploy right after changing classifier behaviour
rather than eventually.

**On Vercel, SSO deployment protection must stay off** if the MCP server is
used. MCP clients cannot complete an SSO flow, so it makes `/api/mcp`
unreachable. The app has its own auth and the MCP endpoint requires a bearer
token.

`vercel env pull` returns `[SENSITIVE]` rather than the value for env vars
marked sensitive, so secrets cannot be round-tripped back out of Vercel.
