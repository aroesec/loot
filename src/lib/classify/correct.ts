import { eq } from "drizzle-orm";
import { db } from "@/db";
import { categories, transactions } from "@/db/schema";
import { learnFromCorrection } from "./rules";

/**
 * Recording that the user has said what a transaction actually was.
 *
 * Shared by every surface that can correct a category — the transactions table,
 * the review queue — so there is one place that knows what a correction has to
 * do. Two of those steps are easy to forget and silently wrong when omitted:
 *
 *   - `classification_source = 'manual'`, which is what every automated pass
 *     filters on. Without it the next `db:reclassify` overwrites the answer.
 *   - passing `amountCents` into the learned rule, which scopes it to the
 *     direction the correction was about. The user said what the *outgoing*
 *     Zelle was; a rule that also claims the incoming one is an invention.
 */

export type CorrectionResult =
  | { ok: true; categoryName: string; learned: boolean }
  | { ok: false; reason: "not-found" };

export async function applyCorrection(input: {
  transactionId: string;
  categoryId: string;
  /** Write a merchant rule so the same description is filed this way next time. */
  learn: boolean;
}): Promise<CorrectionResult> {
  const [row] = await db
    .select({
      rawDescription: transactions.rawDescription,
      merchant: transactions.merchant,
      amountCents: transactions.amountCents,
    })
    .from(transactions)
    .where(eq(transactions.id, input.transactionId))
    .limit(1);
  if (!row) return { ok: false, reason: "not-found" };

  const [category] = await db
    .select({ kind: categories.kind, name: categories.name })
    .from(categories)
    .where(eq(categories.id, input.categoryId))
    .limit(1);
  if (!category) return { ok: false, reason: "not-found" };

  /*
   * The flag follows the category's kind rather than being set separately.
   * `is_transfer` decides whether the money counts at all, so leaving it behind
   * when the category moves is how a payment ends up excluded from every total
   * while displaying a perfectly sensible category name.
   */
  const isTransfer = category.kind === "transfer";

  await db
    .update(transactions)
    .set({
      categoryId: input.categoryId,
      isTransfer,
      classificationSource: "manual",
      classificationConfidence: 1,
      classificationReason: "Set by you",
      updatedAt: new Date(),
    })
    .where(eq(transactions.id, input.transactionId));

  if (input.learn) {
    await learnFromCorrection({
      rawDescription: row.rawDescription,
      categoryId: input.categoryId,
      merchantName: row.merchant,
      isTransfer,
      // Scopes the rule to the direction the correction was about.
      amountCents: row.amountCents,
    });
  }

  return { ok: true, categoryName: category.name, learned: input.learn };
}
