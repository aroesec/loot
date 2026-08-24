import { and, eq, gte, lte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { transactions, categories } from "@/db/schema";
import { dedupeHash, normalizeDescription, toMerchantName } from "@/lib/classify/normalize";
import {
  bestMatch,
  MAX_DAY_GAP,
  type MatchCandidate,
  type MatchResult,
  type MatchTarget,
} from "./match";

export * from "./match";

/** Shift an ISO date by a number of days. */
function shiftDate(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Pending manual entries that could plausibly be the same charge as a statement
 * row landing on `postedOn`. Scoped by date so the scan stays small; the
 * scoring in ./match does the real work.
 */
export async function pendingCandidatesNear(
  postedOn: string,
  excludeIds: Set<string> = new Set(),
): Promise<MatchCandidate[]> {
  const rows = await db
    .select({
      id: transactions.id,
      postedOn: transactions.postedOn,
      amountCents: transactions.amountCents,
      rawDescription: transactions.rawDescription,
      merchant: transactions.merchant,
      categorySlug: categories.slug,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        eq(transactions.status, "pending"),
        eq(transactions.entrySource, "manual"),
        gte(transactions.postedOn, shiftDate(postedOn, -MAX_DAY_GAP)),
        lte(transactions.postedOn, shiftDate(postedOn, MAX_DAY_GAP)),
      ),
    );

  return rows.filter((r) => !excludeIds.has(r.id));
}

export type ReconcileOutcome = {
  transactionId: string;
  match: MatchResult;
  /** Non-zero when the statement charged more than was logged. */
  amountDeltaCents: number;
};

/**
 * Absorb a pending manual entry into the statement row that represents it.
 *
 * The statement is authoritative for the facts — date, amount, description —
 * because it is the bank's record. The user's own judgment is not: a category
 * they set by hand survives, as do their notes. The pre-adjustment amount is
 * kept in `logged_amount_cents` so a wrong merge is visible and reversible
 * rather than silently rewriting what they said.
 */
export async function absorbIntoStatementRow(input: {
  match: MatchResult;
  statementRow: {
    postedOn: string;
    amountCents: number;
    rawDescription: string;
    currency: string;
    dedupeHash: string;
  };
  statementId: string;
  accountId: string | null;
}): Promise<ReconcileOutcome> {
  const { match, statementRow, statementId, accountId } = input;
  const candidateId = match.candidate.id;

  const [existing] = await db
    .select({
      categoryId: transactions.categoryId,
      classificationSource: transactions.classificationSource,
      merchant: transactions.merchant,
      notes: transactions.notes,
      amountCents: transactions.amountCents,
    })
    .from(transactions)
    .where(eq(transactions.id, candidateId))
    .limit(1);

  const userChoseCategory = existing?.classificationSource === "manual";
  const amountChanged = existing
    ? existing.amountCents !== statementRow.amountCents
    : false;

  const normalized = normalizeDescription(statementRow.rawDescription);

  await db
    .update(transactions)
    .set({
      // Facts from the statement.
      postedOn: statementRow.postedOn,
      amountCents: statementRow.amountCents,
      rawDescription: statementRow.rawDescription,
      currency: statementRow.currency,
      dedupeHash: statementRow.dedupeHash,
      statementId,
      accountId,

      // A statement now backs this row, so it is no longer provisional. The
      // recomputed dedupe hash means re-uploading the statement is still a
      // no-op.
      entrySource: "statement",
      status: "cleared",
      reconciledAt: new Date(),
      reconciliationNote: match.explanation,
      loggedAmountCents: amountChanged ? (existing?.amountCents ?? null) : null,

      // A hand-set category is the user's answer and outranks the statement.
      // Otherwise take the statement's cleaner merchant name.
      merchant: userChoseCategory
        ? (existing?.merchant ?? (toMerchantName(normalized) || null))
        : (toMerchantName(normalized) || existing?.merchant || null),

      updatedAt: new Date(),
    })
    .where(eq(transactions.id, candidateId));

  return {
    transactionId: candidateId,
    match,
    amountDeltaCents: amountChanged
      ? statementRow.amountCents - (existing?.amountCents ?? 0)
      : 0,
  };
}

/**
 * The other direction: someone logs a purchase that a statement already
 * covers. Looks across cleared rows too, so "I bought coffee on Tuesday" after
 * Tuesday's statement has landed reports the existing row instead of adding a
 * second one.
 */
export async function findExistingMatch(
  target: MatchTarget,
): Promise<MatchResult | null> {
  const rows = await db
    .select({
      id: transactions.id,
      postedOn: transactions.postedOn,
      amountCents: transactions.amountCents,
      rawDescription: transactions.rawDescription,
      merchant: transactions.merchant,
      categorySlug: categories.slug,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        gte(transactions.postedOn, shiftDate(target.postedOn, -MAX_DAY_GAP)),
        lte(transactions.postedOn, shiftDate(target.postedOn, MAX_DAY_GAP)),
      ),
    );

  /*
   * Reversed from the statement direction. Here the *existing* row may be the
   * statement (already carrying the tip) and the new entry is what the user
   * remembers paying, so the larger amount belongs on the target side for the
   * tip test to read correctly.
   */
  const candidates: MatchCandidate[] = rows;
  const direct = bestMatch(target, candidates);
  if (direct) return direct;

  for (const row of rows) {
    const flipped = bestMatch(
      {
        postedOn: row.postedOn,
        amountCents: row.amountCents,
        rawDescription: row.rawDescription,
        merchant: row.merchant,
        categorySlug: row.categorySlug,
      },
      [
        {
          id: row.id,
          postedOn: target.postedOn,
          amountCents: target.amountCents,
          rawDescription: target.rawDescription,
          merchant: target.merchant ?? null,
          categorySlug: target.categorySlug ?? null,
        },
      ],
    );
    if (flipped) {
      // Report the existing row as the match, not the hypothetical new one.
      return {
        ...flipped,
        candidate: {
          id: row.id,
          postedOn: row.postedOn,
          amountCents: row.amountCents,
          rawDescription: row.rawDescription,
          merchant: row.merchant,
        },
      };
    }
  }

  return null;
}

/** Rows the reconciler merged, for the review queue. */
export async function listReconciled(limit = 50) {
  return db
    .select({
      id: transactions.id,
      postedOn: transactions.postedOn,
      amountCents: transactions.amountCents,
      loggedAmountCents: transactions.loggedAmountCents,
      merchant: transactions.merchant,
      rawDescription: transactions.rawDescription,
      reconciliationNote: transactions.reconciliationNote,
      reconciledAt: transactions.reconciledAt,
    })
    .from(transactions)
    .where(sql`${transactions.reconciledAt} IS NOT NULL`)
    .orderBy(sql`${transactions.reconciledAt} DESC`)
    .limit(limit);
}

/**
 * Undo a merge the user disagrees with: restore the amount they logged and
 * split the statement row back out as its own transaction.
 */
export async function unmergeTransaction(id: string): Promise<boolean> {
  const [row] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, id))
    .limit(1);

  if (!row || row.reconciledAt === null) return false;

  // Re-create the manual entry as it stood before the merge.
  const loggedAmount = row.loggedAmountCents ?? row.amountCents;
  const normalized = normalizeDescription(row.merchant ?? row.rawDescription);
  const hash = await dedupeHash({
    accountId: row.accountId,
    postedOn: row.postedOn,
    amountCents: loggedAmount,
    normalizedDescription: `${normalized} (unmerged ${row.id.slice(0, 8)})`,
  });

  await db.insert(transactions).values({
    accountId: row.accountId,
    postedOn: row.postedOn,
    amountCents: loggedAmount,
    rawDescription: row.merchant ?? row.rawDescription,
    merchant: row.merchant,
    categoryId: row.categoryId,
    classificationSource: row.classificationSource,
    currency: row.currency,
    entrySource: "manual",
    status: "pending",
    dedupeHash: hash,
    notes: "Split back out from a reconciliation you undid.",
  });

  // The statement row keeps the bank's figures and loses the merge metadata.
  await db
    .update(transactions)
    .set({
      reconciledAt: null,
      reconciliationNote: null,
      loggedAmountCents: null,
      updatedAt: new Date(),
    })
    .where(eq(transactions.id, id));

  return true;
}

/** Manual entries still waiting for a statement to confirm them. */
export async function listPending(limit = 100) {
  return db
    .select({
      id: transactions.id,
      postedOn: transactions.postedOn,
      amountCents: transactions.amountCents,
      merchant: transactions.merchant,
      rawDescription: transactions.rawDescription,
      notes: transactions.notes,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.status, "pending"),
        eq(transactions.entrySource, "manual"),
      ),
    )
    .orderBy(sql`${transactions.postedOn} DESC`)
    .limit(limit);
}

/** Bulk-clear pending entries, e.g. after deciding a statement covered them. */
export async function markCleared(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await db
    .update(transactions)
    .set({ status: "cleared", updatedAt: new Date() })
    .where(inArray(transactions.id, ids))
    .returning({ id: transactions.id });
  return result.length;
}
