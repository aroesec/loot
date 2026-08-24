import { describe, it, expect } from "vitest";
import {
  matchRule,
  derivePattern,
  sortRules,
  SEED_PRIORITY,
} from "@/lib/classify/match";
import { normalizeDescription } from "@/lib/classify/normalize";
import { SEED_RULES, TRANSFER } from "@/lib/classify/taxonomy";
import type { MerchantRule } from "@/db/schema";

/**
 * Build the in-memory rule set the classifier would see after seeding, sorted
 * the way `loadRules` sorts it: priority desc, then longer pattern first.
 *
 * `categoryId` stands in for the real uuid — these tests care which category
 * slug a description lands on, not which row it lives in.
 */
function seededRules(): MerchantRule[] {
  return SEED_RULES.map((r, i) => ({
    id: `rule-${i}`,
    pattern: r.pattern,
    matchType: r.matchType ?? "contains",
    categoryId: r.category,
    merchantName: r.merchant ?? null,
    priority: r.priority ?? SEED_PRIORITY,
    source: "seed",
    appliesTo: r.appliesTo ?? "any",
    isTransfer: r.isTransfer ?? false,
    queueForReview: r.queueForReview ?? false,
    enabled: true,
    hitCount: 0,
    lastMatchedAt: null,
    createdAt: new Date(),
  })) as unknown as MerchantRule[];
}

const RULES = sortRules(seededRules());

/** What the pipeline would end up with: category slug, or null to ask the model. */
function classify(description: string, amountCents: number) {
  const match = matchRule(normalizeDescription(description), RULES, amountCents);
  if (!match) {
    return {
      slug: null,
      merchant: null,
      isTransfer: false,
      queueForReview: false,
    };
  }
  return {
    slug: match.categoryId,
    merchant: match.merchantName,
    isTransfer: match.isTransfer,
    queueForReview: match.queueForReview,
  };
}

describe("transfer flag", () => {
  /*
   * The regression this whole file exists for. Venmo and Zelle were seeded as
   * isTransfer, so $6,000 paid to a person for contract work was dropped from
   * every spend total and the month reported $5,000.00 of spending.
   *
   * A payment rail is not a destination: the money left and is not coming
   * back. Only a move between two of the person's own accounts may set the
   * flag, because only then is the same dollar counted on the other side.
   */
  it("does not treat money sent to a person as a transfer", () => {
    const cases: Array<[string, number]> = [
      ["Zelle payment to JORDAN 10000000001", -100_000],
      ["VENMO            PAYMENT    10000000002   WEB ID: 20000000001", -300_000],
      ["VENMO *Frank Fragleass Visa Direct NY        08/16", -20_000],
      ["CASH APP*SOMEONE", -5_000],
    ];
    for (const [description, amountCents] of cases) {
      const result = classify(description, amountCents);
      expect(result.isTransfer, description).toBe(false);
      expect(result.slug, description).not.toBe(TRANSFER);
    }
  });

  /*
   * The rail says how the money moved, never what it bought, so it carries no
   * category — and unlike an unrecognized merchant, no amount of reading will
   * produce one. "Zelle payment to JORDAN 10000000006" is a name and a
   * reference number. The model answers Uncategorized every time, so these are
   * queued for the person instead of costing a call to reach that.
   */
  it("charges an outbound rail payment as an expense and queues it", () => {
    for (const [description, merchant] of [
      ["Zelle payment to JORDAN 10000000001", "Zelle"],
      ["VENMO *Tara Stack New York NY  08/03", "Venmo"],
      ["CASH APP*SOMEONE", "Cash App"],
    ] as const) {
      const result = classify(description, -100_000);
      // Counted straight away: an unanswered question must not cost the
      // month's total. Not Uncategorized, which is unbudgetable.
      expect(result.slug, description).toBe("person-to-person");
      expect(result.isTransfer, description).toBe(false);
      // And still asked, because a holding place is not an answer.
      expect(result.queueForReview, description).toBe(true);
      expect(result.merchant, description).toBe(merchant);
    }
  });

  it("does not queue rows a rule can already answer", () => {
    // Queueing is for descriptions that cannot answer the question, not for
    // everything a seed happens to match.
    expect(classify("STARBUCKS STORE 13938 CONIFER CO", -500).queueForReview).toBe(
      false,
    );
    expect(
      classify("Zelle payment from MATTHEW DEPAOLA TDP0K8I9LAT9", 6_000)
        .queueForReview,
    ).toBe(false);
  });

  it("still excludes a move between the person's own accounts", () => {
    const result = classify(
      "Online Transfer to CHK ...1234 transaction#: 30000000002 08/03",
      -451_811,
    );
    expect(result.isTransfer).toBe(true);
    expect(result.slug).toBe(TRANSFER);
  });

  it("categorizes ATM and savings instead of hiding them", () => {
    expect(classify("ATM WITHDRAWAL 009503 08/01331 LAFAY", -30_000)).toMatchObject({
      slug: "cash-withdrawal",
      isTransfer: false,
    });
    expect(classify("ALLY BANK  $TRANSFER 10000000003 WEB ID: 20000000002", -50_000)).toMatchObject({
      slug: "investments",
      isTransfer: false,
    });
  });
});

