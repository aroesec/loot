import { describe, expect, it } from "vitest";
import {
  MAX_MILES_TENTHS,
  mileageRate,
  tenthsFromMiles,
  totalDeduction,
  tripDeductionCents,
} from "@/lib/mileage";

/**
 * The IRS revises the rate mid-year sometimes — 2026 ran at 72.5¢ through June
 * and 76¢ from July, and 2022 did the same. A rate looked up by year alone is
 * wrong for half of every year that happens, which is a deduction figure that
 * still looks entirely reasonable.
 */
describe("mileageRate", () => {
  it("changes on the day the rate changes, not at the year boundary", () => {
    expect(mileageRate("2026-06-30").centsPerMile).toBe(72.5);
    expect(mileageRate("2026-07-01").centsPerMile).toBe(76);
  });

  it("carries the newest rate into an unpublished year and says it is not exact", () => {
    expect(mileageRate("2025-04-01")).toEqual({ centsPerMile: 70, exact: true });

    const future = mileageRate("2027-03-01");
    expect(future.centsPerMile).toBe(76);
    expect(future.exact).toBe(false);
  });

  it("falls back rather than throwing for a date before the table starts", () => {
    expect(mileageRate("2019-01-01")).toEqual({ centsPerMile: 65.5, exact: false });
  });
});

describe("tripDeductionCents", () => {
  it("returns whole cents", () => {
    // 100.0 miles at 70¢ = $70.00
    expect(tripDeductionCents(1000, "2025-05-05")).toBe(7000);
    // 12.4 miles at 76¢ = 942.4¢, rounded
    expect(tripDeductionCents(124, "2026-08-01")).toBe(942);
  });
});

describe("totalDeduction", () => {
  it("rates each trip on its own date rather than the total on one rate", () => {
    // The whole point: 100 miles either side of the 2026 change is not 200
    // miles at either rate. 7250 + 7600 = 14850, where a single rate gives
    // 14500 or 15200.
    const total = totalDeduction([
      { milesTenths: 1000, droveOn: "2026-03-01" },
      { milesTenths: 1000, droveOn: "2026-09-01" },
    ]);
    expect(total.deductionCents).toBe(14850);
    expect(total.milesTenths).toBe(2000);
    expect(total.exact).toBe(true);
  });

  it("reports the total as inexact when any trip used a carried rate", () => {
    expect(totalDeduction([{ milesTenths: 100, droveOn: "2027-01-01" }]).exact).toBe(false);
    expect(totalDeduction([]).exact).toBe(true);
  });
});

describe("tenthsFromMiles", () => {
  it("keeps a tenth of a mile and rejects what is not a distance", () => {
    expect(tenthsFromMiles("12.4")).toBe(124);
    expect(tenthsFromMiles(0.05)).toBe(1); // rounds to the nearest tenth
    expect(tenthsFromMiles("0")).toBeNull();
  });

  it("rejects negative and non-numeric input", () => {
    expect(tenthsFromMiles("-5")).toBeNull();
    expect(tenthsFromMiles("twelve")).toBeNull();
    expect(tenthsFromMiles("1e400")).toBeNull();
  });

  it("refuses a distance the column cannot hold", () => {
    // miles_tenths is an int4. Accepting more does not store a big number, it
    // raises "integer out of range" out of a form submission.
    expect(tenthsFromMiles(MAX_MILES_TENTHS / 10)).toBe(MAX_MILES_TENTHS);
    expect(tenthsFromMiles(MAX_MILES_TENTHS)).toBeNull();
  });
});
