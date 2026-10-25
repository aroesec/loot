import { describe, expect, it } from "vitest";
import { projectIncome, activeIncomePlans, incomePlanInput } from "@/lib/income/logic";

const plan = { sourceId: "11111111-1111-4111-8111-111111111111", name: "Example employer", accountId: "22222222-2222-4222-8222-222222222222", pattern: "example payroll", effectiveMonth: "2026-01", amountCents: 300000, paymentsPerMonth: 2, enabled: true };
const payment = { id: "deposit", accountId: "22222222-2222-4222-8222-222222222222", rawDescription: "EXAMPLE PAYROLL", postedOn: "2026-01-15", amountCents: 300000, isTransfer: false, status: "cleared" as const };

describe("monthly income plan", () => {
  it("starts with two expected payments and replaces them as actual money arrives", () => {
    const start = projectIncome({ month: "2026-01", plans: [plan], transactions: [], receivedIncomeCents: 0 });
    expect(start.projectedIncomeCents).toBe(600000);
    expect(start.sources[0]?.receivedCount).toBe(0);
    const first = projectIncome({ month: "2026-01", plans: [plan], transactions: [payment], receivedIncomeCents: 300000 });
    expect(first.projectedIncomeCents).toBe(600000);
    expect(first.sources[0]?.receivedCount).toBe(1);
    const second = projectIncome({ month: "2026-01", plans: [plan], transactions: [payment, { ...payment, id: "second", postedOn: "2026-01-30" }], receivedIncomeCents: 600000 });
    expect(second.projectedIncomeCents).toBe(600000);
    expect(second.remainingCents).toBe(0);
  });
  it("keeps varying actual payments and extra deposits without counting an expected slot twice", () => {
    const result = projectIncome({ month: "2026-01", plans: [plan], transactions: [payment, { ...payment, id: "second", amountCents: 310000 }, { ...payment, id: "bonus", amountCents: 10000 }], receivedIncomeCents: 630000 });
    expect(result.projectedIncomeCents).toBe(630000);
    expect(result.sources[0]?.extraCount).toBe(1);
    expect(result.sources[0]?.receivedCents).toBe(620000);
  });
  it("does not mark pending, transfer, debit, other-month or other-account entries received", () => {
    const transactions = [{ ...payment, id: "pending", status: "pending" as const }, { ...payment, id: "transfer", isTransfer: true }, { ...payment, id: "debit", amountCents: -300000 }, { ...payment, id: "other-month", postedOn: "2026-02-15" }, { ...payment, id: "other-account", accountId: "other" }, { ...payment, id: "refund", rawDescription: "Example payroll reimbursement" }];
    expect(projectIncome({ month: "2026-01", plans: [plan], transactions, receivedIncomeCents: 0 }).sources[0]?.receivedCount).toBe(0);
  });
  it("uses month-effective plans and resets receipt progress for the next month", () => {
    const later = { ...plan, effectiveMonth: "2026-02", amountCents: 320000 };
    expect(activeIncomePlans({ month: "2026-01", plans: [later, plan] })[0]?.amountCents).toBe(300000);
    expect(projectIncome({ month: "2026-02", plans: [later, plan], transactions: [payment], receivedIncomeCents: 0 }).projectedIncomeCents).toBe(640000);
    expect(activeIncomePlans({ month: "2026-03", plans: [plan, later, { ...later, effectiveMonth: "2026-03", enabled: false }] })).toEqual([]);
  });
  it("deduplicates the same ledger row and blocks ambiguous forecasts", () => {
    expect(projectIncome({ month: "2026-01", plans: [plan], transactions: [payment, payment], receivedIncomeCents: 300000 }).sources[0]?.receivedCount).toBe(1);
    const ambiguous = projectIncome({ month: "2026-01", plans: [plan, { ...plan, sourceId: "another" }], transactions: [payment], receivedIncomeCents: 300000 });
    expect(ambiguous.projectedIncomeCents).toBeNull();
    expect(ambiguous.ambiguousCount).toBe(1);
  });
  it("rejects invalid months, zero pay and unbounded monthly counts", () => {
    expect(incomePlanInput.safeParse(plan).success).toBe(true);
    expect(incomePlanInput.safeParse({ ...plan, effectiveMonth: "2026-13" }).success).toBe(false);
    expect(incomePlanInput.safeParse({ ...plan, amountCents: 0, paymentsPerMonth: 500 }).success).toBe(false);
  });
});
