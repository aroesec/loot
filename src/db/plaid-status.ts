import { desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "./index";
import { accounts, plaidItems, transactions } from "./schema";
import { formatCents } from "@/lib/money";

/**
 * What is linked, what it covers, and where each account's sync boundary sits.
 *
 * The cutoff column is the thing worth checking after a first link: an account
 * with existing statement rows only syncs *after* its last imported date, so a
 * surprisingly small first pull is usually correct rather than broken.
 */
export async function plaidStatus(): Promise<void> {
  const items = await db
    .select()
    .from(plaidItems)
    .orderBy(desc(plaidItems.createdAt));

  if (items.length === 0) {
    console.log("No banks linked yet.");
    return;
  }

  for (const item of items) {
    console.log(
      `\n${item.institutionName ?? "Bank"}  [${item.status}]` +
        (item.errorCode ? `  error=${item.errorCode}` : "") +
        (item.lastSyncedAt
          ? `  last synced ${item.lastSyncedAt.toISOString()}`
          : "  never synced"),
    );
    console.log(`  cursor: ${item.cursor ? "set" : "none (next sync is a full pull)"}`);

    const linked = await db
      .select({
        id: accounts.id,
        name: accounts.name,
        kind: accounts.kind,
        last4: accounts.last4,
      })
      .from(accounts)
      .where(eq(accounts.plaidItemId, item.id))
      .orderBy(accounts.name);

    for (const a of linked) {
      const [stats] = await db
        .select({
          total: sql<number>`count(*)::int`,
          fromPlaid: sql<number>`count(*) filter (where ${transactions.plaidTransactionId} is not null)::int`,
          fromStatement: sql<number>`count(*) filter (where ${transactions.plaidTransactionId} is null)::int`,
          cutoff: sql<string | null>`max(${transactions.postedOn}) filter (where ${transactions.plaidTransactionId} is null)`,
          earliest: sql<string | null>`min(${transactions.postedOn})`,
          latest: sql<string | null>`max(${transactions.postedOn})`,
          net: sql<string>`coalesce(sum(${transactions.amountCents}), 0)`,
        })
        .from(transactions)
        .where(eq(transactions.accountId, a.id));

      console.log(
        `  ${a.name}${a.last4 ? ` ••${a.last4}` : ""} (${a.kind.replace("_", " ")})`,
      );
      console.log(
        `     ${stats?.total ?? 0} rows — ${stats?.fromPlaid ?? 0} synced, ${stats?.fromStatement ?? 0} from statements` +
          `${stats?.earliest ? `, ${stats.earliest} to ${stats.latest}` : ""}`,
      );
      console.log(
        `     sync cutoff: ${stats?.cutoff ? `after ${stats.cutoff}` : "none — full history"}` +
          `   net ${formatCents(Number(stats?.net ?? 0), { signed: true })}`,
      );
    }
  }

  const [unlinked] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(accounts)
    .where(sql`${accounts.plaidItemId} is null`);
  if ((unlinked?.count ?? 0) > 0) {
    console.log(`\n${unlinked!.count} account(s) not linked to any bank.`);
  }
}

if (process.argv[1]?.endsWith("plaid-status.ts")) {
  plaidStatus()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("status failed", err);
      process.exit(1);
    });
}
