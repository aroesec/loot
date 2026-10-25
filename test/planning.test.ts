import { weeklyFundForecast } from "@/lib/planning/fund-schedule";
import { describe, it, expect } from "vitest";
import {
  fundForecast,
  suggestExpenses,
  projectExpenses,
  categoryForecast,
  budgetAlert,
  latestExpensePlans,
} from "@/lib/planning/logic";
const row = {
  id: "first",
  accountId: "checking",
  categoryId: "phone",
  merchant: "Example phone",
  amountCents: -9000,
  postedOn: "2026-08-15",
  isTransfer: false,
  status: "cleared",
};
const second = {
  ...row,
  id: "second",
  postedOn: "2026-09-15",
  amountCents: -9500,
};
const plan = {
  accountId: "checking",
  categoryId: "phone",
  merchant: "Example phone",
  name: "Phone bill",
  amountCents: 9500,
  effectiveMonth: "2026-10",
  enabled: true,
};
describe("expense approval and budget forecasts", () => {
  it("suggests two recent monthly charges before this month's charge arrives", () => {
    const suggestions = suggestExpenses({
      month: "2026-10",
      rows: [row, second],
    });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.amountCents).toBe(9500);
    expect(
      projectExpenses({ month: "2026-10", plans: [], rows: [row, second] }),
    ).toEqual([]);
  });
  it("does not merge accounts or categories, include transfers, income or pending charges, or suggest frequent shopping", () => {
    for (const changed of [
      { accountId: "other" },
      { categoryId: "other" },
      { isTransfer: true },
      { amountCents: 9000 },
      { status: "pending" },
      { postedOn: "2026-09-01" },
    ])
      expect(
        suggestExpenses({
          month: "2026-10",
          rows: [row, { ...second, ...changed }],
        }),
      ).toEqual([]);
    expect(
      suggestExpenses({
        month: "2026-10",
        rows: [row, second, { ...second, id: "third", postedOn: "2026-09-20" }],
      }),
    ).toEqual([]);
  });
  it("replaces an approved estimate with the actual recorded charge, including pending ledger spending", () => {
    expect(
      projectExpenses({ month: "2026-10", plans: [plan], rows: [] })[0]
        ?.remainingCents,
    ).toBe(9500);
    const payment = {
      ...second,
      postedOn: "2026-10-16",
      amountCents: -8800,
      status: "pending",
    };
    const [projection] = projectExpenses({
      month: "2026-10",
      plans: [plan],
      rows: [payment, payment],
    });
    expect(projection?.remainingCents).toBe(0);
    expect(projection?.recordedCents).toBe(8800);
    expect(
      projectExpenses({ month: "2026-11", plans: [plan], rows: [payment] })[0]
        ?.remainingCents,
    ).toBe(9500);
  });
  it("preserves month-effective approvals and dismissals", () => {
    const paused = { ...plan, effectiveMonth: "2026-11", enabled: false };
    expect(
      latestExpensePlans({ month: "2026-10", plans: [plan, paused] })[0]
        ?.enabled,
    ).toBe(true);
    expect(
      projectExpenses({ month: "2026-11", plans: [plan, paused], rows: [] }),
    ).toEqual([]);
  });
  it("includes approved bills inside the category budget without adding both", () => {
    expect(
      categoryForecast({
        spentCents: 90000,
        availableCents: 120000,
        recurringRemainingCents: 10000,
      }),
    ).toBe(120000);
    expect(
      categoryForecast({
        spentCents: 90000,
        availableCents: 95000,
        recurringRemainingCents: 10000,
      }),
    ).toBe(100000);
    expect(
      categoryForecast({
        spentCents: 3000,
        availableCents: 0,
        recurringRemainingCents: 9000,
      }),
    ).toBe(12000);
  });
  it("warns at 75 percent and distinguishes no budget, limit and overspending", () => {
    expect(
      budgetAlert({
        spentCents: 90000,
        availableCents: 120000,
        hasBudget: true,
      }),
    ).toBe("Approaching the limit");
    expect(
      budgetAlert({
        spentCents: 120000,
        availableCents: 120000,
        hasBudget: true,
      }),
    ).toBe("At the limit");
    expect(
      budgetAlert({
        spentCents: 120001,
        availableCents: 120000,
        hasBudget: true,
      }),
    ).toBe("Over budget");
    expect(
      budgetAlert({ spentCents: 100, availableCents: 0, hasBudget: false }),
    ).toBe("No budget set");
  });
});

describe("savings and investment cash allocation", () => {
  it("reserves remaining repeat contributions and replaces estimates with actual transfers", () => {
    expect(
      fundForecast({
        contributedCents: 20000,
        withdrawnCents: 3000,
        previousCents: 50000,
        earlierCents: 50000,
      }),
    ).toEqual({
      recurringCents: 50000,
      remainingCents: 30000,
      recordedCents: 17000,
      forecastCents: 47000,
    });
    expect(
      fundForecast({
        contributedCents: 60000,
        withdrawnCents: 0,
        previousCents: 50000,
        earlierCents: 50000,
      }).forecastCents,
    ).toBe(60000);
  });
  it("does not infer a schedule from one-off or widely varying contributions", () => {
    for (const earlierCents of [0, 10000]) {
      expect(
        fundForecast({
          contributedCents: 20000,
          withdrawnCents: 25000,
          previousCents: 50000,
          earlierCents,
        }),
      ).toEqual({
        recurringCents: 0,
        remainingCents: 0,
        recordedCents: -5000,
        forecastCents: -5000,
      });
    }
  });
});

describe("weekly fund plans", () => {
  const schedule = {
    fundId: "test-fund",
    effectiveMonth: "2026-10",
    amountCents: 20000,
    weekday: 2,
    enabled: true,
  };
  it("keeps weekly transfers reserved despite a large one-off deposit and matches a delayed posting once", () => {
    const rows = [6, 14, 20].map((day) => ({
      id: String(day),
      postedOn: `2026-10-${String(day).padStart(2, "0")}`,
      amountCents: -20000,
    }));
    const result = weeklyFundForecast({
      month: "2026-10",
      schedule,
      contributedCents: 160000,
      withdrawnCents: 10000,
      rows: [
        ...rows,
        rows[0]!,
        { id: "extra", postedOn: "2026-10-16", amountCents: -100000 },
      ],
    });
    expect(result.remainingCents).toBe(20000);
    expect(result.forecastCents).toBe(170000);
  });
  it("counts five-week months and stops reserving when paused", () => {
    expect(
      weeklyFundForecast({
        month: "2026-12",
        schedule,
        contributedCents: 0,
        withdrawnCents: 0,
        rows: [],
      }).remainingCents,
    ).toBe(100000);
    expect(
      weeklyFundForecast({
        month: "2026-12",
        schedule: { ...schedule, enabled: false },
        contributedCents: 20000,
        withdrawnCents: 0,
        rows: [],
      }).forecastCents,
    ).toBe(20000);
  });
});
