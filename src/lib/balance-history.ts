import { sql } from "drizzle-orm";
import { db } from "@/db";
import { accountBalances } from "@/db/schema";

/**
 * Recording what an account held today.
 *
 * Called from both the places a balance can change — a Plaid sync and someone
 * typing one in — so the history does not depend on which one a deployment
 * happens to use. Without the manual path there is no line at all for the
 * majority of people, who run this without bank credentials.
 *
 * Upserted per day rather than appended: four syncs in a day should leave the
 * day holding its latest figure, not four rows that make a chart look like it
 * is sampling noise.
 */
export async function recordBalance(
  accountId: string,
  balanceCents: number,
  on: string = new Date().toISOString().slice(0, 10),
): Promise<void> {
  await db
    .insert(accountBalances)
    .values({ accountId, capturedOn: on, balanceCents })
    .onConflictDoUpdate({
      target: [accountBalances.accountId, accountBalances.capturedOn],
      set: { balanceCents: sql`excluded.balance_cents` },
    });
}
