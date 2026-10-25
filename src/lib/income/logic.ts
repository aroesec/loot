import { z } from "zod";

export const incomeMonth = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/, "Choose a valid month.");
export const incomePlanInput = z.object({
  sourceId: z.uuid(),
  name: z.string().trim().min(1).max(80),
  accountId: z.uuid(),
  pattern: z.string().trim().min(4).max(200),
  effectiveMonth: incomeMonth,
  amountCents: z.number().int().min(1).max(100000000),
  paymentsPerMonth: z.number().int().min(1).max(12),
  enabled: z.boolean(),
});
export type IncomePlan = z.infer<typeof incomePlanInput>;
type Receipt = { id: string; accountId: string | null; rawDescription: string; postedOn: string; amountCents: number; isTransfer: boolean; status: string };
const normalized = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();

export function activeIncomePlans({ month, plans }: { month: string; plans: IncomePlan[] }) {
  const latest = new Map<string, IncomePlan>();
  for (const plan of plans) {
    if (plan.effectiveMonth <= month && (!latest.has(plan.sourceId) || latest.get(plan.sourceId)!.effectiveMonth < plan.effectiveMonth)) latest.set(plan.sourceId, plan);
  }
  return [...latest.values()].filter((plan) => plan.enabled);
}

export function projectIncome({ month, plans, transactions, receivedIncomeCents }: { month: string; plans: IncomePlan[]; transactions: Receipt[]; receivedIncomeCents: number }) {
  const active = activeIncomePlans({ month, plans });
  const receipts = new Map<string, Receipt[]>();
  let ambiguousCount = 0;
  for (const payment of new Map(transactions.map((row) => [row.id, row])).values()) {
    if (payment.amountCents <= 0 || payment.isTransfer || payment.status !== "cleared" || payment.postedOn.slice(0, 7) !== month || /refund|reimburs|reversal/i.test(payment.rawDescription)) continue;
    const matches = active.filter((plan) => plan.accountId === payment.accountId && normalized(payment.rawDescription).includes(normalized(plan.pattern)));
    if (matches.length > 1) { ambiguousCount++; continue; }
    const match = matches[0];
    if (match) receipts.set(match.sourceId, [...(receipts.get(match.sourceId) ?? []), payment]);
  }
  const sources = active.map((plan) => {
    const payments = receipts.get(plan.sourceId) ?? [];
    const receivedCount = Math.min(payments.length, plan.paymentsPerMonth);
    return { ...plan, payments, receivedCount, extraCount: Math.max(0, payments.length - plan.paymentsPerMonth), receivedCents: payments.reduce((sum, row) => sum + row.amountCents, 0), remainingCents: (plan.paymentsPerMonth - receivedCount) * plan.amountCents };
  });
  const remainingCents = sources.reduce((sum, source) => sum + source.remainingCents, 0);
  return { sources, receivedIncomeCents, remainingCents, ambiguousCount, projectedIncomeCents: ambiguousCount ? null : receivedIncomeCents + remainingCents };
}
