import { and, desc, eq, gte, lte, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, categories, incomePlans, transactions } from "@/db/schema";
import { monthBounds } from "@/lib/dates";
import { ledgerMode } from "@/lib/mode";
import { activeIncomePlans, incomePlanInput, projectIncome, type IncomePlan } from "./logic";

export class IncomePlanError extends Error {}
export async function listIncomePlans() {
  return db.select().from(incomePlans).orderBy(desc(incomePlans.effectiveMonth));
}
export async function incomeProjection(month: string) {
  const { start, end } = monthBounds(month);
  const [plans, rows] = await Promise.all([
    db.select().from(incomePlans).where(lte(incomePlans.effectiveMonth, month)),
    db.select().from(transactions).where(and(gte(transactions.postedOn, start), lte(transactions.postedOn, end), gt(transactions.amountCents, 0), eq(transactions.isTransfer, false), eq(transactions.status, "cleared"))),
  ]);
  return projectIncome({ month, plans, transactions: rows, receivedIncomeCents: rows.reduce((sum, row) => sum + row.amountCents, 0) });
}
export async function recentPaychecks() {
  const rows = await db.select({ id: transactions.id, name: transactions.merchant, pattern: transactions.rawDescription, accountId: accounts.id, amountCents: transactions.amountCents, postedOn: transactions.postedOn })
    .from(transactions).innerJoin(categories, eq(transactions.categoryId, categories.id))
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(and(eq(categories.slug, "salary"), gt(transactions.amountCents, 0), eq(transactions.isTransfer, false), eq(transactions.status, "cleared"), isNull(accounts.archivedAt)))
    .orderBy(desc(transactions.postedOn)).limit(100);
  return rows.filter((row, i) => rows.findIndex((other) => other.accountId === row.accountId && other.pattern === row.pattern) === i);
}
export async function saveIncomePlan(input: IncomePlan) {
  const plan = incomePlanInput.parse(input);
  if (await ledgerMode() !== "personal") throw new IncomePlanError("Income plans are available in personal mode.");
  return db.transaction(async (tx) => {
    // Serializes overlapping source edits and retries without duplicating plans.
    await tx.execute(sql`select pg_advisory_xact_lock(71839211)`);
    const [account] = await tx.select().from(accounts).where(and(eq(accounts.id, plan.accountId), isNull(accounts.archivedAt)));
    if (!account || !["checking", "savings", "cash"].includes(account.kind) || account.currency !== "USD") throw new IncomePlanError("Choose an active USD bank or cash account.");
    const rows = await tx.select().from(incomePlans);
    if (!rows.some((row) => row.sourceId === plan.sourceId) && new Set(rows.map((row) => row.sourceId)).size >= 20) throw new IncomePlanError("You can track up to 20 income sources.");
    // A literal overlap could consume the same paycheck in two different plans.
    const revisions = [...rows.filter((row) => row.sourceId !== plan.sourceId || row.effectiveMonth !== plan.effectiveMonth), plan];
    const months = new Set(revisions.map((row) => row.effectiveMonth));
    const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
    for (const month of months) {
      const active = activeIncomePlans({ month, plans: revisions });
      const source = active.find((row) => row.sourceId === plan.sourceId);
      if (source && active.some((row) => row.sourceId !== source.sourceId && row.accountId === source.accountId && (normalize(row.pattern).includes(normalize(source.pattern)) || normalize(source.pattern).includes(normalize(row.pattern))))) {
        throw new IncomePlanError("That description overlaps another income source. Edit the existing source or use a more specific description.");
      }
    }
    await tx.insert(incomePlans).values(plan).onConflictDoUpdate({ target: [incomePlans.sourceId, incomePlans.effectiveMonth], set: plan });
  });
}
