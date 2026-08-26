import { sql } from "drizzle-orm";
import { db } from "@/db";
import { transactions } from "@/db/schema";

/**
 * Whether this deployment has been set up yet.
 *
 * The question a first run has to answer is personal or business, and it is the
 * one question that is expensive to get wrong: it decides which chart of
 * accounts the classifier uses, so a month spent in the wrong mode is a month
 * of transactions filed against categories no report in that mode reads.
 *
 * Before this existed the choice was a control in Settings that nothing pointed
 * at, so the answer was whichever default happened to be there.
 *
 * "Set up" means the person has been asked, not that they answered a particular
 * way. `onboarded_at` records the asking. Inferring it from the presence of
 * transactions would re-open the flow for anyone who deleted their last row,
 * and would skip it for anyone who imported before being asked.
 */

export type OnboardingState = {
  needed: boolean;
  hasTransactions: boolean;
};

export async function onboardingState(): Promise<OnboardingState> {
  const [row] = await db
    .select({
      onboardedAt: sql<string | null>`(SELECT onboarded_at::text FROM settings WHERE id = 'singleton')`,
      transactionCount: sql<number>`count(*)::int`,
    })
    .from(transactions);

  return {
    needed: !row?.onboardedAt,
    hasTransactions: (row?.transactionCount ?? 0) > 0,
  };
}

export async function markOnboarded(): Promise<void> {
  await db.execute(sql`
    INSERT INTO settings (id, onboarded_at)
    VALUES ('singleton', now())
    ON CONFLICT (id) DO UPDATE SET onboarded_at = now(), updated_at = now()
  `);
}

/**
 * Let someone run through it again.
 *
 * Switching mode after the fact is supported and does not reclassify anything,
 * so this is only for re-answering the questions, not for undoing a month.
 */
export async function resetOnboarding(): Promise<void> {
  await db.execute(sql`UPDATE settings SET onboarded_at = NULL WHERE id = 'singleton'`);
}
