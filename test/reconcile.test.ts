import { describe, it, expect } from "vitest";
import {
  scoreMatch,
  bestMatch,
  merchantSimilarity,
  MATCH_THRESHOLD,
  type MatchCandidate,
} from "@/lib/reconcile/match";

/** A purchase logged conversationally: rough description, price at the till. */
function logged(
  postedOn: string,
  amountCents: number,
  description: string,
): MatchCandidate {
  return { id: `m-${description}`, postedOn, amountCents, rawDescription: description };
}

/** The statement row that later represents the same charge. */
function statement(postedOn: string, amountCents: number, rawDescription: string) {
  return { postedOn, amountCents, rawDescription };
}

describe("merchantSimilarity", () => {
  it("treats a contained name as strong", () => {
    expect(merchantSimilarity("Barolo", "BAROLO RISTORANTE")).toBe("strong");
    expect(merchantSimilarity("Blue Bottle", "SQ *BLUE BOTTLE COFFEE")).toBe("strong");
  });

  it("treats two distinctive shared words as strong", () => {
    expect(merchantSimilarity("Trader Joes run", "TRADER JOES #452")).toBe("strong");
  });

  it("treats only-generic overlap as partial, not strong", () => {
    // "coffee" alone should not be enough to merge two different cafes.
    expect(merchantSimilarity("coffee", "BLUE BOTTLE COFFEE")).toBe("partial");
    expect(merchantSimilarity("lunch at a grill", "SOME OTHER GRILL")).toBe("partial");
  });

  it("reports a conflict when both sides name different merchants", () => {
    expect(merchantSimilarity("Barolo", "SHELL OIL")).toBe("conflict");
  });

  it("handles empty or unusable text as unknown, not conflict", () => {
    expect(merchantSimilarity("", "SHELL OIL")).toBe("unknown");
    expect(merchantSimilarity("a", "b")).toBe("unknown");
  });
});

describe("scoreMatch — the cases that must merge", () => {
  it("matches an exact amount, same day, same merchant", () => {
    const r = scoreMatch(
      statement("2026-08-19", -675, "SQ *BLUE BOTTLE COFFEE SPRINGFIELD CO"),
      logged("2026-08-19", -675, "Blue Bottle"),
    );
    expect(r).not.toBeNull();
    expect(r!.amountKind).toBe("exact");
    expect(r!.score).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });

  it("matches across posting lag", () => {
    const r = scoreMatch(
      statement("2026-08-22", -675, "SQ *BLUE BOTTLE COFFEE SPRINGFIELD CO"),
      logged("2026-08-19", -675, "Blue Bottle"),
    );
    expect(r).not.toBeNull();
    expect(r!.dayGap).toBe(3);
  });

  it("matches a restaurant charge that grew by a tip", () => {
    const r = scoreMatch(
      statement("2026-08-21", -5940, "BAROLO RISTORANTE SPRINGFIELD CO"),
      logged("2026-08-19", -5000, "Barolo"),
    );
    expect(r).not.toBeNull();
    expect(r!.amountKind).toBe("tip_adjusted");
    expect(r!.amountDeltaCents).toBe(940);
    expect(r!.explanation).toMatch(/\$9\.40 higher, consistent with a tip/);
  });

  it("explains itself in terms a person can check", () => {
    const r = scoreMatch(
      statement("2026-08-19", -675, "SQ *BLUE BOTTLE COFFEE"),
      logged("2026-08-19", -675, "Blue Bottle"),
    );
    expect(r!.explanation).toBe(
      "the same day, the same amount, the merchant clearly matches",
    );
  });
});

describe("scoreMatch — the cases that must NOT merge", () => {
  it("refuses a tip-adjusted amount when the merchants disagree", () => {
    // Merchant conflict blocks only where the amount is already inexact.
    expect(
      scoreMatch(
        statement("2026-08-19", -700, "SHELL OIL 5744"),
        logged("2026-08-19", -600, "Blue Bottle"),
      ),
    ).toBeNull();
  });

  it("refuses a gap beyond the posting window", () => {
    expect(
      scoreMatch(
        statement("2026-09-01", -675, "SQ *BLUE BOTTLE COFFEE"),
        logged("2026-08-19", -675, "Blue Bottle"),
      ),
    ).toBeNull();
  });

  it("refuses a statement amount LOWER than what was logged", () => {
    // A smaller charge is a different purchase, never a tip.
    expect(
      scoreMatch(
        statement("2026-08-19", -4000, "BAROLO RISTORANTE"),
        logged("2026-08-19", -5000, "Barolo"),
      ),
    ).toBeNull();
  });

  it("refuses a tip larger than the cap", () => {
    // 30% of a large bill would exceed any plausible tip in absolute terms.
    expect(
      scoreMatch(
        statement("2026-08-19", -50000, "BAROLO RISTORANTE"),
        logged("2026-08-19", -40000, "Barolo"),
      ),
    ).toBeNull();
  });

  it("refuses a tip beyond the percentage band", () => {
    expect(
      scoreMatch(
        statement("2026-08-19", -1000, "BAROLO RISTORANTE"),
        logged("2026-08-19", -500, "Barolo"),
      ),
    ).toBeNull();
  });

  it("refuses to match a refund against a purchase", () => {
    expect(
      scoreMatch(
        statement("2026-08-19", 675, "BLUE BOTTLE REFUND"),
        logged("2026-08-19", -675, "Blue Bottle"),
      ),
    ).toBeNull();
  });

  it("refuses a tip-adjusted amount with nothing at all to support it", () => {
    // The amounts genuinely differ, so the tip reading is an inference and
    // needs the merchant or the category to back it up.
    expect(
      scoreMatch(
        { postedOn: "2026-08-21", amountCents: -5940, rawDescription: "OPAQUE REF 88213" },
        logged("2026-08-19", -5000, "something"),
      ),
    ).toBeNull();
  });
});

