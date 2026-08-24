# Extending Loot

Four seams, in rough order of how often people need them.

---

## 1. The taxonomy

`src/lib/classify/taxonomy.ts` holds `DEFAULT_CATEGORIES` and `SEED_RULES`.
Both are seeded into the database on first run and are editable afterwards from
Settings — the file is the default, not the source of truth.

A category's `hint` is written for the classifier, so phrase it as a decision
rule rather than a definition. Compare:

```ts
// Weak: restates the name.
hint: "Money spent on groceries."

// Useful: tells the model how to decide a hard case.
hint: "Supermarkets and grocery stores. Warehouse clubs default here unless clearly fuel."
```

After editing, `pnpm db:seed` then `pnpm db:reclassify`. Seeding upserts rules
in place and removes retired ones, but only where `source = 'seed'` — a rule
you corrected is promoted to `learned` and is never clobbered.

## 2. Merchant rules

A rule is a pattern matched against the *normalized* description. It can do
four things, and they compose:

```ts
{ pattern: "trader joe", category: "groceries", merchant: "Trader Joe's" }
```

**Direction-scoped.** The same description often means opposite things by sign.
Money out to a brokerage is a contribution; the same name arriving is a
withdrawal.

```ts
{ pattern: "fid bkg svc", category: "investments",           appliesTo: "debit" },
{ pattern: "fid bkg svc", category: "investment-withdrawal", appliesTo: "credit" },
```

**Merchant-only** (`category: null`). Names the merchant and leaves the
category to the model. This is how payment rails work — "venmo" says how money
moved, never what it bought.

**Queued** (`queueForReview: true`). Files the row *and* asks the user, because
the description structurally cannot answer the question. `Zelle payment to JORDAN
30000000000` is a name and a reference number; the model reads it and says
Uncategorized every time, so queueing skips the call and asks the person.

Two traps worth knowing:

- `contains` matches **inside words**. `"mobil"` also sits in `MOBILE PMT`,
  which once filed a $1,430 card payment as gas. Short patterns that prefix
  common words need `matchType: "regex"` with `\b` anchors.
- A rule that sets `isTransfer` on an **inflow** removes it from income
  entirely. Only do that when the pattern names a payment outright
  (`"payment thank you"`) or names the other account (`"chk ..."`). A bare
  institution name earns neither — money arriving *from* an issuer is cashback
  or a refund. `pnpm db:audit-income` lists every rule currently able to do it.

## 3. Transaction sources

`src/lib/sources/index.ts`. Everything downstream sees only
`ParsedTransaction[]`, so a new import format is an adapter and nothing else.

```ts
import { registerFileSource } from "@/lib/sources";

registerFileSource({
  id: "my-bank",
  label: "My Bank CSV",
  accepts: ({ mimeType, filename }) => filename.startsWith("mybank-"),
  parse: ({ bytes, accountKind }) => ({
    transactions: rows.map((r) => ({
      postedOn: r.date,          // ISO yyyy-mm-dd
      amountCents: r.cents,      // NEGATIVE = money out
      rawDescription: r.memo,    // verbatim; the normalizer wants the noise
    })),
    warnings: [],
  }),
});
```

Register before `@/lib/sources/builtin` is imported, or add it to that file.
First accepting adapter wins, so registration order is priority order.

Three things adapters get wrong:

**Sign.** `amountCents` must be negative for money leaving. This is the only
error nothing downstream can detect — it produces a coherent-looking ledger
that is entirely backwards.

**Over-cleaning the description.** Pass the bank's string through verbatim.
`normalize.ts` prefers leaving a word in over taking one out, because rules
match on `contains`: a leftover city name costs nothing, while eating a real
word silently breaks every rule that depended on it.

**Guessing at an all-positive file.** Some exports write spending as positive
and need negating wholesale — but doing that to a deposit-heavy month turns
every paycheck into spending. Use `accountKind`: flip freely for a credit card,
never for checking or savings.

### Sync sources

A `SyncSource` pulls incrementally against a stored cursor rather than parsing
bytes. `src/lib/plaid/` is the reference implementation. If you add another
aggregator, the two things worth copying are:

- **A stable per-transaction id**, stored on the row. A fingerprint cannot
  survive a pending charge settling at a different amount with a different
  description; an id can, and lets you update in place without losing the
  user's category.
- **A cutoff.** Start syncing the day *after* an account's last
  statement-imported transaction, or you will re-import history that the
  fingerprint will not catch, because the aggregator's description rarely
  normalizes to the same string as the bank's CSV.

Commit the cursor per page, after that page's rows are written. An interrupted
sync should resume, not replay and not skip.

## 4. MCP tools

`src/lib/mcp/tools.ts`. Tool descriptions are written for the calling model:
say *when* to reach for the tool, not just what it does. That is what makes "I
just bought coffee" route to `log_purchase` instead of a search.

There is deliberately **no delete tool**. A misheard instruction must not be
able to destroy a record.

---

## Working on the classifier

`CLAUDE.md` documents why things are the way they are, usually with the bug
that caused them. Several regressions are pinned by tests in `test/`, and the
comments say what breaks if you undo them.

Two rules of thumb:

**Don't touch `normalize.ts` casually.** `dedupe_hash` is derived from the
normalized description, so changing normalization changes every hash — and
re-uploading an already-imported statement then inserts duplicates instead of
no-ops. Write patterns against what the normalizer already produces.

**Prefer under-matching to over-matching.** A rule that never fires again costs
one re-correction. A rule that over-matches silently rewrites history you have
already checked.

## 5. Benchmarks

`src/lib/benchmarks`. The ledger can say what a category costs and whether it
moved; it cannot say whether it is *high*. That answer lives outside your data,
so it comes from a provider.

```ts
import { registerBenchmarkProvider } from "@/lib/benchmarks";

registerBenchmarkProvider({
  id: "my-region",
  label: "Adjusted for my metro",
  covers: (household) => household.country === "US",
  benchmarks: (household) => [
    {
      categorySlug: "groceries",
      monthlyCents: 95_000 * Math.max(1, household.adults),
      source: "Regional cost-of-living index, adjusted",
      asOf: 2025,
    },
  ],
});
```

Later providers override earlier ones **per category**, so you can correct a
handful of figures without restating the shipped set. Register before
`@/lib/benchmarks` loads, or add to the list in its `index.ts`.

Three rules the shipped provider follows, and yours should:

**Carry the source and the vintage.** A number without a citation is
indistinguishable from one that was invented, and published averages are
revised annually. `source` and `asOf` are required and are shown to the user.

**Scale for household size.** A per-person grocery figure compared against a
family's spending is not a comparison. Per-household figures scale
sub-linearly — a second adult does not double the electricity bill — which is
why the shipped provider uses a square-root adjustment rather than multiplying.

**Return nothing rather than a guess.** `covers()` returning false shows no
comparison at all, which is the honest output for a country or household the
provider does not know. A category with no benchmark is omitted, never assumed
to be fine.

The shipped US provider uses the USDA Food Plans for groceries and the BLS
Consumer Expenditure Survey for everything else. Both are means rather than
medians and national rather than regional, so sitting under one is weaker
evidence than it looks. **Check the figures against the current releases before
relying on them** — they were transcribed at the vintage marked on each.
