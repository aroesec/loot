import { and, eq, inArray, isNotNull, isNull, ne, or, sql, gte, lte } from "drizzle-orm";
import { db, type Db } from "@/db";
import { accounts, categories, funds, transactions } from "@/db/schema";
import { matchRule, loadRules } from "@/lib/classify/rules";
import { normalizeDescription } from "@/lib/classify/normalize";
import { ledgerMode } from "@/lib/mode";
import { fundInput, matchFund, pairFundTransfers, summarizeFunds, type FundInput } from "./logic";
import { monthBounds } from "@/lib/dates";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
const CATEGORY = { savings: "fund-savings", investment: "fund-investment" } as const;
export class FundError extends Error {}
export async function listFunds() { return db.select().from(funds).orderBy(funds.name); }

async function refresh(tx: Tx, rules: Awaited<ReturnType<typeof loadRules>>, excludedId?: string) {
  const configured = (await tx.select().from(funds)).filter((f) => f.id !== excludedId);
  const accountIds = [...new Set(configured.flatMap((f) => [f.fundingAccountId, ...(f.destinationAccountId ? [f.destinationAccountId] : [])]))];
  const rows = await tx.select().from(transactions).where(and(
    ne(transactions.classificationSource, "manual"),
    or(isNotNull(transactions.fundId), accountIds.length ? inArray(transactions.accountId, accountIds) : sql`false`),
  )).limit(20001);
  if (rows.length > 20000) throw new FundError("This account has too much history to update in one request. Contact the app operator.");
  if (configured.length === 0 && rows.length === 0) return 0;
  const categoryRows = await tx.select({ id: categories.id, slug: categories.slug }).from(categories);
  const categoryIds = new Map(categoryRows.map((c) => [c.slug, c.id]));
  for (const kind of ["savings", "investment"] as const) {
    const [category] = await tx.insert(categories).values({
      slug: CATEGORY[kind], name: kind === "savings" ? "Savings transfers" : "Investment transfers",
      kind: "transfer", budgetable: false, mode: "personal", isSystem: true,
      hint: "Transfers identified by your fund settings. Not income or spending.",
    }).onConflictDoUpdate({ target: categories.slug, set: { kind: "transfer", budgetable: false } }).returning({ id: categories.id });
    categoryIds.set(CATEGORY[kind], category!.id);
  }
  const matches = new Map(rows.flatMap((r) => {
    const f = matchFund(r, configured); return f ? [[r.id, f] as const] : [];
  }));
  const projected = rows.map((r) => ({ ...r, fundId: matches.get(r.id)?.id ?? null }));
  for (const pair of pairFundTransfers(projected, configured)) {
    const f = configured.find((v) => v.id === pair.fundId)!;
    if (!matches.has(pair.id)) matches.set(pair.id, f);
  }
  let changed = 0;
  // Group identical updates so importing history doesn't make a network trip
  // for every contribution. Manual decisions are protected at write time too.
  const groups = new Map<string, { ids: string[]; fields: Partial<typeof transactions.$inferInsert> }>();
  for (const row of rows) {
    const fund = matches.get(row.id);
    let fields: Partial<typeof transactions.$inferInsert>;
    if (fund) {
      const categoryId = categoryIds.get(CATEGORY[fund.kind])!;
      if (row.fundId === fund.id && row.categoryId === categoryId && row.isTransfer) continue;
      fields = { fundId: fund.id, categoryId, isTransfer: true, classificationSource: "rule", classificationConfidence: 1,
        matchedRuleId: null, classificationReason: `Transfer for ${fund.name}` };
    } else if (row.fundId) {
      const fallback = matchRule(normalizeDescription(row.rawDescription), rules, row.amountCents);
      fields = { fundId: null, categoryId: fallback?.categoryId ?? categoryIds.get("uncategorized") ?? null,
        isTransfer: fallback?.isTransfer ?? false, matchedRuleId: fallback?.rule.id ?? null,
        classificationSource: fallback?.categoryId && !fallback.queueForReview ? "rule" : "unclassified",
        classificationConfidence: fallback?.categoryId && !fallback.queueForReview ? 1 : 0,
        classificationReason: "Fund setting changed; classification refreshed" };
    } else continue;
    const key = JSON.stringify(fields);
    const group = groups.get(key) ?? { ids: [], fields }; group.ids.push(row.id); groups.set(key, group);
  }
  for (const { ids, fields } of groups.values()) {
    for (let i = 0; i < ids.length; i += 500) {
      const updated = await tx.update(transactions).set({ ...fields, updatedAt: new Date() })
        .where(and(inArray(transactions.id, ids.slice(i, i + 500)), ne(transactions.classificationSource, "manual")))
        .returning({ id: transactions.id });
      changed += updated.length;
    }
  }
  return changed;
}