describe("bestMatch", () => {
  it("picks the closest date among equally-scoring candidates", () => {
    const r = bestMatch(statement("2026-08-19", -675, "SQ *BLUE BOTTLE COFFEE"), [
      logged("2026-08-16", -675, "Blue Bottle"),
      logged("2026-08-19", -675, "Blue Bottle"),
    ]);
    expect(r!.candidate.postedOn).toBe("2026-08-19");
  });

  it("prefers an exact amount over a tip-adjusted one", () => {
    const r = bestMatch(statement("2026-08-19", -5940, "BAROLO RISTORANTE"), [
      logged("2026-08-19", -5000, "Barolo"),
      logged("2026-08-19", -5940, "Barolo"),
    ]);
    expect(r!.amountKind).toBe("exact");
    expect(r!.candidate.amountCents).toBe(-5940);
  });

  it("returns null when nothing qualifies", () => {
    expect(
      bestMatch(statement("2026-08-19", -675, "SHELL OIL"), [
        logged("2026-08-19", -4200, "Barolo"),
      ]),
    ).toBeNull();
  });

  it("returns null on an empty candidate list", () => {
    expect(bestMatch(statement("2026-08-19", -675, "ANY"), [])).toBeNull();
  });
});

describe("category as a substitute for a missing merchant name", () => {
  /*
   * Regression: logging "gas $48.10" and then importing a statement showing
   * SHELL OIL $48.10 the next day produced two transactions for one tank,
   * because the merchant strings share no words. Category agreement is what
   * makes that case matchable without also making two different $6 coffees
   * matchable.
   */
  it("matches a generic description to a named merchant in the same category", () => {
    const r = scoreMatch(
      {
        postedOn: "2026-04-09",
        amountCents: -4810,
        rawDescription: "SHELL OIL 10000000007 SPRINGFIELD CO",
        categorySlug: "gas-fuel",
      },
      { ...logged("2026-04-08", -4810, "gas"), categorySlug: "gas-fuel" },
    );
    expect(r).not.toBeNull();
    expect(r!.merchantMatch).toBe("unknown");
    expect(r!.categoryMatch).toBe("same");
    expect(r!.explanation).toMatch(/did not name a merchant but both are the same category/);
  });

  it("merges two same-amount coffees, and ranks the merchant conflict lower", () => {
    /*
     * Two $6 coffees the same day at different shops. This DOES merge now,
     * which is a deliberate trade rather than an oversight: the pending entry
     * can only be consumed once, so the other charge still inserts and the
     * total stays correct — the cost is a mislabelled row, not lost money.
     * The conflict still lowers the score, so a better candidate wins.
     */
    const conflicting = scoreMatch(
      {
        postedOn: "2026-04-09",
        amountCents: -600,
        rawDescription: "STARBUCKS 2244",
        categorySlug: "coffee",
      },
      { ...logged("2026-04-09", -600, "Blue Bottle"), categorySlug: "coffee" },
    );
    const agreeing = scoreMatch(
      {
        postedOn: "2026-04-09",
        amountCents: -600,
        rawDescription: "SQ *BLUE BOTTLE COFFEE",
        categorySlug: "coffee",
      },
      { ...logged("2026-04-09", -600, "Blue Bottle"), categorySlug: "coffee" },
    );
    expect(conflicting).not.toBeNull();
    expect(agreeing!.score).toBeGreaterThan(conflicting!.score);
  });

  it("prefers the agreeing merchant when both are candidates", () => {
    // The ranking is what protects the label in practice.
    const r = bestMatch(
      {
        postedOn: "2026-04-09",
        amountCents: -600,
        rawDescription: "SQ *BLUE BOTTLE COFFEE",
        categorySlug: "coffee",
      },
      [
        { ...logged("2026-04-09", -600, "Starbucks"), categorySlug: "coffee" },
        { ...logged("2026-04-09", -600, "Blue Bottle"), categorySlug: "coffee" },
      ],
    );
    expect(r!.candidate.rawDescription).toBe("Blue Bottle");
  });

  it("does not match when the categories disagree", () => {
    expect(
      scoreMatch(
        {
          postedOn: "2026-04-09",
          amountCents: -4810,
          rawDescription: "SAFEWAY 2841",
          categorySlug: "groceries",
        },
        { ...logged("2026-04-08", -4810, "gas"), categorySlug: "gas-fuel" },
      ),
    ).toBeNull();
  });

  it("matches on amount and date even with no category information", () => {
    // The candidate pool is only things this person logged in the last few
    // days. Inside that pool, an exact amount on a nearby date is enough.
    const r = scoreMatch(
      { postedOn: "2026-04-09", amountCents: -4810, rawDescription: "SHELL OIL 5744" },
      logged("2026-04-08", -4810, "gas"),
    );
    expect(r).not.toBeNull();
    expect(r!.evidence).toBe("amount_and_date_only");
  });

  it("matches when both sides are uncategorized and unnamed", () => {
    const r = scoreMatch(
      {
        postedOn: "2026-04-09",
        amountCents: -4810,
        rawDescription: "SOMETHING OPAQUE",
        categorySlug: "uncategorized",
      },
      { ...logged("2026-04-08", -4810, "lunch"), categorySlug: "uncategorized" },
    );
    expect(r).not.toBeNull();
    expect(r!.evidence).toBe("amount_and_date_only");
    expect(r!.explanation).toMatch(/nothing else identified it either way/);
  });
});

