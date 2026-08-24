import { describe, it, expect } from "vitest";
import { detectSeries, cadenceFor } from "@/lib/recurring/detect";

function monthly(merchant: string, amounts: number[], startDay = "2026-01-15") {
  const [y, m, d] = startDay.split("-").map(Number);
  return amounts.map((amountCents, i) => {
    const date = new Date(Date.UTC(y!, m! - 1 + i, d!));
    return {
      id: `${merchant}-${i}`,
      merchant,
      categoryId: null,
      postedOn: date.toISOString().slice(0, 10),
      amountCents,
    };
  });
}

describe("cadenceFor", () => {
  it("bands common intervals", () => {
    expect(cadenceFor(7).cadence).toBe("weekly");
    expect(cadenceFor(14).cadence).toBe("biweekly");
    expect(cadenceFor(30).cadence).toBe("monthly");
    expect(cadenceFor(91).cadence).toBe("quarterly");
    expect(cadenceFor(365).cadence).toBe("annual");
    expect(cadenceFor(45).cadence).toBe("irregular");
  });
});

describe("detectSeries", () => {
  it("detects a steady monthly subscription", () => {
    const rows = monthly("Netflix", [-1599, -1599, -1599, -1599]);
    const series = detectSeries(rows, "2026-05-01");
    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({
      merchant: "Netflix",
      cadence: "monthly",
      typicalAmountCents: 1599,
      occurrences: 4,
      status: "active",
    });
    expect(series[0]!.annualizedCents).toBe(1599 * 12);
  });

  it("needs at least three occurrences", () => {
    expect(detectSeries(monthly("Hulu", [-999, -999]), "2026-03-01")).toHaveLength(0);
  });

  it("rejects wildly varying amounts", () => {
    const rows = monthly("Groceries", [-4000, -18000, -6500, -22000]);
    expect(detectSeries(rows, "2026-05-01")).toHaveLength(0);
  });

  it("tolerates a small price change", () => {
    const rows = monthly("Spotify", [-999, -999, -1099, -1099]);
    const series = detectSeries(rows, "2026-05-01");
    expect(series).toHaveLength(1);
    expect(series[0]!.priceChangePct).toBeCloseTo(10.01, 1);
  });

  it("marks a lapsed series as ended", () => {
    const rows = monthly("OldGym", [-3500, -3500, -3500], "2025-01-10");
    const series = detectSeries(rows, "2026-06-01");
    expect(series[0]!.status).toBe("ended");
  });

  it("collapses same-day split charges into one occurrence", () => {
    const rows = [
      ...monthly("Utility", [-5000, -5000, -5000]),
      { id: "extra", merchant: "Utility", categoryId: null, postedOn: "2026-01-15", amountCents: -1000 },
    ];
    const series = detectSeries(rows, "2026-04-01");
    expect(series[0]!.occurrences).toBe(3);
  });

  it("ignores irregular timing", () => {
    const rows = [
      { id: "1", merchant: "Random", categoryId: null, postedOn: "2026-01-03", amountCents: -2000 },
      { id: "2", merchant: "Random", categoryId: null, postedOn: "2026-01-19", amountCents: -2000 },
      { id: "3", merchant: "Random", categoryId: null, postedOn: "2026-04-02", amountCents: -2000 },
    ];
    expect(detectSeries(rows, "2026-05-01")).toHaveLength(0);
  });
});
