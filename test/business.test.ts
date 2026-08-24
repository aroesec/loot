import { describe, it, expect } from "vitest";
import {
  BUSINESS_CATEGORIES,
  BUSINESS_SEED_RULES,
  OWNER_DRAW,
  BUSINESS_UNCATEGORIZED,
} from "@/lib/classify/taxonomy-business";
import { DEFAULT_CATEGORIES, SEED_RULES } from "@/lib/classify/taxonomy";

/**
 * The business chart of accounts has one failure mode that the personal one
 * does not: a wrong answer here can end up on a tax return. Filing an owner's
 * draw as an expense understates profit and overstates deductions, and like
 * the transfer-flag bugs it produces a number that still balances.
 */
describe("owner equity is not an expense", () => {
  const bySlug = new Map(BUSINESS_CATEGORIES.map((c) => [c.slug, c]));

  it("keeps an owner's draw out of the P&L and out of deductions", () => {
    const draw = bySlug.get(OWNER_DRAW);
    expect(draw).toBeDefined();
    expect(draw!.plSection).toBe("owner_equity");
    // Not an expense: it is profit being withdrawn, not a cost of earning it.
    expect(draw!.kind).toBe("transfer");
    expect(draw!.deductiblePct).toBeUndefined();
    expect(draw!.scheduleCLine).toBeUndefined();
  });

  it("treats estimated tax and owner contributions the same way", () => {
    for (const slug of ["estimated-taxes", "owner-contribution"]) {
      const cat = bySlug.get(slug);
      expect(cat, slug).toBeDefined();
      expect(cat!.plSection, slug).toBe("owner_equity");
      expect(cat!.deductiblePct, slug).toBeUndefined();
    }
  });

  it("never marks an owner-equity category deductible", () => {
    // Asserted across the whole section rather than case by case, so a new
    // category cannot quietly arrive with a deduction attached.
    for (const c of BUSINESS_CATEGORIES.filter(
      (c) => c.plSection === "owner_equity",
    )) {
      expect(c.deductiblePct, c.slug).toBeUndefined();
      expect(c.budgetable, c.slug).toBe(false);
    }
  });

  it("flags the rules that move money to the owner or the IRS", () => {
    for (const slug of ["estimated-taxes"]) {
      const rules = BUSINESS_SEED_RULES.filter((r) => r.category === slug);
      expect(rules.length, slug).toBeGreaterThan(0);
      for (const r of rules) expect(r.isTransfer, r.pattern).toBe(true);
    }
  });
});

describe("profit and loss structure", () => {
  it("assigns every business category to a P&L section", () => {
    // A category with no section is invisible in the report it exists for.
    for (const c of BUSINESS_CATEGORIES) {
      expect(c.plSection, c.slug).toBeDefined();
    }
  });

  it("separates COGS from operating expenses", () => {
    // Gross margin is meaningless if these are mixed.
    const cogs = BUSINESS_CATEGORIES.filter((c) => c.plSection === "cogs");
    const opex = BUSINESS_CATEGORIES.filter((c) => c.plSection === "opex");
    expect(cogs.length).toBeGreaterThan(0);
    expect(opex.length).toBeGreaterThan(0);

    for (const slug of ["materials", "inventory", "subcontractors"]) {
      expect(cogs.some((c) => c.slug === slug), slug).toBe(true);
    }
    for (const slug of ["biz-software", "marketing", "biz-insurance"]) {
      expect(opex.some((c) => c.slug === slug), slug).toBe(true);
    }
  });

  it("gives every deductible expense a Schedule C line", () => {
    // The point of the deductible flag is a year-end export an accountant can
    // read; a percentage with no line number does not achieve that.
    for (const c of BUSINESS_CATEGORIES) {
      if (c.deductiblePct === undefined) continue;
      expect(c.scheduleCLine, c.slug).toBeTruthy();
    }
  });

  it("keeps deductible percentages in range", () => {
    for (const c of BUSINESS_CATEGORIES) {
      if (c.deductiblePct === undefined) continue;
      expect(c.deductiblePct, c.slug).toBeGreaterThan(0);
      expect(c.deductiblePct, c.slug).toBeLessThanOrEqual(100);
    }
  });

  it("defaults the commonly-partial deductions to a share, not the whole bill", () => {
    /*
     * The cases where claiming 100% would be wrong for most filers. Being
     * conservative by default is the safe direction: too low costs a
     * correction, too high costs an overstated deduction.
     */
    expect(new Map(BUSINESS_CATEGORIES.map((c) => [c.slug, c])).get("business-meals")!
      .deductiblePct).toBe(50);
    for (const slug of ["home-office", "biz-phone"]) {
      const pct = BUSINESS_CATEGORIES.find((c) => c.slug === slug)!.deductiblePct!;
      expect(pct, slug).toBeLessThan(100);
    }
  });

  it("counts a refund issued to a customer against revenue", () => {
    // Not an expense: it reduces what was earned.
    const refunds = BUSINESS_CATEGORIES.find((c) => c.slug === "refunds-issued")!;
    expect(refunds.plSection).toBe("revenue");
  });
});