describe("credit card payments", () => {
  /*
   * The swipe is the expense; the payment only settles the balance. Counting
   * both charges the same dollar twice — once on the card statement and again
   * on the checking statement — which is what makes a budget unusable.
   *
   * Both sides carry the flag, and they look nothing alike: the checking side
   * is a debit naming the card, the card side is a *positive* amount that
   * would otherwise read as income.
   */
  it("excludes the debit leaving checking", () => {
    for (const description of [
      "Payment to Chase card ending in 4321 08/21",
      "CAPITAL ONE      MOBILE PMT CA0AAAA10000001 WEB ID: 20000000003",
    ]) {
      const result = classify(description, -209_904);
      expect(result.slug, description).toBe("card-payment");
      expect(result.isTransfer, description).toBe(true);
    }
  });

  it("excludes the matching credit on the card statement", () => {
    for (const description of [
      "PAYMENT THANK YOU",
      "AUTOPAY PAYMENT - THANK YOU",
      "ONLINE PAYMENT FROM CHK 1234",
    ]) {
      const result = classify(description, 209_904);
      expect(result.slug, description).toBe("card-payment");
      // Positive and flagged: it must not surface as income either.
      expect(result.isTransfer, description).toBe(true);
    }
  });

  it("still counts what was actually charged to the card", () => {
    // A purchase is a purchase whichever account it landed on.
    expect(classify("STARBUCKS STORE 13938 CONIFER CO", -500)).toMatchObject({
      slug: "coffee",
      isTransfer: false,
    });
    expect(classify("KING SOOPERS #0087 CONIFER CO", -17_284)).toMatchObject({
      slug: "groceries",
      isTransfer: false,
    });
  });
});

describe("income is never swallowed", () => {
  /*
   * Income can only be lost one way. The ledger totals by sign, so a positive
   * amount counts whatever category it lands in — an imperfect category still
   * counts. `is_transfer` is the single thing that removes it, so every rule
   * able to set it on an inflow has to earn that.
   */
  it("only flags an inflow when the pattern names a payment or an account", () => {
    const canExcludeAnInflow = RULES.filter(
      (r) => r.isTransfer && r.appliesTo !== "debit",
    );
    expect(canExcludeAnInflow.length).toBeGreaterThan(0);

    /*
     * Two shapes earn the flag in either direction:
     *
     *   names a payment  — "payment thank you", "autopay payment", "mobile pmt"
     *   names an account — "chk ...", "card ending in", "transfer to savings"
     *
     * A bare institution name earns neither. Money arriving from an issuer is
     * cashback or a refund, so "capital one" has to be scoped to debits.
     */
    const namesAPaymentOrAccount = (pattern: string) =>
      /payment|pmt|autopay|transfer|card ending|chk |sav /.test(pattern);

    for (const rule of canExcludeAnInflow) {
      expect(
        namesAPaymentOrAccount(rule.pattern),
        `"${rule.pattern}" can strip an inflow out of income on the strength of a name alone — scope it to debit`,
      ).toBe(true);
    }
  });

  it("counts money arriving from a card issuer as income", () => {
    // A cashback redemption or refund deposited to checking. The outbound
    // payment to the same issuer is still excluded.
    const inbound = classify("CAPITAL ONE      CASHBACK REDEMPTION", 12_500);
    expect(inbound.isTransfer).toBe(false);

    const outbound = classify(
      "CAPITAL ONE      MOBILE PMT CA0AAAA10000001",
      -143_031,
    );
    expect(outbound.isTransfer).toBe(true);
  });

  it("counts payroll and reimbursements", () => {
    for (const [description, amount] of [
      ["ACME CORP   PAYROLL                    PPD ID: 20000000004", 500_000],
      ["GUSTO            PAYROLL", 195_308],
      ["Zelle payment from MATTHEW DEPAOLA TDP0K8I9LAT9", 6_000],
      ["VENMO            CASHOUT", 13_500],
    ] as const) {
      expect(classify(description, amount).isTransfer, description).toBe(false);
    }
  });
});

describe("direction-scoped rules", () => {
  /*
   * "FID BKG SVC LLC MONEYLINE" carries money both ways: $900 out to Fidelity
   * and $10,000.00 back. One rule for both would have booked the return trip
   * as a contribution.
   */
  it("splits the same description by sign", () => {
    const out = classify("FID BKG SVC LLC  MONEYLINE  PPD ID: 10000000004", -30_000);
    expect(out.slug).toBe("investments");

    const back = classify(
      "FID BKG SVC LLC  MONEYLINE  Z10000001 ABCDE WEB ID: 10000000005",
      500_000,
    );
    expect(back.slug).toBe("investment-withdrawal");
  });

  it("declines to fire either way when the amount is unknown", () => {
    // Better to fall through to the model than to pick a direction at random.
    const match = matchRule(
      normalizeDescription("FID BKG SVC LLC  MONEYLINE  PPD ID: 10000000004"),
      RULES,
      null,
    );
    expect(match).toBeNull();
  });

  it("reads an incoming person-to-person payment as a reimbursement", () => {
    expect(classify("Zelle payment from MATTHEW DEPAOLA TDP0K8I9LAT9", 6_000).slug).toBe(
      "refunds",
    );
    expect(classify("VENMO  CASHOUT  PPD ID: 20000000005", 13_500).slug).toBe("refunds");
  });
});

