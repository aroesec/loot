import { eq, inArray, isNull, or, and, ne } from "drizzle-orm";
import { db } from "@/db";
import { transactions, categories, accounts } from "@/db/schema";
import { hasLlm } from "@/lib/env";
import { normalizeDescription, toMerchantName } from "./normalize";
import { loadRules, matchRule, recordRuleHits } from "./rules";
import { classifyAll, type CategoryOption, type ClassifiableTransaction } from "./llm";
import { UNCATEGORIZED } from "./taxonomy";
import { BUSINESS_UNCATEGORIZED } from "./taxonomy-business";
import { ledgerMode } from "@/lib/mode";
import { REVIEW_THRESHOLD } from "./constants";
import type { Usage } from "@/lib/ai";

export * from "./normalize";
export * from "./rules";
export * from "./taxonomy";

export type ClassifyReport = {
  total: number;
  byRule: number;
  byLlm: number;
  /** Sent to the review queue by a rule, without spending a model call. */
  queuedForReview: number;
  unclassified: number;
  lowConfidence: number;
  usage: Usage;
  ms: number;
  llmError?: string;
};

export { REVIEW_THRESHOLD } from "./constants";

async function loadCategoryOptions(): Promise<{
  options: CategoryOption[];
  slugToId: Map<string, string>;
  uncategorizedSlug: string;
  mode: "personal" | "business";
}> {
  /*
   * Only the active chart of accounts is offered to the classifier. Showing a
   * business ledger the personal categories would invite "groceries" where the
   * answer is "materials", and the two sets overlap enough to be confusing.
   */
  const mode = await ledgerMode();
  const rows = await db
    .select({
      id: categories.id,
      slug: categories.slug,
      name: categories.name,
      kind: categories.kind,
      hint: categories.hint,
      parentId: categories.parentId,
    })
    .from(categories)
    .where(eq(categories.mode, mode));

  const nameById = new Map(rows.map((r) => [r.id, r.name]));

  // Parent rows are groupings, not destinations — offering them to the
  // classifier invites "shopping" when "groceries" was the right answer.
  const parentIds = new Set(
    rows.map((r) => r.parentId).filter((v): v is string => Boolean(v)),
  );

  const options: CategoryOption[] = rows
    .filter((r) => !parentIds.has(r.id))
    .map((r) => ({
      slug: r.slug,
      name: r.name,
      kind: r.kind,
      hint: r.hint,
      parentName: r.parentId ? (nameById.get(r.parentId) ?? null) : null,
    }));

  return {
    options,
    slugToId: new Map(rows.map((r) => [r.slug, r.id])),
    uncategorizedSlug: mode === "business" ? BUSINESS_UNCATEGORIZED : UNCATEGORIZED,
    mode,
  };
}

/**
 * The hybrid pipeline.
 *
 *   1. Deterministic rules run first — free, instant, and consistent. Anything
 *      a rule can answer never reaches the model. A rule may also answer
 *      "nobody can read this but you" and send the row straight to the review
 *      queue, which is how payment rails are handled.
 *   2. Whatever is left goes to the configured model in batches, if one is
 *      configured at all.
 *   3. Anything still unresolved lands in Uncategorized rather than a guess.
 *
 * Manually-classified rows are never touched, in any step.
 */
