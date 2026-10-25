/** Synthetic, isolated local ledger: business receipt → savings transfer. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { accounts, transactions, funds } from "@/db/schema";
import { classifyTransactions } from "@/lib/classify";
import { saveFund, fundSummary } from "@/lib/funds";
import { monthSummary } from "@/lib/ledger";
import { recentPaychecks } from "@/lib/income";
if (!["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL ?? "http://invalid").hostname)) throw new Error("Use a disposable local database.");
const checking = randomUUID(), savings = randomUUID();
async function run() {
  await db.insert(accounts).values([{id:checking, name:"Test business receipts", kind:"checking"},{id:savings,name:"Test savings",kind:"savings"}]);
  const rows = await db.insert(transactions).values([
    {accountId:checking,rawDescription:"BILL.COM client payment",amountCents:125000},
    {accountId:checking,rawDescription:"Example reserve transfer",amountCents:-125000},
    {accountId:savings,rawDescription:"Transfer from checking",amountCents:125000},
  ].map(row=>({...row,postedOn:"2097-01-15",status:"cleared" as const,dedupeHash:randomUUID()}))).returning();
  await saveFund({name:"Test reserve",kind:"savings",fundingAccountId:checking,destinationAccountId:savings,patterns:["Example reserve transfer"]});
  await classifyTransactions(rows.map(row=>row.id),{useLlm:false});
  const summary = await monthSummary("2097-01");
  assert.equal(summary.incomeCents,125000);
  assert.equal(summary.spendCents,0);
  assert.equal((await fundSummary("2097-01")).savingsCents,125000);
  assert.ok((await recentPaychecks()).some(row=>row.id===rows[0]?.id),"business income can be selected in income settings");
  console.log("PASS: business income counted once, savings excluded from spending, paired destination excluded, business source available in settings.");
}
run().finally(async()=>{
  await db.delete(transactions).where(inArray(transactions.accountId,[checking,savings]));
  await db.delete(funds).where(eq(funds.fundingAccountId,checking));
  await db.delete(accounts).where(inArray(accounts.id,[checking,savings]));
}).then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1);});
