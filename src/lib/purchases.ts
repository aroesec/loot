import { eq } from "drizzle-orm";
import { db } from "@/db";
import { transactions, categories, accounts } from "@/db/schema";
import { dedupeHash, normalizeDescription, toMerchantName } from "./classify/normalize";
import { classifyTransactions } from "./classify";
import { predictCategorySlug } from "./classify/rules";
import { findExistingMatch, type MatchResult } from "./reconcile";
import { formatCents } from "./money";

/**
 * Recording a purchase someone told us about, rather than one read off a
 * statement.
 *
 * These land as `pending`: real enough to count toward the month immediately,
 * provisional until a statement confirms them. The reconciler in ./reconcile
 * settles them later.
 */

export type LogPurchaseInput = {
  /** What was bought, or where. Free text — "coffee at Blue Bottle". */
  description: string;
  /** Positive dollars. Direction is decided by `kind`. */
  amount: number;
  /** ISO date. Defaults to today. */
  postedOn?: string;
  kind?: "expense" | "income";
  categorySlug?: string | null;
  accountName?: string | null;
  notes?: string | null;
  /**
   * Record it even if it looks like something already in the ledger. Set this
   * only after the person has confirmed it really is a separate purchase.
   */
  confirmNew?: boolean;
};

export type LogPurchaseResult =
  | {
      status: "recorded";
      id: string;
      postedOn: string;
      amountCents: number;
      merchant: string | null;
      categoryName: string | null;
      categorySlug: string | null;
      confidence: number | null;
      summary: string;
    }
  | {
      status: "already_recorded";
      existingId: string;
      match: MatchResult;
      summary: string;
    }
  | {
      status: "possible_duplicate";
      existingId: string;
      match: MatchResult;
      summary: string;
    };

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Resolves the relative dates people actually say. Anything else is left to
 * the caller to pass as ISO — guessing at "last Tuesday" is how you end up
 * with a purchase in the wrong month.
 */
export function resolveDate(input: string | undefined): string {
  if (!input) return todayIso();

  const trimmed = input.trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const now = Date.now();
  const day = 86_400_000;
  if (trimmed === "today") return todayIso();
  if (trimmed === "yesterday") return new Date(now - day).toISOString().slice(0, 10);
  if (trimmed === "tomorrow") return new Date(now + day).toISOString().slice(0, 10);

  const daysAgo = trimmed.match(/^(\d+)\s+days?\s+ago$/);
  if (daysAgo) {
    return new Date(now - Number(daysAgo[1]) * day).toISOString().slice(0, 10);
  }

  const parsed = Date.parse(input);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10);

  return todayIso();
}

export async function logPurchase(
  input: LogPurchaseInput,
): Promise<LogPurchaseResult> {
  const description = input.description.trim();
  if (!description) throw new Error("A description is required.");
  if (!Number.isFinite(input.amount) || input.amount === 0) {
    throw new Error("An amount is required.");
  }

  const postedOn = resolveDate(input.postedOn);
  const magnitude = Math.round(Math.abs(input.amount) * 100);
  // Stored negative for spending, matching the ledger's convention everywhere.
  const amountCents = input.kind === "income" ? magnitude : -magnitude;

  const normalized = normalizeDescription(description);
  const merchant = toMerchantName(normalized) || null;

  /*
   * Before creating anything, check whether the ledger already has this
   * charge. Someone saying "I bought coffee Tuesday" after Tuesday's statement
   * landed should be told it's already there, not given a second copy.
   */
  const existing = await findExistingMatch({
    postedOn,
    amountCents,
    rawDescription: description,
    merchant,
    // Predicted the same way the reconciler predicts it for statement rows, so
    // both directions compare like with like.
    categorySlug:
      input.categorySlug ??
      (await predictCategorySlug(description, amountCents)),
  });

  /*
   * The two directions are not symmetric, so they are not treated the same.
   *
   * When a *statement* absorbs a pending entry, a wrong match costs a label:
   * the entry can only be consumed once, so the purchase it should have
   * matched still inserts and the total holds. Merging freely is right there.
   *
   * Refusing to *add* is different — it deletes a purchase that may be real,
   * and the total is wrong with nothing to show it. So a match resting on
   * nothing but the amount and the date is reported for confirmation rather
   * than acted on.
   */
  if (existing && !input.confirmNew) {
    const what =
      existing.candidate.merchant ?? existing.candidate.rawDescription;
    const when = existing.candidate.postedOn;
    const howMuch = formatCents(existing.candidate.amountCents);

    if (existing.evidence === "amount_and_date_only") {
      return {
        status: "possible_duplicate",
        existingId: existing.candidate.id,
        match: existing,
        summary: `This might already be in your ledger: ${what} for ${howMuch} on ${when} — ${existing.explanation}. Nothing was added yet. Ask whether that is the same purchase; if it is a separate one, log it again with confirm_new set.`,
      };
    }

    return {
      status: "already_recorded",
      existingId: existing.candidate.id,
      match: existing,
      summary: `That looks like it is already in your ledger: ${what} for ${howMuch} on ${when} — ${existing.explanation}. Nothing was added.`,
    };
  }

  let accountId: string | null = null;
  if (input.accountName) {
    const [acct] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.name, input.accountName))
      .limit(1);
    accountId = acct?.id ?? null;
  }

  let categoryId: string | null = null;
  if (input.categorySlug) {
    const [cat] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, input.categorySlug))
      .limit(1);
    categoryId = cat?.id ?? null;
  }

  // A manual entry gets its own hash namespace: the date and description are
  // what the person said, not what the bank will print, so it must not collide
  // with the statement row that later settles it.
  const hash = await dedupeHash({
    accountId,
    postedOn,
    amountCents,
    normalizedDescription: `manual:${normalized}:${Date.now()}`,
  });

  const [row] = await db
    .insert(transactions)
    .values({
      accountId,
      postedOn,
      amountCents,
      rawDescription: description,
      merchant,
      categoryId,
      classificationSource: categoryId ? "manual" : "unclassified",
      classificationConfidence: categoryId ? 1 : null,
      classificationReason: categoryId ? "Set when logged" : null,
      entrySource: "manual",
      status: "pending",
      dedupeHash: hash,
      notes: input.notes ?? null,
    })
    .returning({ id: transactions.id });

  const id = row!.id;

  // Categorize it the same way an imported row would be, unless told.
  if (!categoryId) {
    await classifyTransactions([id]);
  }

  const [final] = await db
    .select({
      merchant: transactions.merchant,
      amountCents: transactions.amountCents,
      postedOn: transactions.postedOn,
      confidence: transactions.classificationConfidence,
      categoryName: categories.name,
      categorySlug: categories.slug,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(eq(transactions.id, id))
    .limit(1);

  return {
    status: "recorded",
    id,
    postedOn: final?.postedOn ?? postedOn,
    amountCents: final?.amountCents ?? amountCents,
    merchant: final?.merchant ?? merchant,
    categoryName: final?.categoryName ?? null,
    categorySlug: final?.categorySlug ?? null,
    confidence: final?.confidence ?? null,
    summary: `Logged ${formatCents(final?.amountCents ?? amountCents)} at ${
      final?.merchant ?? merchant ?? description
    } on ${final?.postedOn ?? postedOn} under ${
      final?.categoryName ?? "Uncategorized"
    }. It is marked pending until a statement confirms it, and will not be counted twice when that statement is imported.`,
  };
}
