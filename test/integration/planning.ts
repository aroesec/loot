import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  funds,
  budgets,
  categories,
  expensePlans,
  transactions,
} from "@/db/schema";
import {
  populateRecurringBudgets,
  saveFundSchedule,
  allocationPlanning,
  expensePlanning,
  budgetPlanning,
  saveCategoryBudget,
  saveExpensePlan,
} from "@/lib/planning";
if (
  !["localhost", "127.0.0.1"].includes(
    new URL(process.env.DATABASE_URL ?? "http://invalid").hostname,
  )
)
  throw new Error("Use a disposable local database.");
const accountId = randomUUID(),
  categoryId = randomUUID(),
  fundId = randomUUID();
async function run() {
  await db
    .insert(accounts)
    .values({ id: accountId, name: "Test bills", kind: "checking" });
  await db.insert(categories).values({
    id: categoryId,
    name: "Test phone",
    slug: `test-phone-${categoryId}`,
    kind: "expense",
    mode: "personal",
    budgetable: true,
  });
  await db.insert(transactions).values(
    ["2096-08-15", "2096-09-15"].map((postedOn) => ({
      accountId,
      categoryId,
      merchant: "Test phone company",
      rawDescription: "Test phone bill",
      amountCents: -9000,
      postedOn,
      status: "cleared" as const,
      dedupeHash: randomUUID(),
    })),
  );
  assert.equal((await expensePlanning("2096-10")).suggestions.length, 1);
  assert.equal((await expensePlanning("2096-10")).approved.length, 0);
  assert.deepEqual(await populateRecurringBudgets("2096-10"), {
    approved: 1,
    created: 1,
  });
  assert.deepEqual(await populateRecurringBudgets("2096-10"), {
    approved: 0,
    created: 0,
  });
  assert.equal((await budgetPlanning("2096-10")).budgetCents, 9000);
  const plan = {
    accountId,
    categoryId,
    merchant: "Test phone company",
    name: "Phone",
    amountCents: 9500,
    effectiveMonth: "2096-10",
    enabled: true,
  };
  await saveExpensePlan(plan);
  await saveExpensePlan(plan);
  assert.equal((await expensePlanning("2096-10")).approved.length, 1);
  await saveCategoryBudget({
    categoryId,
    month: "2096-10",
    amountCents: 12000,
    rollover: "none",
  });
  assert.equal(
    (await budgetPlanning("2096-10")).forecastCents,
    12000,
    "bill is inside budget",
  );
  await saveCategoryBudget({
    categoryId,
    month: "2096-12",
    amountCents: 14000,
    rollover: "none",
  });
  await saveCategoryBudget({
    categoryId,
    month: "2096-11",
    amountCents: 13000,
    rollover: "none",
  });
  assert.equal((await budgetPlanning("2096-10")).budgetCents, 12000);
  assert.equal((await budgetPlanning("2096-11")).budgetCents, 13000);
  assert.equal((await budgetPlanning("2096-12")).budgetCents, 14000);
  await saveCategoryBudget({
    categoryId,
    month: "2096-11",
    amountCents: 0,
    rollover: "none",
  });
  assert.equal(
    (await budgetPlanning("2096-11")).budgetCents,
    0,
    "removal must not resurrect previous version",
  );
  await populateRecurringBudgets("2096-11");
  assert.equal(
    (await budgetPlanning("2096-11")).budgetCents,
    0,
    "autofill preserves an explicitly cleared budget",
  );
  assert.equal((await budgetPlanning("2096-12")).budgetCents, 14000);
  await db.insert(transactions).values({
    accountId,
    categoryId,
    merchant: plan.merchant,
    rawDescription: "Test phone bill",
    amountCents: -8500,
    postedOn: "2096-10-15",
    dedupeHash: randomUUID(),
  });
  assert.equal(
    (await expensePlanning("2096-10")).approved[0]?.remainingCents,
    0,
  );
  await saveExpensePlan({ ...plan, effectiveMonth: "2096-11", enabled: false });
  assert.equal((await expensePlanning("2096-10")).approved.length, 1);
  assert.equal((await expensePlanning("2096-11")).approved.length, 0);
  await assert.rejects(
    saveCategoryBudget({
      categoryId: randomUUID(),
      month: "2096-10",
      amountCents: 5000,
      rollover: "none",
    }),
  );
  await db
    .insert(funds)
    .values({
      id: fundId,
      name: "Test savings",
      kind: "savings",
      fundingAccountId: accountId,
      patterns: ["Test savings"],
    });
  await db
    .insert(transactions)
    .values(
      [6, 14, 20].map((day) => ({
        accountId,
        fundId,
        categoryId,
        rawDescription: "Test savings transfer",
        amountCents: -20000,
        postedOn: `2026-10-${String(day).padStart(2, "0")}`,
        isTransfer: true,
        dedupeHash: randomUUID(),
      })),
    );
  await db
    .insert(transactions)
    .values({
      accountId,
      fundId,
      categoryId,
      rawDescription: "Test extra savings",
      amountCents: -100000,
      postedOn: "2026-10-16",
      isTransfer: true,
      dedupeHash: randomUUID(),
    });
  const weekly = {
    fundId,
    effectiveMonth: "2026-10",
    amountCents: 20000,
    weekday: 2,
    enabled: true,
  };
  await saveFundSchedule(weekly);
  await saveFundSchedule(weekly);
  assert.equal((await allocationPlanning("2026-10")).forecastCents, 180000);
  assert.equal((await allocationPlanning("2026-10")).remainingCents, 20000);
  await saveFundSchedule({
    ...weekly,
    effectiveMonth: "2026-11",
    enabled: false,
  });
  assert.equal((await allocationPlanning("2026-10")).remainingCents, 20000);
  assert.equal((await allocationPlanning("2026-11")).remainingCents, 0);
  console.log(
    "PASS: approval required, retries, bill-budget overlap, out-of-order month edits, clearing budgets, recorded bill replacement, historical approvals, invalid categories.",
  );
}
run()
  .finally(async () => {
    await db.delete(expensePlans).where(eq(expensePlans.accountId, accountId));
    await db.delete(transactions).where(eq(transactions.accountId, accountId));
    await db.delete(budgets).where(eq(budgets.categoryId, categoryId));
    await db.delete(categories).where(eq(categories.id, categoryId));
    await db.delete(funds).where(eq(funds.id, fundId));
    await db.delete(accounts).where(eq(accounts.id, accountId));
  })
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
