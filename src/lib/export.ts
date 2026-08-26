import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  budgets,
  categories,
  goals,
  merchantRules,
  recurringSeries,
  transactions,
} from "@/db/schema";
import { toCsv } from "./export-csv";

/**
 * Getting the whole ledger back out.
 *
 * The README says the data stays yours. That claim is only worth anything if
 * leaving is easy, and before this the only exit was `pg_dump` — a database
 * administrator's exit, not a user's. An export nobody can perform is the same
 * as no export.
 *
 * Two shapes, because they answer different questions. **CSV** is for opening
 * in a spreadsheet or handing to an accountant: one row per transaction, joined
 * out to readable names rather than foreign keys. **JSON** is for moving to
 * another deployment or another tool: everything the person created, including
 * the rules and corrections that are original work and exist nowhere else.
 *
 * Deliberately excluded: Plaid access tokens (a live credential, and useless
 * elsewhere), push subscriptions (bound to a browser install), MCP token hashes,
 * and notification history. None of it is the person's *ledger*, and the first
 * three are things an export should never hand out.
 */

export type ExportBundle = {
  exportedAt: string;
  application: string;
  formatVersion: number;
  counts: Record<string, number>;
  accounts: unknown[];
  categories: unknown[];
  transactions: unknown[];
  merchantRules: unknown[];
  budgets: unknown[];
  goals: unknown[];
  recurringSeries: unknown[];
};

/**
 * One row per transaction, with names instead of ids.
 *
 * A foreign key is not portable: the export is read somewhere the categories
 * table does not exist, so a `category_id` column would be a dead reference.
 */
export async function transactionsCsv(): Promise<string> {
  const rows = await db
    .select({
      date: transactions.postedOn,
      amount: transactions.amountCents,
      currency: transactions.currency,
      description: transactions.rawDescription,
      merchant: transactions.merchant,
      category: categories.name,
      categorySlug: categories.slug,
      account: accounts.name,
      isTransfer: transactions.isTransfer,
      source: transactions.classificationSource,
      confidence: transactions.classificationConfidence,
      reason: transactions.classificationReason,
      notes: transactions.notes,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(accounts, eq(transactions.accountId, accounts.id))
    .orderBy(asc(transactions.postedOn));

  return toCsv(
    [
      "date",
      "amount",
      "currency",
      "description",
      "merchant",
      "category",
      "category_slug",
      "account",
      "is_transfer",
      "classified_by",
      "confidence",
      "reason",
      "notes",
    ],
    rows.map((r) => [
      r.date,
      // Dollars, not cents. A spreadsheet is the whole point of this format,
      // and nobody wants to divide a column by 100 before they can use it.
      (Number(r.amount) / 100).toFixed(2),
      r.currency,
      r.description,
      r.merchant,
      r.category,
      r.categorySlug,
      r.account,
      r.isTransfer,
      r.source,
      r.confidence,
      r.reason,
      r.notes,
    ]),
  );
}

/** Everything the person created, in a shape another deployment can read. */
export async function exportBundle(): Promise<ExportBundle> {
  const [acct, cats, txns, rules, budg, gls, series] = await Promise.all([
    db.select().from(accounts),
    db.select().from(categories),
    db.select().from(transactions).orderBy(asc(transactions.postedOn)),
    db.select().from(merchantRules),
    db.select().from(budgets),
    db.select().from(goals),
    db.select().from(recurringSeries),
  ]);

  /*
   * `bigint` columns come back as BigInt, which `JSON.stringify` throws on
   * rather than serializing. Amounts are emitted as strings so no precision is
   * lost on the way out; a float would defeat the point of storing cents.
   */
  const plain = (rows: unknown[]) =>
    rows.map((row) =>
      Object.fromEntries(
        Object.entries(row as Record<string, unknown>).map(([k, v]) => [
          k,
          typeof v === "bigint" ? v.toString() : v instanceof Date ? v.toISOString() : v,
        ]),
      ),
    );

  return {
    exportedAt: new Date().toISOString(),
    application: "loot",
    formatVersion: 1,
    counts: {
      accounts: acct.length,
      categories: cats.length,
      transactions: txns.length,
      merchantRules: rules.length,
      budgets: budg.length,
      goals: gls.length,
      recurringSeries: series.length,
    },
    accounts: plain(acct),
    categories: plain(cats),
    transactions: plain(txns),
    merchantRules: plain(rules),
    budgets: plain(budg),
    goals: plain(gls),
    recurringSeries: plain(series),
  };
}
