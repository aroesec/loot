import { describe, expect, it } from "vitest";
import { matchFund, summarizeFunds, fundInput, pairFundTransfers } from "@/lib/funds/logic";

const fund = { id: "fund", name: "Rainy day", kind: "savings" as const,
  fundingAccountId: "checking", destinationAccountId: "savings", patterns: ["example bank transfer"] };

describe("owned fund transfers", () => {
  it("separates contributions and withdrawals from earnings and spending", () => {
    expect(matchFund({ accountId: "checking", rawDescription: "EXAMPLE BANK TRANSFER", amountCents: -50000 }, [fund])?.id).toBe("fund");
    expect(matchFund({ accountId: "checking", rawDescription: "EXAMPLE BANK TRANSFER", amountCents: 10000 }, [fund])?.id).toBe("fund");
    expect(summarizeFunds([{ ...fund, contributedCents: 50000, withdrawnCents: 10000 }])).toEqual({ savingsCents: 40000, investmentCents: 0, netCents: 40000 });
  });
  it("does not hide interest, dividends, fees, loan payments or another account's purchases", () => {
    for (const rawDescription of ["EXAMPLE BANK TRANSFER INTEREST", "EXAMPLE BANK TRANSFER DIVIDEND", "EXAMPLE BANK TRANSFER FEE", "EXAMPLE BANK TRANSFER LOAN PAYMENT"]) {
      expect(matchFund({ accountId: "checking", rawDescription, amountCents: 250 }, [fund])).toBeNull();
    }
    expect(matchFund({ accountId: "other", rawDescription: "EXAMPLE BANK TRANSFER", amountCents: -50000 }, [fund])).toBeNull();
  });
  it("leaves overlapping fund descriptions unresolved instead of guessing", () => {
    expect(matchFund({ accountId: "checking", rawDescription: "EXAMPLE BANK TRANSFER", amountCents: -100 }, [fund, { ...fund, id: "other" }])).toBeNull();
  });
  it("pairs both sides once and refuses ambiguous or manual counterparts", () => {
    const debit = { id: "out", rawDescription: "Example bank transfer", accountId: "checking", fundId: "fund", amountCents: -50000, postedOn: "2026-01-10", classificationSource: "rule" };
    const credit = { id: "in", rawDescription: "Transfer from checking", accountId: "savings", fundId: null, amountCents: 50000, postedOn: "2026-01-11", classificationSource: "rule" };
    expect(pairFundTransfers([debit, credit], [fund])).toEqual([{ id: "in", fundId: "fund" }]);
    expect(pairFundTransfers([debit, credit, { ...credit, id: "duplicate" }], [fund])).toEqual([]);
    expect(pairFundTransfers([debit, { ...credit, classificationSource: "manual" }], [fund])).toEqual([]);
    expect(pairFundTransfers([debit, { ...credit, rawDescription: "Sold shares" }], [fund])).toEqual([]);
  });
  it("rejects missing accounts, empty patterns and same-account transfers", () => {
    expect(fundInput.safeParse({ name: "Savings", kind: "savings", fundingAccountId: "", patterns: [] }).success).toBe(false);
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(fundInput.safeParse({ name: "Savings", kind: "savings", fundingAccountId: id, destinationAccountId: id, patterns: ["example transfer"] }).success).toBe(false);
  });
});

describe("business receipts moved into savings", () => {
  it("keeps a business receipt as income even when a savings pattern overlaps", () => {
    expect(matchFund({ accountId: "checking", rawDescription: "BILL.COM example bank transfer", amountCents: 125000 }, [fund])).toBeNull();
    expect(matchFund({ accountId: "checking", rawDescription: "example bank transfer", amountCents: -125000 }, [fund])?.id).toBe("fund");
    const debit = { id: "out", accountId: "checking", fundId: "fund", amountCents: -125000, postedOn: "2026-01-10", rawDescription: "Example bank transfer", classificationSource: "rule" };
    const receipt = { ...debit, id: "business", accountId: "savings", fundId: null, amountCents: 125000, rawDescription: "BILL.COM ACH deposit" };
    expect(pairFundTransfers([debit, receipt], [fund])).toEqual([]);
  });
});
