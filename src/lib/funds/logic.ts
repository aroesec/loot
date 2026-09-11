import { z } from "zod";
import { normalizeDescription } from "@/lib/classify/normalize";

export const fundInput = z.object({
  id: z.uuid({ error: "Reload Settings and choose the fund again." }).optional(),
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["savings", "investment"]),
  fundingAccountId: z.uuid({ error: "Choose a valid funding account." }),
  destinationAccountId: z.uuid({ error: "Choose a valid fund account." }).nullable().default(null),
  patterns: z.array(z.string().trim().min(4).max(160).refine((p) =>
    !/^(transfer|deposit|withdrawal|payment|checking|savings|investment|investments|venmo|zelle|paypal|cash app)$/i.test(p),
    "Use a description that identifies this specific fund, not a generic transfer or payment rail.",
  )).min(1).max(8),
}).refine((v) => v.fundingAccountId !== v.destinationAccountId, {
  message: "Choose different funding and destination accounts.",
});
export type FundInput = z.infer<typeof fundInput>;
export type Fund = Omit<FundInput, "id"> & { id: string };

// Interest and distributions are new money, not a return of principal. Never
// let a user-entered institution pattern silently remove these from income.
const NON_TRANSFER = /\b(interest|int|dividend|dividends|div|fee|fees|payroll|cashback|reward|rewards|loan|mortgage|purchase|insurance)\b/i;

export function matchFund(
  row: { accountId: string | null; rawDescription: string; amountCents: number },
  funds: Fund[],
): Fund | null {
  if (!row.amountCents || NON_TRANSFER.test(row.rawDescription)) return null;
  const description = normalizeDescription(row.rawDescription);
  const matches = funds.filter((f) => f.fundingAccountId === row.accountId &&
    f.patterns.some((p) => {
      const normalized = normalizeDescription(p);
      return normalized.length >= 4 && description.includes(normalized);
    }));
  return matches.length === 1 ? matches[0]! : null;
}

export function summarizeFunds(rows: Array<{ kind: "savings" | "investment"; contributedCents: number; withdrawnCents: number }>) {
  let savingsCents = 0, investmentCents = 0;
  for (const row of rows) {
    const net = row.contributedCents - row.withdrawnCents;
    if (row.kind === "savings") savingsCents += net;
    else investmentCents += net;
  }
  return { savingsCents, investmentCents, netCents: savingsCents + investmentCents };
}

type Movement = { id: string; accountId: string | null; fundId: string | null; amountCents: number; postedOn: string; classificationSource: string; rawDescription: string; currency?: string };
/** Only unique opposite entries in the explicitly linked destination can pair. */
export function pairFundTransfers(rows: Movement[], funds: Fund[]): Array<{ id: string; fundId: string }> {
  const candidates = new Map<string, string[]>();
  const fundById = new Map(funds.map((f) => [f.id, f]));
  const byAccountAmount = new Map<string, Movement[]>();
  for (const row of rows) {
    if (row.classificationSource === "manual" || NON_TRANSFER.test(row.rawDescription) ||
      !/\b(transfer|ach|moneyline|deposit|withdrawal|checking|savings)\b/i.test(row.rawDescription)) continue;
    const key = `${row.accountId}:${row.currency ?? "USD"}:${row.amountCents}`;
    byAccountAmount.set(key, [...(byAccountAmount.get(key) ?? []), row]);
  }
  for (const source of rows) {
    const fund = source.fundId ? fundById.get(source.fundId) : undefined;
    if (!fund?.destinationAccountId || source.accountId !== fund.fundingAccountId || !source.amountCents) continue;
    const pool = byAccountAmount.get(`${fund.destinationAccountId}:${source.currency ?? "USD"}:${-source.amountCents}`) ?? [];
    const matches = pool.filter((r) =>
      Math.abs(Date.parse(r.postedOn) - Date.parse(source.postedOn)) <= 3 * 86_400_000);
    if (matches.length === 1) {
      const id = matches[0]!.id;
      candidates.set(id, [...(candidates.get(id) ?? []), fund.id]);
    }
  }
  return [...candidates].flatMap(([id, matches]) => matches.length === 1 ? [{ id, fundId: matches[0]! }] : []);
}