export async function classifyTransactions(
  transactionIds: string[],
  opts: { useLlm?: boolean; onProgress?: (done: number, total: number) => void } = {},
): Promise<ClassifyReport> {
  const started = Date.now();
  const report: ClassifyReport = {
    total: 0,
    byRule: 0,
    byLlm: 0,
    queuedForReview: 0,
    unclassified: 0,
    lowConfidence: 0,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
    ms: 0,
  };

  if (transactionIds.length === 0) return report;

  const rows = await db
    .select({
      id: transactions.id,
      rawDescription: transactions.rawDescription,
      postedOn: transactions.postedOn,
      amountCents: transactions.amountCents,
      accountKind: accounts.kind,
      classificationSource: transactions.classificationSource,
    })
    .from(transactions)
    .leftJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(inArray(transactions.id, transactionIds));

  const pending = rows.filter((r) => r.classificationSource !== "manual");
  report.total = pending.length;
  if (pending.length === 0) {
    report.ms = Date.now() - started;
    return report;
  }

  const [rules, { options, slugToId, uncategorizedSlug, mode }] = await Promise.all([
    loadRules(),
    loadCategoryOptions(),
  ]);

  // --- Pass 1: rules -------------------------------------------------------
  const unmatched: ClassifiableTransaction[] = [];
  const hitRuleIds: string[] = [];

  for (const row of pending) {
    const normalized = normalizeDescription(row.rawDescription);
    const match = matchRule(normalized, rules, row.amountCents);

    /*
     * Queueing is independent of whether the rule supplied a category, because
     * "where does this money count" and "what was it for" are separate
     * questions. A payment rail answers the first — it is spending, and it
     * counts today — while leaving the second to the user. Filing it and
     * asking are not alternatives.
     */
    if (match?.queueForReview) {
      const categoryId = match.categoryId ?? slugToId.get(uncategorizedSlug);
      if (categoryId) {
        hitRuleIds.push(match.rule.id);
        await db
          .update(transactions)
          .set({
            categoryId,
            merchant: match.merchantName ?? (toMerchantName(normalized) || null),
            isTransfer: match.isTransfer,
            // Deliberately not "rule": the row has a home, not an answer.
            // Confidence 0 is what keeps it in the review queue.
            classificationSource: "unclassified",
            classificationConfidence: 0,
            classificationReason: match.merchantName
              ? `${match.merchantName} doesn't record what the money was for — counted as spending, pick a category`
              : "The description doesn't say what this was for — counted as spending, pick a category",
            matchedRuleId: match.rule.id,
            updatedAt: new Date(),
          })
          .where(eq(transactions.id, row.id));
        report.queuedForReview += 1;
        continue;
      }
    }

    if (match?.categoryId) {
      await db
        .update(transactions)
        .set({
          categoryId: match.categoryId,
          merchant: match.merchantName ?? (toMerchantName(normalized) || null),
          isTransfer: match.isTransfer,
          classificationSource: "rule",
          classificationConfidence: 1,
          classificationReason: `Matched rule "${match.rule.pattern}"`,
          matchedRuleId: match.rule.id,
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, row.id));

      hitRuleIds.push(match.rule.id);
      report.byRule += 1;
    } else {
      /*
       * Either nothing matched, or a merchant-only rule did. A merchant-only
       * rule settles the merchant and hands the category to the model, because
       * the name it recognized says nothing about what was bought.
       */
      if (match) {
        hitRuleIds.push(match.rule.id);
        if (match.merchantName) {
          await db
            .update(transactions)
            .set({ merchant: match.merchantName, updatedAt: new Date() })
            .where(eq(transactions.id, row.id));
        }
      }
      unmatched.push({
        id: row.id,
        postedOn: row.postedOn,
        amountCents: row.amountCents,
        rawDescription: row.rawDescription,
        accountKind: row.accountKind,
        merchantHint: match?.merchantName ?? null,
      });
    }
  }

  void recordRuleHits(hitRuleIds);
  // Queued rows are done too — they just ended at the review queue rather
  // than at a category.
  const settledByRules = report.byRule + report.queuedForReview;
  opts.onProgress?.(settledByRules, pending.length);

  // --- Pass 2: model -------------------------------------------------------
  const shouldUseLlm = (opts.useLlm ?? true) && hasLlm && unmatched.length > 0;
  const resolved = new Set<string>();

  if (shouldUseLlm) {
    try {
      const result = await classifyAll(unmatched, options, {
        mode,
        onProgress: (done) =>
          opts.onProgress?.(settledByRules + done, pending.length),
      });
      report.usage = result.usage;

      for (const c of result.classifications) {
        const categoryId = slugToId.get(c.categorySlug);
        if (!categoryId) continue;

        const source = unmatched.find((t) => t.id === c.id);
        const normalized = source
          ? normalizeDescription(source.rawDescription)
          : "";

        await db
          .update(transactions)
          .set({
            categoryId,
            merchant:
              c.merchant ??
              source?.merchantHint ??
              (toMerchantName(normalized) || null),
            isTransfer: c.isTransfer,
            classificationSource: "llm",
            classificationConfidence: c.confidence,
            classificationReason: c.reason,
            matchedRuleId: null,
            updatedAt: new Date(),
          })
          .where(eq(transactions.id, c.id));

        resolved.add(c.id);
        report.byLlm += 1;
        if (c.confidence < REVIEW_THRESHOLD) report.lowConfidence += 1;
      }
    } catch (err) {
      // A model failure must not lose the import. The rows stay unclassified
      // and can be retried from the UI.
      report.llmError = err instanceof Error ? err.message : String(err);
      console.error("LLM classification failed:", err);
    }
  }

  // --- Pass 3: floor -------------------------------------------------------
  const leftovers = unmatched.filter((t) => !resolved.has(t.id));
  if (leftovers.length > 0) {
    const uncategorizedId = slugToId.get(uncategorizedSlug);
    if (uncategorizedId) {
      for (const t of leftovers) {
        const normalized = normalizeDescription(t.rawDescription);
        await db
          .update(transactions)
          .set({
            categoryId: uncategorizedId,
            merchant: t.merchantHint ?? (toMerchantName(normalized) || null),
            classificationSource: "unclassified",
            classificationConfidence: 0,
            classificationReason: report.llmError
              ? "Automatic classification was unavailable"
              : "No rule matched and no confident category was found",
            updatedAt: new Date(),
          })
          .where(eq(transactions.id, t.id));
      }
    }
    report.unclassified = leftovers.length;
  }

  report.ms = Date.now() - started;
  return report;
}

/** Re-run classification over everything not yet placed by a human. */
export async function classifyPending(limit = 500): Promise<ClassifyReport> {
  const rows = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        ne(transactions.classificationSource, "manual"),
        or(
          isNull(transactions.categoryId),
          eq(transactions.classificationSource, "unclassified"),
        ),
      ),
    )
    .limit(limit);

  return classifyTransactions(rows.map((r) => r.id));
}
