# Testing

## Goal

A test is worth having when it proves a user-visible outcome or a non-obvious
invariant. Test count is not a goal.

This app computes numbers people make decisions with, so the failure that
matters is not a crash. It is a total that is quietly wrong and looks
completely ordinary. Tests here exist to catch that, and almost every one in the
suite was written after a specific number came out wrong.

## The economics

Measured on this suite:

| | value |
|---|---|
| Tests | 329 across 27 files |
| Wall clock | 701ms |
| Per test | **2.1ms** |
| Tests that touch a database | **0** |
| Test code as a share of source | 13.6% (3,460 / 25,358 lines) |

The whole suite runs in about half a second, which means it can run on every
save. That is the property to protect. It exists because of one rule, applied
consistently:

**Logic worth testing lives in a module that does not import `@/db`.**

Importing the database pulls in the whole env schema, which needs a live
`DATABASE_URL` to load. A test for such a module needs a database, a schema, and
seed data, and now costs tens of milliseconds instead of one. Fifteen modules
have been split out specifically to stay reachable: `classify/match.ts`,
`dates.ts`, `reconcile/coverage.ts`, `db/dump-text.ts`, `review-suggest.ts`,
`http/client-address.ts`, `tax-lines.ts`, `tax-math.ts`, `logo.ts`,
`people-validate.ts`, `account-kinds.ts`, `mileage.ts`, `budget-rollover.ts`,
`net-worth.ts`, `theme-css.ts`.

The split pays twice. A DB-free module is also safe to import from a client
component, which is why the onboarding form can read the logo's accepted types
straight from the constant the server validates against instead of repeating
the list.

There are 98 modules under `src/lib` and `src/db` and 27 test files. That ratio
is correct and deliberate. **Never add a test file merely because a source file
exists.**

## Hard rules

1. **Two cases per behaviour, not ten.** One representative positive, one
   meaningful negative. A third needs its own reason, stated in the test name.
2. **Extraction is not a licence to enumerate.** Moving a decision into a pure
   function makes cases cheap; it does not make them valuable. A 40-row table
   test of the same branch proves what two rows proved.
3. **No database in the unit suite.** If a test needs one, the logic is in the
   wrong module. Move the logic, not the test.
4. **Test the real exported function.** Not a copy of its logic pasted into the
   test file. That was written here once: a sort comparator was reimplemented in
   the test, so the test passed while proving only that the copy matched itself.
5. **Type-check the tests.** `pnpm typecheck` covers `test/` too. A fixture that
   the schema forbids will otherwise pass green forever.
6. **Never add a test that asserts current behaviour you have not verified is
   correct.** Pinning a bug is worse than no test.

## What to test

### Every invariant in AGENTS.md, over the whole set

The invariants are what make the numbers right, and most are properties of a
*collection* rather than of one case. Assert them across the set, so a future
addition cannot quietly break one:

```ts
// Not "capital one is scoped to debit" — that is one row, checked by hand once.
// This holds for every rule that exists now or is added later.
it("only flags an inflow when the pattern names a payment or an account", () => {
  const canExcludeAnInflow = RULES.filter((r) => r.isTransfer && r.appliesTo !== "debit");
  for (const rule of canExcludeAnInflow) {
    expect(namesAPaymentOrAccount(rule.pattern), `"${rule.pattern}" …`).toBe(true);
  }
});
```

This is the highest-value shape in the suite. When the seed list grew from 5
institutions to 35, this test caught a new rule that would have deleted refunds
from income. Reading 35 rules by hand would not have.

### Regressions, with the cost in the comment

The suite is mostly regressions. Write the comment as what went wrong and what
it cost, not as what the code does:

```ts
/*
 * `mobil` inside `MOBILE PMT` filed a $1,430 card payment as Gas & Fuel and
 * made a filling station the month's top merchant. Short patterns that are
 * prefixes of common words need `\b` anchors.
 */
```

A year later that comment is the reason nobody "simplifies" the anchor away.

### The boundary where a wrong answer is silent

Sign detection, dedupe hashing, normalization, transfer flagging, tax
arithmetic, address parsing. Each of these returns a plausible wrong answer
rather than throwing, which is exactly why they carry the most tests.

## What not to test

- **Framework behaviour.** Next routing, Drizzle's query builder, Zod's parser.
- **Trivial accessors and re-exports.**
- **A restatement of a query predicate.** If the test is the `WHERE` clause
  written twice, it proves nothing.
- **Migrations, because a test can run them.** CI already applies every migration
  to a clean database.
- **UI rendering.** There is no component test suite and there should not be one
  without a reason that names what it would catch.
- **Exhaustive permutations of an implementation detail.**

## The failure modes that have shipped here

Each of these passed review, in this codebase.

**A proxy for the real property.** An anchoring test used pattern *length* to
decide whether a rule was risky. It flagged `aldi`, `lyft` and `exxon`, none of
which are dangerous. Length was never the issue; hiding inside a common word
was. Test the property, not something correlated with it.

**A test that reimplements the thing it tests.** See rule 4.

**A check that passes on exactly the case it exists for.** A backup verified
itself by looking for `CREATE TABLE` in the dump. A dump of a *wiped* database
contains every `CREATE TABLE` and no rows, so the check passed on the one
scenario backups exist for. It compares row counts now.

**A fixture that cannot exist.** TypeScript is stripped at runtime, so a test
asserting a state the schema forbids runs green.

**An assertion the code under test swallows.** An `expect()` inside a callback
that the caller wraps in `try/catch` cannot fail the test.

**A green suite hiding a live bug.** The suite was green while login throttling
keyed on a caller-controlled header, and while the review queue silently
excluded every income category. Both were found by running the thing and reading
the output. A passing suite is evidence, not proof.

## Verifying against the real thing

Some things cannot be proven by a unit test, and for those, run them:

- **Backups**: dump, restore into a scratch database, compare row counts and
  summed cents against the source. An untested restore is not a backup.
- **Rate limits**: send the requests. Twelve spoofed chain entries behind one
  trusted hop must land in a single bucket.
- **Migrations**: `pnpm db:migrate` from empty, then `pnpm db:seed` twice to
  prove idempotency. CI does this on every push.
- **Ledger totals**: `pnpm db:audit-period YYYY-MM` reconciles a month four
  independent ways and itemizes every excluded row. Run it after touching
  classification, and read the exclusions — correct ones come in pairs.
- **The whole app, cold**: clone into a temp directory, set the three required
  variables, migrate, seed, build, start. That is the path every new user takes
  and the one nobody exercises by accident.

When verifying against production data, **never paste it into a test, a comment,
or a commit message.** Round the amounts and change the names.

## Adding a test

Pick the cheapest layer that can prove the outcome:

1. A DB-free unit test on an extracted function. Almost always this.
2. A property asserted over a whole collection, when the invariant is about the
   set rather than one case.
3. A manual verification run, recorded in the PR description, when it needs a
   real database, a real HTTP request, or a real file.

If a proposed test does not state in one sentence which invariant it protects or
which regression it pins, do not add it.

## Simplifying an existing test module

1. Read `AGENTS.md`, `DESIGN.md`, the production module and its tests before
   editing. Record the test count.
2. For each test, write the invariant it proves in one sentence. If you cannot,
   it goes.
3. Collapse near-identical cases to one positive and one negative. Keep the one
   with the most informative failure message.
4. Replace any test that reimplements production logic with one that imports it.
5. If a test needs a database, move the logic to a DB-free module instead of
   keeping the test.
6. Report before and after counts, and what each removed case is now covered by.
