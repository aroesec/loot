import { eq, isNull, sql } from "drizzle-orm";
import { db } from "./index";
import { accounts, transactions } from "./schema";
import { dedupeHash, normalizeDescription } from "@/lib/classify/normalize";

/**
 * One-off: give the pre-account transactions a real account, and re-derive
 * their dedupe hashes to match.
 *
 * `dedupe_hash` is sha256(account, date, amount, normalized description), and
 * every row imported before accounts existed hashed the literal "no-account".
 * That has two consequences, and this script exists for both:
 *
 *   - All accounts share one namespace, so a $5.00 Starbucks charged to a card
 *     on the same day as a $5.00 Starbucks on checking produces an identical
 *     hash and the second one is silently swallowed as a duplicate. That is
 *     invisible data loss, and it starts the moment a second account arrives.
 *
 *   - Setting account_id without re-hashing is worse than leaving it alone:
 *     re-uploading the same statement would then hash against the real account,
 *     miss the stored hash, and insert a full duplicate set.
 *
 * Idempotent — rows that already have an account are left alone.
 */
export async function backfillAccounts(input: {
  name: string;
  last4: string;
  institution?: string | null;
}): Promise<{ accountId: string; moved: number; rehashed: number }> {
  const existing = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.last4, input.last4))
    .limit(1);

  const accountId =
    existing[0]?.id ??
    (
      await db
        .insert(accounts)
        .values({
          name: input.name,
          kind: "checking",
          institution: input.institution ?? null,
          last4: input.last4,
        })
        .returning({ id: accounts.id })
    )[0]!.id;

  const orphans = await db
    .select({
      id: transactions.id,
      postedOn: transactions.postedOn,
      amountCents: transactions.amountCents,
      rawDescription: transactions.rawDescription,
    })
    .from(transactions)
    .where(isNull(transactions.accountId));

  let rehashed = 0;
  for (const row of orphans) {
    const hash = await dedupeHash({
      accountId,
      postedOn: row.postedOn,
      amountCents: row.amountCents,
      normalizedDescription: normalizeDescription(row.rawDescription),
    });
    await db
      .update(transactions)
      .set({ accountId, dedupeHash: hash, updatedAt: new Date() })
      .where(eq(transactions.id, row.id));
    rehashed += 1;
  }

  return { accountId, moved: orphans.length, rehashed };
}

/**
 * Create the card accounts a statement referred to, so imports can be filed.
 *
 * `last4` is optional and never invented. It is what `resolveAccount` matches a
 * PDF statement on, so a placeholder would be worse than nothing: it would
 * silently claim some other card's statement. Without it the account still
 * works, it just has to be picked by hand at upload.
 */
export async function ensureAccount(input: {
  name: string;
  kind: "checking" | "savings" | "credit_card" | "investment" | "loan" | "cash";
  last4?: string | null;
  institution?: string | null;
}): Promise<{ id: string; created: boolean }> {
  const existing = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(
      input.last4
        ? eq(accounts.last4, input.last4)
        : eq(accounts.name, input.name),
    )
    .limit(1);
  if (existing[0]) return { id: existing[0].id, created: false };

  const [row] = await db
    .insert(accounts)
    .values({
      name: input.name,
      kind: input.kind,
      institution: input.institution ?? null,
      last4: input.last4 ?? null,
    })
    .returning({ id: accounts.id });
  return { id: row!.id, created: true };
}

if (process.argv[1]?.endsWith("backfill-accounts.ts")) {
  /*
   * Adopts transactions imported before any account existed.
   *
   *   ACCOUNT_NAME="Everyday Checking" ACCOUNT_LAST4=1234 \
   *   ACCOUNT_INSTITUTION=Chase pnpm db:backfill-accounts
   */
  const name = process.env.ACCOUNT_NAME;
  const last4 = process.env.ACCOUNT_LAST4;

  if (!name || !last4) {
    console.error(
      "Set ACCOUNT_NAME and ACCOUNT_LAST4.\n" +
        '  ACCOUNT_NAME="Everyday Checking" ACCOUNT_LAST4=1234 pnpm db:backfill-accounts',
    );
    process.exit(1);
  }

  backfillAccounts({
    name,
    last4,
    institution: process.env.ACCOUNT_INSTITUTION ?? null,
  })
    .then(async (r) => {
      console.log(
        `${name}: adopted ${r.moved} unassigned rows, re-hashed ${r.rehashed}`,
      );
      const remaining = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(transactions)
        .where(isNull(transactions.accountId));
      console.log(
        `transactions still without an account: ${remaining[0]?.count ?? 0}`,
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error("backfill failed", err);
      process.exit(1);
    });
}
