import { describe, expect, it } from "vitest";
import { coverageNote, netWorth, type BalanceInput } from "@/lib/net-worth";

const a = (kind: BalanceInput["kind"], balanceCents: number | null): BalanceInput => ({
  kind,
  balanceCents,
});

describe("netWorth", () => {
  it("subtracts what is owed from what is owned", () => {
    const w = netWorth([
      a("checking", 500000),
      a("savings", 1200000),
      a("credit_card", 90000),
    ]);
    expect(w.assetsCents).toBe(1700000);
    expect(w.liabilitiesCents).toBe(90000);
    expect(w.netCents).toBe(1610000);
  });

  it("counts investments, which the cash buffer deliberately does not", () => {
    // Same balances, different question: a buffer asks what can be spent
    // without selling anything; net worth asks what you own.
    expect(netWorth([a("investment", 4000000)]).assetsCents).toBe(4000000);
  });

  it("treats a loan as a debt", () => {
    const w = netWorth([a("checking", 100000), a("loan", 25000000)]);
    expect(w.netCents).toBe(100000 - 25000000);
  });
});

/**
 * A card balance arrives signed either way depending on the institution. A sign
 * flip does not make a small error — it moves a debt onto the asset side, so
 * net worth is wrong by twice the balance.
 */
describe("liability signs", () => {
  it("owes the same whichever way the institution signs it", () => {
    expect(netWorth([a("credit_card", 90000)]).netCents).toBe(-90000);
    expect(netWorth([a("credit_card", -90000)]).netCents).toBe(-90000);
  });
});

/**
 * The reason this module reports coverage at all. An account with no balance is
 * unknown, not empty — a linked current account beside an unlinked mortgage
 * would otherwise show a healthy net worth that is wrong by the size of a house.
 */
describe("unknown balances", () => {
  it("counts an account with no balance as missing rather than as zero", () => {
    const w = netWorth([a("checking", 500000), a("loan", null)]);
    expect(w.netCents).toBe(500000);
    expect(w.accountsKnown).toBe(1);
    expect(w.accountsUnknown).toBe(1);
    expect(w.unknown).toBe(false);
  });

  it("reports no figure at all when nothing is known", () => {
    const w = netWorth([a("checking", null), a("credit_card", null)]);
    expect(w.unknown).toBe(true);
    expect(w.accountsKnown).toBe(0);
    expect(netWorth([]).unknown).toBe(true);
  });
});

describe("coverageNote", () => {
  it("explains that a balance cannot come from transactions when nothing is known", () => {
    const note = coverageNote(netWorth([a("checking", null)]));
    expect(note).toMatch(/no net worth to show/i);
    expect(note).toMatch(/link a bank/i);
  });

  it("names how many accounts are missing, and says nothing when none are", () => {
    expect(coverageNote(netWorth([a("checking", 1), a("loan", null)]))).toMatch(
      /1 account has no balance/i,
    );
    expect(coverageNote(netWorth([a("checking", 1)]))).toBeNull();
  });
});