describe("the two charts of accounts coexist", () => {
  it("tags every business category and rule as business", () => {
    for (const c of BUSINESS_CATEGORIES) expect(c.mode, c.slug).toBe("business");
    for (const r of BUSINESS_SEED_RULES) expect(r.mode, r.pattern).toBe("business");
  });

  it("does not collide on category slugs", () => {
    // Slugs are globally unique in the table, so an overlap would make one
    // chart silently overwrite the other's category on seed.
    const personal = new Set(DEFAULT_CATEGORIES.map((c) => c.slug));
    const overlap = BUSINESS_CATEGORIES.filter((c) => personal.has(c.slug));
    expect(overlap.map((c) => c.slug)).toEqual([]);
  });

  it("allows the same rule pattern in both charts", () => {
    /*
     * "internal transfer" means the same thing to a person and a business but
     * points at a different category, so mode is part of the rule's identity.
     * These overlaps are expected — the test asserts they are distinguishable.
     */
    const personal = new Set(SEED_RULES.map((r) => r.pattern));
    const shared = BUSINESS_SEED_RULES.filter((r) => personal.has(r.pattern));
    expect(shared.length).toBeGreaterThan(0);

    for (const r of shared) {
      const key = `${r.pattern}|${r.matchType ?? "contains"}|${r.appliesTo ?? "any"}|${r.mode}`;
      const personalKey = `${r.pattern}|${r.matchType ?? "contains"}|${r.appliesTo ?? "any"}|personal`;
      expect(key, r.pattern).not.toBe(personalKey);
    }
  });

  it("has its own uncategorized floor", () => {
    const floor = BUSINESS_CATEGORIES.find((c) => c.slug === BUSINESS_UNCATEGORIZED);
    expect(floor).toBeDefined();
    expect(floor!.isSystem).toBe(true);
  });
});

describe("business payment rails", () => {
  it("charges rail payments as an expense and queues them", () => {
    /*
     * Same reasoning as the personal ledger, with a sharper edge: a Zelle out
     * of a business account could be a subcontractor, a refund or the owner
     * paying themselves. Defaulting it to a deductible category would invent a
     * deduction, so it lands in the unbudgetable floor and asks.
     */
    for (const rail of ["zelle", "venmo", "cash app"]) {
      const rule = BUSINESS_SEED_RULES.find(
        (r) => r.pattern === rail && r.appliesTo === "debit",
      );
      expect(rule, rail).toBeDefined();
      expect(rule!.queueForReview, rail).toBe(true);
      expect(rule!.isTransfer ?? false, rail).toBe(false);
      expect(rule!.category, rail).toBe(BUSINESS_UNCATEGORIZED);
    }
  });

  it("does not route a rail payment straight to a deductible category", () => {
    const bySlug = new Map(BUSINESS_CATEGORIES.map((c) => [c.slug, c]));
    for (const rail of ["zelle", "venmo", "cash app"]) {
      const rule = BUSINESS_SEED_RULES.find(
        (r) => r.pattern === rail && r.appliesTo === "debit",
      )!;
      const cat = bySlug.get(String(rule.category));
      expect(cat?.deductiblePct, rail).toBeUndefined();
    }
  });
});

/**
 * Reading a card payment's coverage.
 *
 * The thresholds are loose because a payment is rarely to the cent — a few
 * dollars of drift between a statement close and a posting date is normal, and
 * calling that "a balance was carried" would be noise rather than information.
 */
describe("card payment coverage", () => {
  it("reads a near-exact payment as paid in full", async () => {
    const { describeCoverage } = await import("@/lib/reconcile/coverage");
    // The real case: $1,299.04 paid against $1,304.04 of charges.
    expect(describeCoverage(1299.04 / 1304.04)!.label).toBe("paid in full");
    expect(describeCoverage(1)!.label).toBe("paid in full");
    expect(describeCoverage(0.97)!.label).toBe("paid in full");
    expect(describeCoverage(1.04)!.label).toBe("paid in full");
  });

  it("recognizes a carried balance", async () => {
    const { describeCoverage } = await import("@/lib/reconcile/coverage");
    expect(describeCoverage(0.5)!.label).toBe("balance carried");
    expect(describeCoverage(0.1)!.label).toBe("balance carried");
  });

  it("recognizes a payment clearing an older balance", async () => {
    const { describeCoverage } = await import("@/lib/reconcile/coverage");
    // 897% happens when a cycle's charges are small and an old balance is paid.
    expect(describeCoverage(8.97)!.label).toBe("cleared more than this window");
    expect(describeCoverage(2.08)!.label).toBe("cleared more than this window");
  });

  it("says nothing when there are no charges to compare against", async () => {
    const { describeCoverage } = await import("@/lib/reconcile/coverage");
    // Dividing by zero charges would produce Infinity and a confident label.
    expect(describeCoverage(null)).toBeNull();
  });
});

/**
 * Naming the issuer behind a card payment.
 *
 * Only the pure half is tested here; the resolution itself reads the ledger.
 * The bug it guards against is that a card with no account row is invisible to
 * anything that enumerates accounts — an APPLECARD payment sat excluded across
 * two months with nothing behind it, because there was no Apple Card to find.
 */
describe("issuer identification", () => {
  it("names an issuer that has no account in the ledger", async () => {
    const { issuerFromDescription } = await import("@/lib/reconcile/issuer");
    expect(issuerFromDescription("APPLECARD GSBANK PAYMENT 10000001 WEB ID: 9")).toBe(
      "Apple Card",
    );
    expect(issuerFromDescription("CAPITAL ONE      MOBILE PMT CA0AAAA1")).toBe(
      "Capital One",
    );
  });

  it("keeps the last four so two cards at one issuer stay distinct", async () => {
    const { issuerFromDescription } = await import("@/lib/reconcile/issuer");
    expect(issuerFromDescription("Payment to Chase card ending in 4242 08/21")).toBe(
      "Chase ••4242",
    );
    expect(issuerFromDescription("Payment to Chase card ending in 1881 08/21")).toBe(
      "Chase ••1881",
    );
  });

  it("still produces something usable for an unknown issuer", async () => {
    const { issuerFromDescription } = await import("@/lib/reconcile/issuer");
    // Never empty: a warning that names nothing cannot be acted on.
    expect(issuerFromDescription("SOMEBANK CARD PMT 4471")).toBeTruthy();
    expect(issuerFromDescription("random payment")).toBeTruthy();
  });
});