export async function refreshFundClassifications() {
  if (await ledgerMode() !== "personal") return 0;
  const rules = await loadRules();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(164001)`);
    return refresh(tx, rules);
  });
}

export async function saveFund(input: FundInput) {
  const parsed = fundInput.safeParse(input);
  if (!parsed.success) throw new FundError(parsed.error.issues[0]?.message ?? "Check the fund details.");
  if (await ledgerMode() !== "personal") throw new FundError("Funds are available in personal mode.");
  const rules = await loadRules();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(164001)`);
    const { id, ...values } = parsed.data;
    const existing = await tx.select().from(funds);
    if (id && !existing.some((f) => f.id === id)) throw new FundError("This fund no longer exists. Reload Settings.");
    if (!id && existing.length >= 20) throw new FundError("You can track up to 20 funds.");
    const ids = [values.fundingAccountId, ...(values.destinationAccountId ? [values.destinationAccountId] : [])];
    const validAccounts = await tx.select().from(accounts).where(and(inArray(accounts.id, ids), isNull(accounts.archivedAt)));
    if (new Set(validAccounts.map((a) => a.currency)).size > 1) throw new FundError("Fund accounts must use the same currency.");
    if (validAccounts.length !== ids.length) throw new FundError("Choose an available account.");
    if (validAccounts.some((a) => ["credit_card", "loan"].includes(a.kind))) throw new FundError("Choose cash, checking, savings or investment accounts.");
    if (existing.some((f) => f.id !== id && f.fundingAccountId === values.fundingAccountId &&
      f.patterns.some((p) => values.patterns.some((q) => {
        const a = normalizeDescription(p), b = normalizeDescription(q); return a.includes(b) || b.includes(a);
      })))) throw new FundError("These descriptions overlap another fund on this account. Use a more specific description.");
    if (values.patterns.some((p) => normalizeDescription(p).length < 4)) throw new FundError("Use a more specific transfer description.");
    if (id) await tx.update(funds).set(values).where(eq(funds.id, id));
    else await tx.insert(funds).values(values);
    const changed = await refresh(tx, rules);
    return { changed };
  });
}

export async function removeFund(id: string) {
  const rules = await loadRules();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(164001)`);
    const changed = await refresh(tx, rules, id);
    await tx.delete(funds).where(eq(funds.id, id));
    return { changed };
  });
}

export async function fundSummary(month: string) {
  const { start, end } = monthBounds(month);
  return fundSummaryBetween(start, end);
}

export async function fundSummaryBetween(start: string, end: string) {
  const rows = await db.select({ id: funds.id, name: funds.name, kind: funds.kind,
    contributed: sql<string>`coalesce(sum(case when ${transactions.amountCents} < 0 then -${transactions.amountCents} else 0 end), 0)`,
    withdrawn: sql<string>`coalesce(sum(case when ${transactions.amountCents} > 0 then ${transactions.amountCents} else 0 end), 0)`,
  }).from(funds).leftJoin(transactions, and(eq(transactions.fundId, funds.id),
    eq(transactions.accountId, funds.fundingAccountId), eq(transactions.isTransfer, true),
    gte(transactions.postedOn, start), lte(transactions.postedOn, end)))
    .groupBy(funds.id, funds.name, funds.kind).orderBy(funds.name);
  const byFund = rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind,
    contributedCents: Number(r.contributed), withdrawnCents: Number(r.withdrawn) }));
  return { byFund, ...summarizeFunds(byFund) };
}
