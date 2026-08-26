import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { transactions } from "@/db/schema";
import { validateSplit, type SplitPart } from "./split-math";

export * from "./split-math";

/**
 * Splitting one transaction into several that sum to it.
 *
 * See `split-math.ts` for why siblings rather than a parent with children.
 *
 * The first sibling is the original row, kept in place with a reduced amount.
 * That preserves the two identities the ledger depends on:
 *
 *   - `dedupe_hash`, so re-uploading the same statement still no-ops. A new set
 *     of rows with new hashes would leave the original hash unclaimed, and the
 *     next re-upload would insert the whole transaction again alongside its own
 *     split parts.
 *   - `plaid_transaction_id`, so a later sync updates the row it already knows
 *     rather than inserting a duplicate.
 *
 * The other siblings get hashes derived from the original so they stay unique
 * without colliding with anything a statement could produce.
 */

export type SplitResult =
  | { ok: true; groupId: string; parts: number }
  | { ok: false; message: string };

function siblingHash(originalHash: string, index: number): string {
  return createHash("sha256").update(`${originalHash}:split:${index}`).digest("hex");
}

export async function splitTransaction(
  transactionId: string,
  parts: SplitPart[],
): Promise<SplitResult> {
  const [original] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, transactionId))
    .limit(1);

  if (!original) return { ok: false, message: "That transaction no longer exists." };

  if (original.splitGroupId) {
    return {
      ok: false,
      message: "That transaction is already part of a split. Undo it first.",
    };
  }

  /*
   * A pending amount is not final. Plaid rewrites it when the charge settles,
   * and that rewrite would land on the first sibling alone, leaving the parts
   * no longer summing to the whole. Refusing is better than producing a total
   * that drifts days later for no visible reason.
   */
  if (original.status === "pending") {
    return {
      ok: false,
      message:
        "This charge is still pending and its amount can change. Split it once it settles.",
    };
  }

  const amount = Number(original.amountCents);
  const check = validateSplit(amount, parts);
  if (!check.ok) return { ok: false, message: check.problem.message };

  const groupId = randomUUID();
  const [first, ...rest] = check.parts;

  await db.transaction(async (tx) => {
    await tx
      .update(transactions)
      .set({
        amountCents: first!.amountCents,
        categoryId: first!.categoryId,
        // The person chose these categories, so they outrank any later pass.
        classificationSource: "manual",
        classificationConfidence: 1,
        classificationReason: "Split by you",
        notes: first!.note ?? original.notes,
        splitGroupId: groupId,
        splitOriginalCents: amount,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, original.id));

    await tx.insert(transactions).values(
      rest.map((p, i) => ({
        accountId: original.accountId,
        statementId: original.statementId,
        postedOn: original.postedOn,
        amountCents: p.amountCents,
        currency: original.currency,
        rawDescription: original.rawDescription,
        merchant: original.merchant,
        categoryId: p.categoryId,
        classificationSource: "manual" as const,
        classificationConfidence: 1,
        classificationReason: "Split by you",
        isTransfer: original.isTransfer,
        notes: p.note ?? null,
        entrySource: original.entrySource,
        status: original.status,
        // Derived, so it is unique and cannot collide with a statement row.
        dedupeHash: siblingHash(original.dedupeHash, i + 1),
        splitGroupId: groupId,
        splitOriginalCents: amount,
      })) as never,
    );
  });

  return { ok: true, groupId, parts: check.parts.length };
}

/**
 * Put a split back together.
 *
 * The original amount is read from `split_original_cents` rather than re-summed
 * from the siblings. Re-summing would faithfully reproduce whatever the parts
 * currently hold, so an edit to one of them would quietly become the new whole.
 */
export async function unsplitTransaction(groupId: string): Promise<SplitResult> {
  const siblings = await db
    .select()
    .from(transactions)
    .where(eq(transactions.splitGroupId, groupId));

  if (siblings.length === 0) return { ok: false, message: "That split no longer exists." };

  // The surviving row is the original: the one whose hash a statement can
  // still produce.
  const keeper =
    siblings.find((s) => s.splitOriginalCents !== null && s.plaidTransactionId) ??
    siblings.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));

  const originalCents = Number(keeper.splitOriginalCents ?? 0);
  if (!originalCents) {
    return { ok: false, message: "The original amount for that split is missing." };
  }

  await db.transaction(async (tx) => {
    for (const s of siblings) {
      if (s.id === keeper.id) continue;
      await tx.delete(transactions).where(eq(transactions.id, s.id));
    }

    await tx
      .update(transactions)
      .set({
        amountCents: originalCents,
        splitGroupId: null,
        splitOriginalCents: null,
        classificationReason: "Split undone",
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, keeper.id));
  });

  return { ok: true, groupId, parts: siblings.length };
}

/** Every split in the ledger, for the audit script. */
export async function splitGroups(): Promise<
  Array<{ groupId: string; parts: number; sumCents: number; originalCents: number }>
> {
  const rows = await db
    .select({
      groupId: transactions.splitGroupId,
      amount: transactions.amountCents,
      original: transactions.splitOriginalCents,
    })
    .from(transactions)
    .where(and(isNotNull(transactions.splitGroupId)));

  const byGroup = new Map<string, { parts: number; sumCents: number; originalCents: number }>();
  for (const r of rows) {
    const g = byGroup.get(r.groupId!) ?? { parts: 0, sumCents: 0, originalCents: 0 };
    g.parts += 1;
    g.sumCents += Number(r.amount);
    g.originalCents = Number(r.original ?? 0);
    byGroup.set(r.groupId!, g);
  }

  return [...byGroup.entries()].map(([groupId, g]) => ({ groupId, ...g }));
}
