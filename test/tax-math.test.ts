import { describe, expect, it } from "vitest";
import {
  nextQuarterDue,
  quarterDueDates,
  selfEmploymentTax,
  setAside,
  wageBase,
} from "@/lib/tax-math";

describe("selfEmploymentTax", () => {
  it("taxes 92.35% of profit at 15.3% below the wage base", () => {
    // $50,000 profit → $46,175 taxable → 15.3% = $7,064.78
    const t = selfEmploymentTax(5_000_000, 2025);
    expect(t.taxableCents).toBe(4_617_500);
    expect(t.totalCents).toBe(706_478);
  });

  it("stops Social Security at the wage base but not Medicare", () => {
    /*
     * The case that matters most, because it is wrong by thousands if the cap
     * is ignored, and the person above the cap is the one most likely to be
     * relying on the figure.
     *
     * $300,000 profit → $277,050 taxable. Social Security applies to the first
     * $176,100 only; Medicare applies to all of it.
     */
    const t = selfEmploymentTax(30_000_000, 2025);
    expect(t.taxableCents).toBe(27_705_000);
    expect(t.socialSecurityCents).toBe(Math.round(17_610_000 * 0.124));
    expect(t.medicareCents).toBe(Math.round(27_705_000 * 0.029));

    const uncapped = Math.round(27_705_000 * 0.153);
    expect(t.totalCents).toBeLessThan(uncapped);
    // Roughly $12,300 of difference; the point is that it is material.
    expect(uncapped - t.totalCents).toBeGreaterThan(1_000_000);
  });

  it("owes nothing on a loss", () => {
    const t = selfEmploymentTax(-500_000, 2025);
    expect(t.totalCents).toBe(0);
    expect(t.taxableCents).toBe(0);
  });

  it("owes nothing at exactly zero profit", () => {
    expect(selfEmploymentTax(0, 2025).totalCents).toBe(0);
  });

  it("reports half as deductible", () => {
    const t = selfEmploymentTax(5_000_000, 2025);
    expect(t.deductibleHalfCents).toBe(Math.round(t.totalCents / 2));
  });
});

describe("wageBase", () => {
  it("uses the published figure for a known year", () => {
    expect(wageBase(2025)).toEqual({ cents: 17_610_000, exact: true });
    expect(wageBase(2024)).toEqual({ cents: 16_860_000, exact: true });
  });

  it("falls back to the latest known year and admits it", () => {
    /*
     * The SSA sets this annually and there is no way to derive it. Silently
     * carrying last year's number forward would understate the cap; saying so
     * lets the UI mark the figure as approximate.
     */
    const future = wageBase(2030);
    expect(future.exact).toBe(false);
    expect(future.cents).toBe(17_610_000);
  });

  it("marks self-employment tax as approximate in an unknown year", () => {
    expect(selfEmploymentTax(5_000_000, 2030).wageBaseExact).toBe(false);
    expect(selfEmploymentTax(5_000_000, 2025).wageBaseExact).toBe(true);
  });
});

describe("setAside", () => {
  it("applies the income tax rate after deducting half the SE tax", () => {
    // That is how the return works, and ignoring it overstates the set-aside.
    const s = setAside(5_000_000, 2025, 22);
    const half = s.selfEmployment.deductibleHalfCents;
    expect(s.incomeTaxCents).toBe(Math.round((5_000_000 - half) * 0.22));
    expect(s.totalCents).toBe(s.selfEmployment.totalCents + s.incomeTaxCents);
  });

  it("sets nothing aside on a loss", () => {
    const s = setAside(-100_000, 2025, 22);
    expect(s.totalCents).toBe(0);
    expect(s.effectiveRate).toBeNull();
  });

  it("charges only self-employment tax at a zero income rate", () => {
    const s = setAside(5_000_000, 2025, 0);
    expect(s.incomeTaxCents).toBe(0);
    expect(s.totalCents).toBe(s.selfEmployment.totalCents);
  });

  it("reports an effective rate that is plausible", () => {
    const s = setAside(8_000_000, 2025, 24);
    expect(s.effectiveRate).toBeGreaterThan(0.25);
    expect(s.effectiveRate).toBeLessThan(0.45);
  });
});

describe("quarterDueDates", () => {
  it("uses the real dates, which do not match the quarters they cover", () => {
    /*
     * Q2 covers two months and Q4 is paid the following January. Deriving these
     * from the quarter number gives three wrong answers.
     */
    const q = quarterDueDates(2026);
    expect(q.map((x) => x.due)).toEqual([
      "2026-04-15",
      "2026-06-15",
      "2026-09-15",
      "2027-01-15",
    ]);
  });

  it("finds the next payment due", () => {
    expect(nextQuarterDue(2026, "2026-05-01")?.quarter).toBe(2);
    expect(nextQuarterDue(2026, "2026-06-15")?.quarter).toBe(2); // due today counts
    expect(nextQuarterDue(2026, "2026-06-16")?.quarter).toBe(3);
  });

  it("returns null once the year is settled", () => {
    expect(nextQuarterDue(2026, "2027-02-01")).toBeNull();
  });
});

/**
 * Line ordering decides the sequence figures are read off the form in, so it
 * is tested against the real function rather than a copy of it.
 */
describe("lineOrder", () => {
  it("sorts numerically rather than as text", async () => {
    const { lineOrder } = await import("@/lib/tax-lines");
    // "11" must come after "8", which a string sort gets backwards.
    expect(lineOrder("8 — Advertising")).toBeLessThan(lineOrder("11 — Contract labor"));
    expect(lineOrder("11 — Contract labor")).toBeLessThan(lineOrder("38 — Materials"));
  });

  it("orders letters within a number", async () => {
    const { lineOrder } = await import("@/lib/tax-lines");
    expect(lineOrder("24a — Travel")).toBeLessThan(lineOrder("24b — Meals"));
    expect(lineOrder("24b — Meals")).toBeLessThan(lineOrder("25 — Utilities"));
  });

  it("puts anything unmapped last", async () => {
    const { lineOrder } = await import("@/lib/tax-lines");
    expect(lineOrder(null)).toBeGreaterThan(lineOrder("38 — Materials"));
  });
});

describe("scheduleCsv", () => {
  it("keeps owner draw out of the deductible total and labels it", async () => {
    const { scheduleCsv } = await import("@/lib/tax-lines");
    const csv = scheduleCsv({
      year: 2026,
      grossReceiptsCents: 10_000_00,
      expensesCents: 2_000_00,
      deductibleCents: 1_500_00,
      netProfitCents: 8_500_00,
      revenueLines: [],
      expenseLines: [],
      unmapped: null,
      ownerEquityCents: 5_000_00,
    });
    expect(csv).toContain("Owner's draw (not an expense)");
    expect(csv).toContain("5000.00");
    // Escaped, or a category containing a comma would shift every column.
    expect(csv.split("\n")[0]).toContain('"Schedule C line"');
  });
});
