import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "./index";
import { categories, merchantRules, transactions } from "./schema";
import { formatCents } from "@/lib/money";

/**
 * Every inflow in the ledger, and whether it counted as income.
 *
 * Income can only be lost one way. The totals sum by sign, so a positive
 * amount counts whatever category it landed in — an imperfect category still
 * counts. The single thing that removes it is `is_transfer`, which is why this
 * report is organized around that flag rather than around categories.
 *
 * The second half checks the rules rather than the data: it lists every rule
 * that is *able* to flag an inflow, so a rule that would swallow income can be
 * caught before the deposit that triggers it ever arrives. A bare institution
 * name here is the thing to look at — "capital one" once matched both a card
 * payment going out and a cashback redemption coming in.
 */
export async function auditIncome(): Promise<{
  counted: number;
  excluded: number;
  risky: number;
}> {
  const inflows = await db
    .select({
      postedOn: transactions.postedOn,
      amountCents: transactions.amountCents,
      merchant: transactions.merchant,
      rawDescription: transactions.rawDescription,
      slug: categories.slug,
      kind: categories.kind,
      isTransfer: transactions.isTransfer,
      source: transactions.classificationSource,
      reason: transactions.classificationReason,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(gt(transactions.amountCents, 0))
    .orderBy(desc(transactions.amountCents));

  let counted = 0;
  let excluded = 0;

  const kept = inflows.filter((r) => !r.isTransfer);
  const dropped = inflows.filter((r) => r.isTransfer);

  console.log(`\nCOUNTED AS INCOME (${kept.length})`);
  for (const r of kept) {
    counted += r.amountCents;
    console.log(
      `  ${r.postedOn}  ${formatCents(r.amountCents).padStart(12)}  ` +
        `${(r.slug ?? "—").padEnd(24)} ${r.rawDescription.slice(0, 40)}`,
    );
  }

  console.log(`\nNOT COUNTED — excluded by is_transfer (${dropped.length})`);
  if (dropped.length === 0) {
    console.log("  none");
  }
  for (const r of dropped) {
    excluded += r.amountCents;
    console.log(
      `  ${r.postedOn}  ${formatCents(r.amountCents).padStart(12)}  ` +
        `${(r.slug ?? "—").padEnd(24)} ${r.rawDescription.slice(0, 40)}`,
    );
    console.log(`      why: ${r.reason ?? "no reason recorded"}`);
    console.log(
      "      This is only correct if the same money is already counted " +
        "elsewhere in the ledger.",
    );
  }

  /*
   * A rule can exclude an inflow when it sets the transfer flag and is not
   * restricted to debits. That is legitimate for a rule whose pattern names a
   * payment outright, and a mistake for one that only names an institution.
   */
  const risky = await db
    .select({
      pattern: merchantRules.pattern,
      appliesTo: merchantRules.appliesTo,
      priority: merchantRules.priority,
      source: merchantRules.source,
      slug: categories.slug,
    })
    .from(merchantRules)
    .leftJoin(categories, eq(merchantRules.categoryId, categories.id))
    .where(
      and(
        eq(merchantRules.isTransfer, true),
        eq(merchantRules.enabled, true),
        sql`${merchantRules.appliesTo} <> 'debit'`,
      ),
    )
    .orderBy(desc(merchantRules.priority), merchantRules.pattern);

  console.log(`\nRULES THAT CAN EXCLUDE AN INFLOW (${risky.length})`);
  console.log(
    "  Each should either name a payment outright, or name the other account.",
  );
  for (const r of risky) {
    console.log(
      `  ${r.pattern.padEnd(24)} ${r.appliesTo.padEnd(7)} p=${String(r.priority).padEnd(4)} ` +
        `-> ${r.slug ?? "—"} (${r.source})`,
    );
  }

  console.log(
    `\ncounted ${formatCents(counted)} · excluded ${formatCents(excluded)}`,
  );
  return { counted, excluded, risky: risky.length };
}

if (process.argv[1]?.endsWith("audit-income.ts")) {
  auditIncome()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("income audit failed", err);
      process.exit(1);
    });
}
