/** Run only against a disposable local database after migrations and seeding. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, transactions, incomePlans } from "@/db/schema";
import { saveIncomePlan, incomeProjection } from "@/lib/income";
if (!["127.0.0.1", "localhost"].includes(new URL(process.env.DATABASE_URL ?? "http://invalid").hostname)) throw new Error("Use a disposable local database.");
const accountId = randomUUID(), sourceId = randomUUID();
const plan = { sourceId, accountId, name: "Example payroll", pattern: "Example payroll", effectiveMonth: "2098-01", amountCents: 300000, paymentsPerMonth: 2, enabled: true };
async function run() {
  await db.insert(accounts).values({ id: accountId, name: "Income test checking", kind: "checking" });
  await saveIncomePlan(plan);
  await saveIncomePlan(plan);
  assert.equal((await db.select().from(incomePlans).where(eq(incomePlans.sourceId, sourceId))).length, 1);
  assert.equal((await incomeProjection("2098-01")).projectedIncomeCents, 600000);
  const [first] = await db.insert(transactions).values({ accountId, amountCents: 300000, rawDescription: "EXAMPLE PAYROLL", postedOn: "2098-01-15", dedupeHash: randomUUID(), status: "pending" }).returning();
  assert.ok(first);
  assert.equal((await incomeProjection("2098-01")).sources[0]?.receivedCount, 0);
  await db.update(transactions).set({ status: "cleared" }).where(eq(transactions.id, first.id));
  assert.equal((await incomeProjection("2098-01")).sources[0]?.receivedCount, 1);
  assert.equal((await incomeProjection("2098-01")).projectedIncomeCents, 600000);
  await db.insert(transactions).values({ accountId, amountCents: 310000, rawDescription: "EXAMPLE PAYROLL", postedOn: "2098-01-30", dedupeHash: randomUUID(), status: "cleared" });
  assert.equal((await incomeProjection("2098-01")).projectedIncomeCents, 610000);
  await saveIncomePlan({ ...plan, effectiveMonth: "2098-02", amountCents: 320000 });
  assert.equal((await incomeProjection("2098-01")).projectedIncomeCents, 610000);
  assert.equal((await incomeProjection("2098-02")).projectedIncomeCents, 640000);
  await assert.rejects(saveIncomePlan({ ...plan, sourceId: randomUUID() }));
  await assert.rejects(saveIncomePlan({ ...plan, accountId: randomUUID() }));
  await saveIncomePlan({ ...plan, effectiveMonth: "2098-03", enabled: false });
  assert.equal((await incomeProjection("2098-03")).sources.length, 0);
  await db.delete(transactions).where(eq(transactions.id, first.id));
  assert.equal((await incomeProjection("2098-01")).sources[0]?.receivedCount, 1);
  console.log("PASS: persisted plans, retries, pending-to-cleared deposits, varying amounts, month reset, historical revisions, ambiguity rejection, pausing, and deposit removal.");
}
run().finally(async () => {
  await db.delete(transactions).where(eq(transactions.accountId, accountId));
  await db.delete(incomePlans).where(eq(incomePlans.sourceId, sourceId));
  await db.delete(accounts).where(eq(accounts.id, accountId));
}).then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
