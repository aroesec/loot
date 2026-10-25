/** Synthetic data only. Run against a disposable database after migrate + seed. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { accounts, transactions, funds } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { saveFund, removeFund, fundSummary, refreshFundClassifications } from "@/lib/funds";
import { monthSummary } from "@/lib/ledger";
import { classifyTransactions } from "@/lib/classify";

if (!["127.0.0.1", "localhost"].includes(new URL(process.env.DATABASE_URL ?? "http://invalid").hostname)) throw new Error("Use a disposable local test database.");
const checking = randomUUID(), savings = randomUUID();
const prefix = `fund-test-${randomUUID()}`;
async function run() {
  await db.insert(accounts).values([{ id: checking, name: "Test checking", kind: "checking" }, { id: savings, name: "Test reserve", kind: "savings" }]);
  const inserted = await db.insert(transactions).values([
    { accountId: checking, amountCents: 100000, rawDescription: "Payroll" },
    { accountId: checking, amountCents: -20000, rawDescription: "Groceries" },
    { accountId: checking, amountCents: -10000, rawDescription: "Example bank transfer" },
    { accountId: savings, amountCents: 10000, rawDescription: "Transfer from checking" },
    { accountId: checking, amountCents: 2000, rawDescription: "Example bank transfer" },
    { accountId: savings, amountCents: -2000, rawDescription: "Transfer to checking" },
    { accountId: checking, amountCents: -15000, rawDescription: "Example brokerage transfer" },
    { accountId: checking, amountCents: 1000, rawDescription: "Example bank transfer interest" },
    { accountId: checking, amountCents: -3000, rawDescription: "Example bank transfer", classificationSource: "manual" as const },
  ].map((r, i) => ({ ...r, postedOn: "2099-01-10", dedupeHash: `${prefix}-${i}` }))).returning({ id: transactions.id });
  assert.equal((await monthSummary("2099-01")).spendCents, 50000);
  const config = { name: `${prefix}-savings`, kind: "savings" as const, fundingAccountId: checking, destinationAccountId: savings, patterns: ["Example bank transfer"] };
  await saveFund(config);
  await saveFund({ ...config, name: `${prefix}-investment`, kind: "investment", destinationAccountId: null, patterns: ["Example brokerage transfer"] });
  const summary = await monthSummary("2099-01");
  assert.equal(summary.spendCents, 23000); assert.equal(summary.incomeCents, 101000);
  assert.equal((await fundSummary("2099-01")).savingsCents, 8000);
  assert.equal((await fundSummary("2099-01")).investmentCents, 15000);
  assert.equal(await refreshFundClassifications(), 0, "retries are idempotent");
  await classifyTransactions(inserted.map((r) => r.id), { useLlm: false });
  assert.equal((await monthSummary("2099-01")).spendCents, 23000, "import pipeline preserves transfers");
  const [saved] = await db.select().from(funds).where(eq(funds.name, config.name));
  assert.ok(saved);
  await saveFund({ ...saved, kind: "investment" });
  assert.equal((await fundSummary("2099-01")).savingsCents, 0);
  assert.equal((await fundSummary("2099-01")).investmentCents, 23000);
  await assert.rejects(saveFund({ ...config, fundingAccountId: randomUUID() }));
  await removeFund(saved.id);
  const [manual] = await db.select().from(transactions).where(eq(transactions.id, inserted[8]!.id));
  assert.equal(manual?.classificationSource, "manual"); assert.equal(manual?.isTransfer, false);
  assert.equal((await fundSummary("2099-01")).investmentCents, 15000);
  console.log("PASS: contributions, withdrawals, matched counterparts, spending/income, retries, imports, edits, missing accounts, deletion, and manual preservation.");
}
run().finally(async () => {
  await db.delete(transactions).where(inArray(transactions.accountId, [checking, savings]));
  await db.delete(funds).where(eq(funds.fundingAccountId, checking));
  await db.delete(accounts).where(inArray(accounts.id, [checking, savings]));
}).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
