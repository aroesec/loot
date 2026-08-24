# Bank syncing with Plaid

**You can skip this entirely.** Uploading statements is a complete way to use
Loot, and it means one fewer third party holding credentials to your bank.
Read the trade-off below before deciding.

---

## Should you?

**Reasons to sync.** Transactions appear without you exporting anything.
Pending charges show up before they post. Multiple accounts stay current
without a monthly chore.

**Reasons not to.** Plaid holds a long-lived credential to your bank. The free
tier has a trap (below) that is easy to walk into. And statement upload gives
you the same ledger with a few minutes of work a month.

If you are unsure, start with statements. Nothing about the ledger changes if
you add syncing later — the sync adapter writes to the same tables.

## The free-tier trap

Plaid's Trial plan is genuinely free — 10 Production Items, transactions
included, no expiry — but:

> **The 10-Item limit is a lifetime counter, not a concurrent one.** Deleting a
> connection does not return the quota.

An Item is one login at one institution, not one account. Chase checking plus
two Chase cards under one login is **one** Item. So ten is generous — unless
you burn them debugging.

**Develop against sandbox.** Set `PLAID_ENV=sandbox` and use the test
credentials `user_good` / `pass_good`. Sandbox is unlimited and free. Only
switch to production when the flow works end to end.

## Setup

1. Create an account at [dashboard.plaid.com](https://dashboard.plaid.com) and
   verify your email.

2. **Apply for the Trial plan.** This is the step that makes it free, and it is
   also what gets you Chase without completing Plaid's Security Questionnaire —
   which is otherwise required for several large banks.

3. Copy your credentials from **Keys**. Note that Plaid issues a **different
   secret per environment** — the sandbox secret will not work in production
   and vice versa. Mixing them up produces `INVALID_API_KEYS`, which is the
   most common setup failure.

4. Generate a token encryption key:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```

5. Set all four:

   ```bash
   PLAID_CLIENT_ID="..."
   PLAID_SECRET="..."          # the sandbox secret, to start
   PLAID_ENV="sandbox"
   PLAID_TOKEN_KEY="..."       # from step 4
   ```

   All four are required together. Credentials without the key would mean
   storing bank access tokens in the clear, so the feature stays off instead.

6. Restart, then **Settings → Connected banks → Connect a bank**.

Loot never sees your bank credentials. Plaid Link runs in its own iframe
and your bank's OAuth page handles the login; what comes back is a one-time
token the server exchanges for a read-only access token.

## Going live

Change `PLAID_SECRET` to your production secret and `PLAID_ENV` to
`production`, then redeploy. Each successful connection now permanently uses
one of your ten.

## How syncing behaves

**Existing accounts are adopted, not duplicated.** An account already in your
ledger with a matching last-4 gets linked to Plaid rather than recreated, so
imported history stays attached. Adoption is refused if that account already
belongs to a different institution — four digits are not unique across banks.

**A linked account starts syncing the day after its last imported
transaction.** Plaid's description for a charge rarely normalizes to the same
string as your CSV's, so the dedupe fingerprint would not catch the overlap and
the month would double. The cutoff is blunt and exact. A small first pull on an
account you have already imported is the cutoff working, not a failure — check
with `pnpm db:plaid-status`.

**An account with no history pulls everything Plaid offers**, often around two
years. Expect the first sync of a new card to take a while and add a lot.

**Pending charges are tracked through settlement.** Plaid's transaction id is a
real identity, so when a pending charge posts at a different amount with a
different description, that row is updated in place and keeps the category you
gave it.

## When a connection breaks

Banks expire authorizations, and a password change usually kills them. The
connection shows **Reconnect**, which opens Link in update mode and repairs the
existing Item — it does not consume another from your ten.

## Turning it off

Unset the Plaid variables and restart. Syncing disappears; every transaction it
already imported stays exactly where it is.
