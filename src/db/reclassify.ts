import { ne } from "drizzle-orm";
import { db } from "./index";
import { transactions } from "./schema";
import { classifyTransactions } from "@/lib/classify";
import { invalidateRuleCache } from "@/lib/classify/rules";

/**
 * Re-run the full classification pipeline over the whole ledger.
 *
 * Needed after a taxonomy change, because seed rules only decide a row's
 * category at the moment it is classified — fixing a wrong rule does nothing
 * to the history that rule already mislabelled.
 *
 * Manual classifications are excluded, as everywhere else: the user's answer
 * outranks any rule or model output, and a taxonomy change is not a reason to
 * overwrite it.
 */
export async function reclassifyAll(
  opts: { useLlm?: boolean } = {},
): Promise<{ scanned: number }> {
  invalidateRuleCache();

  const rows = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(ne(transactions.classificationSource, "manual"));

  const report = await classifyTransactions(
    rows.map((r) => r.id),
    { useLlm: opts.useLlm ?? true },
  );

  console.log(
    `reclassified ${report.total}: ${report.byRule} by rule, ` +
      `${report.byLlm} by model, ${report.queuedForReview} queued for review, ` +
      `${report.unclassified} uncategorized ` +
      `(${report.lowConfidence} low-confidence) in ${report.ms}ms`,
  );
  if (report.llmError) console.error("model pass failed:", report.llmError);

  return { scanned: rows.length };
}

if (process.argv[1]?.endsWith("reclassify.ts")) {
  reclassifyAll({ useLlm: !process.argv.includes("--no-llm") })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("reclassify failed", err);
      process.exit(1);
    });
}