describe("pattern collisions", () => {
  /*
   * `mobil` matched by `contains` also sits inside "MOBILE PMT", which filed a
   * $1,430.00 Capital One card payment as Gas & Fuel — and made a gas station
   * the month's top merchant.
   */
  it("does not read MOBILE PMT as a gas station", () => {
    const result = classify(
      "CAPITAL ONE      MOBILE PMT CA0AAAA10000001 WEB ID: 20000000003",
      -143_031,
    );
    expect(result.slug).toBe("card-payment");
    expect(result.slug).not.toBe("gas-fuel");
  });

  it("still matches the actual gas station", () => {
    expect(classify("MOBIL 7-ELEVEN 12345 SPRINGFIELD CO", -4_500).slug).toBe("gas-fuel");
    expect(classify("EXXONMOBIL 4471", -6_000).slug).toBe("gas-fuel");
  });
});

describe("derivePattern", () => {
  it("keeps two words for an ordinary merchant", () => {
    expect(derivePattern("TRADER JOE'S #123 SPRINGFIELD CO")).toBe("trader joe's");
    expect(derivePattern("NETFLIX.COM")).toBe("netflix.com");
  });

  /*
   * On a rail the first two words are "zelle payment", so a single correction
   * would have refiled every future Zelle. Reaching the counterparty keeps the
   * learned rule about Jordan.
   */
  it("reaches the counterparty on a payment rail", () => {
    expect(derivePattern("Zelle payment to JORDAN 10000000001")).toBe(
      "zelle payment to jordan",
    );
    expect(derivePattern("Zelle payment to JORDAN 10000000001")).not.toBe(
      "zelle payment",
    );
  });

  it("prefers a rule that never fires over one that over-matches", () => {
    // No counterparty in the description, so the reference number lands in the
    // pattern and nothing else will ever match it. That costs one
    // re-correction; the alternative rewrites unrelated history.
    const pattern = derivePattern(
      "VENMO            PAYMENT    10000000002   WEB ID: 20000000001",
    );
    expect(pattern).toContain("10000000002");
    expect(pattern).not.toBe("venmo payment");
  });
});

/**
 * The seed list is now broad enough that reading it case by case proves
 * nothing. These assert the properties over the whole set instead, so a rule
 * added later cannot quietly break them.
 */
describe("seed rule invariants", () => {
  /*
   * The Venmo/Zelle bug, generalized. A payment rail describes how money moved,
   * never where it went, so flagging one as a transfer deletes real spending
   * from the totals.
   */
  it("never flags a payment rail as a transfer", () => {
    const rails = /venmo|zelle|cash app|cashapp|paypal|apple cash/;
    const offenders = SEED_RULES.filter(
      (r) => rails.test(r.pattern) && r.isTransfer === true,
    ).map((r) => r.pattern);

    expect(offenders).toEqual([]);
  });

  /*
   * `mobil` inside `MOBILE PMT` filed a card payment as gas and made a filling
   * station the month's top merchant.
   *
   * Length alone is the wrong test — "aldi" and "lyft" are short and perfectly
   * safe. What matters is whether the pattern hides inside a word a statement
   * actually contains, so that is what is checked.
   */
  it("anchors patterns that hide inside ordinary statement words", () => {
    const wordsOnRealStatements = [
      "mobile pmt", "payment", "prepayment", "discovery", "citywide",
      "purchase", "transfer", "deposit", "withdrawal", "merchandise",
      "pharmacy", "restaurant", "wholesale", "installment", "sofia",
      "mustache", "stashed", "chaser", "banking",
    ];

    const unanchored = SEED_RULES.filter(
      (r) =>
        r.matchType !== "regex" &&
        wordsOnRealStatements.some(
          (w) => w !== r.pattern && w.includes(r.pattern),
        ),
    ).map((r) => r.pattern);

    expect(unanchored).toEqual([]);
  });

  /* A direction-scoped pair must not disagree about the transfer flag. */
  it("keeps every pattern's meaning consistent across directions", () => {
    const byPattern = new Map<string, Set<boolean>>();
    for (const r of SEED_RULES) {
      const key = `${r.pattern}|${r.matchType ?? "contains"}`;
      byPattern.set(key, (byPattern.get(key) ?? new Set()).add(r.isTransfer === true));
    }
    const conflicting = [...byPattern.entries()]
      .filter(([, flags]) => flags.size > 1)
      .map(([key]) => key);

    expect(conflicting).toEqual([]);
  });
});