describe("merchantSimilarity distinguishes absence from conflict", () => {
  it("reports unknown when one side names nothing", () => {
    expect(merchantSimilarity("gas", "SHELL OIL 5744")).toBe("unknown");
    expect(merchantSimilarity("lunch", "BAROLO RISTORANTE")).toBe("unknown");
  });

  it("reports conflict when both name something different", () => {
    expect(merchantSimilarity("Blue Bottle", "STARBUCKS")).toBe("conflict");
    expect(merchantSimilarity("Barolo", "SHELL OIL")).toBe("conflict");
  });

  it("a conflict blocks a tip-adjusted amount but not an exact one", () => {
    const inexact = scoreMatch(
      {
        postedOn: "2026-04-09",
        amountCents: -2300,
        rawDescription: "STARBUCKS",
        categorySlug: "coffee",
      },
      { ...logged("2026-04-09", -2000, "Blue Bottle"), categorySlug: "coffee" },
    );
    expect(inexact).toBeNull();

    const exact = scoreMatch(
      {
        postedOn: "2026-04-09",
        amountCents: -2000,
        rawDescription: "STARBUCKS",
        categorySlug: "coffee",
      },
      { ...logged("2026-04-09", -2000, "Blue Bottle"), categorySlug: "coffee" },
    );
    expect(exact).not.toBeNull();
  });
});


describe("the rule: agree on amount and date unless something contradicts", () => {
  it("merges an exact amount in the window with no other evidence", () => {
    const r = scoreMatch(
      statement("2026-05-12", -2200, "SOME UNRECOGNIZED MERCHANT"),
      logged("2026-05-10", -2200, "that thing I bought"),
    );
    expect(r).not.toBeNull();
    expect(r!.evidence).toBe("amount_and_date_only");
  });

  it("still refuses when the categories actively disagree", () => {
    // Positive evidence that these are different purchases.
    expect(
      scoreMatch(
        {
          postedOn: "2026-05-12",
          amountCents: -2200,
          rawDescription: "SHELL OIL 5744",
          categorySlug: "gas-fuel",
        },
        { ...logged("2026-05-12", -2200, "lunch"), categorySlug: "restaurants" },
      ),
    ).toBeNull();
  });

  it("does not let a merchant mismatch block an exact amount", () => {
    /*
     * Deliberate. The logged side is prose — "new headphones" against
     * `BEST BUY` looks like conflicting merchants but is not. Blocking on it
     * caused misses, and a miss double-counts real money where a wrong merge
     * only mislabels a row (see the false-merge total test).
     */
    const r = scoreMatch(
      { postedOn: "2026-05-12", amountCents: -20000, rawDescription: "BEST BUY 0421" },
      logged("2026-05-12", -20000, "new headphones"),
    );
    expect(r).not.toBeNull();
  });

  it("reports the evidence tier so callers can decide whether to ask", () => {
    const strong = scoreMatch(
      statement("2026-05-12", -2200, "SQ *BLUE BOTTLE COFFEE"),
      logged("2026-05-12", -2200, "Blue Bottle"),
    );
    expect(strong!.evidence).toBe("strong");

    const moderate = scoreMatch(
      {
        postedOn: "2026-05-12",
        amountCents: -4810,
        rawDescription: "SHELL OIL 5744",
        categorySlug: "gas-fuel",
      },
      { ...logged("2026-05-12", -4810, "gas"), categorySlug: "gas-fuel" },
    );
    expect(moderate!.evidence).toBe("moderate");
  });

  it("keeps the date window as the outer bound", () => {
    expect(
      scoreMatch(
        statement("2026-05-25", -2200, "ANYTHING"),
        logged("2026-05-10", -2200, "anything"),
      ),
    ).toBeNull();
  });
});
