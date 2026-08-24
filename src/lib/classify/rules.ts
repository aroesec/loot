import { and, eq, ne, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { merchantRules, transactions, categories } from "@/db/schema";
import type { MerchantRule } from "@/db/schema";
import { normalizeDescription } from "./normalize";
import { ledgerMode } from "@/lib/mode";
import {
  matchRule,
  derivePattern,
  sortRules,
  LEARNED_PRIORITY,
} from "./match";

// Re-exported so the many existing `from "./rules"` imports keep working; the
// implementations live in ./match, which has no database behind it.
export {
  matchRule,
  derivePattern,
  sortRules,
  LEARNED_PRIORITY,
  SEED_PRIORITY,
  type RuleMatch,
} from "./match";

/**
 * Rules change rarely and are read on every classified transaction, so the set
 * is cached per server instance and invalidated whenever a rule is written.
 */
let cache: { rules: MerchantRule[]; loadedAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

export function invalidateRuleCache(): void {
  cache = null;
}

export async function loadRules(force = false): Promise<MerchantRule[]> {
  if (!force && cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.rules;
  }

  /*
   * Only the active chart of accounts. Both sets live in the table and several
   * patterns appear in each — "internal transfer" means the same thing to a
   * person and a business but points at a different category — so loading both
   * would make the winner depend on insertion order.
   */
  const mode = await ledgerMode();
  const rows = await db
    .select()
    .from(merchantRules)
    .where(
      and(eq(merchantRules.enabled, true), eq(merchantRules.mode, mode)),
    );

  // Sorted once here, because matchRule takes the first hit and so depends on
  // the order. Same comparator the tests build their fixture with.
  const sorted = sortRules(rows);
  cache = { rules: sorted, loadedAt: Date.now() };
  return sorted;
}

/** Fire-and-forget usage stats; never allowed to fail a classification run. */
export async function recordRuleHits(ruleIds: string[]): Promise<void> {
  const unique = [...new Set(ruleIds)];
  if (unique.length === 0) return;
  try {
    await db
      .update(merchantRules)
      .set({
        hitCount: sql`${merchantRules.hitCount} + 1`,
        lastMatchedAt: new Date(),
      })
      .where(inArray(merchantRules.id, unique));
  } catch (err) {
    console.error("failed to record rule hits", err);
  }
}

export type LearnResult = {
  rule: MerchantRule;
  created: boolean;
  /** Other transactions retroactively updated by the new rule. */
  applied: number;
};

/**
 * Turn a manual correction into a rule, then apply it to matching transactions
 * that were not themselves set by hand. This is the learning loop: every
 * correction makes the next import cheaper and more accurate.
 */
export async function learnFromCorrection(input: {
  rawDescription: string;
  categoryId: string;
  merchantName?: string | null;
  isTransfer?: boolean;
  /**
   * The corrected transaction's amount. Used to scope the learned rule to the
   * direction the correction was actually about — pass it whenever it is
   * known, which is everywhere a real correction happens.
   */
  amountCents?: number | null;
  /** Overrides the direction inferred from `amountCents`. */
  appliesTo?: "any" | "debit" | "credit";
  /** When false the rule is stored but not back-applied to history. */
  backfill?: boolean;
}): Promise<LearnResult | null> {
  const pattern = derivePattern(input.rawDescription);
  if (!pattern) return null;

  /*
   * A correction is evidence about one direction, not both. Defaulting to
   * "any" let a rule learned from an outgoing payment classify incoming money:
   * correcting a Zelle *to* someone wrote a rule that then filed a Zelle
   * *from* someone as the same expense category. The user only ever said what
   * the outgoing one was.
   *
   * Inferring from the sign is also the safe direction to be wrong in. Too
   * narrow means the opposite direction goes to the model, which classifies it
   * and counts it. Too broad silently relabels money the user never spoke to.
   */
  const appliesTo =
    input.appliesTo ??
    (input.amountCents == null || input.amountCents === 0
      ? "any"
      : input.amountCents < 0
        ? "debit"
        : "credit");

  // A correction made in one chart of accounts teaches a rule in that chart.
  const mode = await ledgerMode();

  const existing = await db
    .select()
    .from(merchantRules)
    .where(
      and(
        eq(merchantRules.pattern, pattern),
        eq(merchantRules.matchType, "contains"),
        eq(merchantRules.appliesTo, appliesTo),
        eq(merchantRules.mode, mode),
      ),
    )
    .limit(1);

  let rule: MerchantRule;
  let created = false;

  if (existing[0]) {
    const updated = await db
      .update(merchantRules)
      .set({
        categoryId: input.categoryId,
        merchantName: input.merchantName ?? existing[0].merchantName,
        isTransfer: input.isTransfer ?? existing[0].isTransfer,
        // Promote a seed rule that the user has now corrected.
        priority: Math.max(existing[0].priority, LEARNED_PRIORITY),
        source: "learned",
        enabled: true,
      })
      .where(eq(merchantRules.id, existing[0].id))
      .returning();
    rule = updated[0]!;
  } else {
    const inserted = await db
      .insert(merchantRules)
      .values({
        pattern,
        matchType: "contains",
        categoryId: input.categoryId,
        merchantName: input.merchantName ?? null,
        isTransfer: input.isTransfer ?? false,
        appliesTo,
        mode,
        priority: LEARNED_PRIORITY,
        source: "learned",
      })
      .returning();
    rule = inserted[0]!;
    created = true;
  }

  invalidateRuleCache();

  let applied = 0;
  if (input.backfill !== false) {
    // Only touch rows the user has not decided on themselves. A manual
    // classification is the user's answer and outranks any rule.
    const result = await db
      .update(transactions)
      .set({
        categoryId: rule.categoryId,
        merchant: rule.merchantName ?? transactions.merchant,
        isTransfer: rule.isTransfer,
        classificationSource: "rule",
        classificationConfidence: 1,
        classificationReason: `Matched learned rule "${rule.pattern}"`,
        matchedRuleId: rule.id,
        updatedAt: new Date(),
      })
      .where(
        and(
          ne(transactions.classificationSource, "manual"),
          sql`lower(${transactions.rawDescription}) LIKE ${"%" + pattern + "%"}`,
          // A direction-scoped rule must not rewrite the other side.
          appliesTo === "debit"
            ? sql`${transactions.amountCents} < 0`
            : appliesTo === "credit"
              ? sql`${transactions.amountCents} > 0`
              : sql`true`,
        ),
      )
      .returning({ id: transactions.id });
    applied = result.length;
  }

  return { rule, created, applied };
}

/** Re-run every rule over the whole ledger. Used after bulk rule edits. */
export async function reapplyAllRules(): Promise<{
  scanned: number;
  updated: number;
}> {
  const rules = await loadRules(true);
  const rows = await db
    .select({
      id: transactions.id,
      rawDescription: transactions.rawDescription,
      amountCents: transactions.amountCents,
      categoryId: transactions.categoryId,
      isTransfer: transactions.isTransfer,
      classificationSource: transactions.classificationSource,
    })
    .from(transactions)
    .where(ne(transactions.classificationSource, "manual"));

  let updated = 0;
  for (const row of rows) {
    const match = matchRule(
      normalizeDescription(row.rawDescription),
      rules,
      row.amountCents,
    );
    if (!match) continue;

    /*
     * A queued rule files the row but does not answer it, so re-applying it
     * must not mark the row answered — writing source "rule" at confidence 1
     * would silently drop it out of the review queue. Refresh the merchant and
     * leave the rest as it stands.
     */
    if (match.queueForReview) {
      if (!match.merchantName) continue;
      await db
        .update(transactions)
        .set({ merchant: match.merchantName, updatedAt: new Date() })
        .where(eq(transactions.id, row.id));
      continue;
    }

    /*
     * A merchant-only rule has no category to apply. Relabel the merchant and
     * leave the category alone rather than blanking a good answer.
     */
    if (match.categoryId === null) {
      if (!match.merchantName) continue;
      await db
        .update(transactions)
        .set({ merchant: match.merchantName, updatedAt: new Date() })
        .where(eq(transactions.id, row.id));
      continue;
    }

    if (
      match.categoryId === row.categoryId &&
      match.isTransfer === row.isTransfer
    ) {
      continue;
    }

    await db
      .update(transactions)
      .set({
        categoryId: match.categoryId,
        merchant: match.merchantName ?? undefined,
        isTransfer: match.isTransfer,
        classificationSource: "rule",
        classificationConfidence: 1,
        classificationReason: `Matched rule "${match.rule.pattern}"`,
        matchedRuleId: match.rule.id,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, row.id));
    updated += 1;
  }

  return { scanned: rows.length, updated };
}

/** slug -> id, used when seeding and when the LLM returns a slug. */
export async function categorySlugMap(): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: categories.id, slug: categories.slug })
    .from(categories);
  return new Map(rows.map((r) => [r.slug, r.id]));
}

/**
 * Predicts a category from the rules alone, without touching the model.
 *
 * Used by the reconciler, which needs a category for an incoming statement row
 * *before* that row exists in the database. It is deliberately rules-only:
 * reconciliation runs inside the import loop, and a model call per row would
 * make importing a statement unusably slow. A miss just means the category
 * signal is unavailable for that row, which the matcher treats as unknown.
 */
export async function predictCategorySlug(
  description: string,
  amountCents: number | null = null,
): Promise<string | null> {
  const rules = await loadRules();
  const match = matchRule(normalizeDescription(description), rules, amountCents);
  // A merchant-only rule (a payment rail) carries no category signal.
  if (!match || match.categoryId === null) return null;

  const [row] = await db
    .select({ slug: categories.slug })
    .from(categories)
    .where(eq(categories.id, match.categoryId))
    .limit(1);

  return row?.slug ?? null;
}
