import { describe, expect, it } from "vitest";
import { canConfirm, suggestFor } from "@/lib/review-suggest";

const popular = [
  { categoryId: "groceries", name: "Groceries", kind: "expense", count: 90 },
  { categoryId: "restaurants", name: "Restaurants", kind: "expense", count: 60 },
  { categoryId: "salary", name: "Salary", kind: "income", count: 12 },
  { categoryId: "refunds", name: "Refunds", kind: "income", count: 3 },
];

const base = {
  amountCents: -2500,
  merchant: "King Soopers",
  current: null,
  merchantHistory: [],
  popular,
};

describe("suggestFor", () => {
  it("leads with the current category", () => {
    // These rows are uncertain, not necessarily wrong — confirming is the most
    // common outcome, so it should be key 1.
    const out = suggestFor({
      ...base,
      current: { id: "person-to-person", name: "Person to person" },
    });
    expect(out[0]!.categoryId).toBe("person-to-person");
    expect(out[0]!.why).toBe("current");
  });

  it("puts what this merchant usually is ahead of what is merely popular", () => {
    const out = suggestFor({
      ...base,
      merchantHistory: [
        { categoryId: "groceries", name: "Groceries", count: 9 },
        { categoryId: "restaurants", name: "Restaurants", count: 1 },
      ],
    });
    expect(out.map((s) => s.categoryId).slice(0, 2)).toEqual([
      "groceries",
      "restaurants",
    ]);
    expect(out[0]!.why).toBe("filed here 9×");
  });

  it("never offers an income category for money going out", () => {
    // The sign is the one thing about these rows that is never in doubt, and a
    // fast queue makes a wrong first offer expensive.
    const out = suggestFor({ ...base, amountCents: -2500 });
    expect(out.map((s) => s.categoryId)).not.toContain("salary");
    expect(out.map((s) => s.categoryId)).toContain("groceries");
  });

  it("never offers an expense category for money coming in", () => {
    const out = suggestFor({ ...base, amountCents: 250_000 });
    expect(out.map((s) => s.categoryId)).not.toContain("groceries");
    expect(out.map((s) => s.categoryId)).toContain("salary");
  });

  it("still offers the current category when it contradicts the sign", () => {
    /*
     * A sign mismatch is one of the things worth reviewing, so the queue must
     * be able to show what the row currently claims — filtering it out would
     * hide the very thing being asked about.
     */
    const out = suggestFor({
      ...base,
      amountCents: 5000,
      current: { id: "groceries", name: "Groceries" },
    });
    expect(out[0]!.categoryId).toBe("groceries");
  });

  it("does not offer the same category twice", () => {
    const out = suggestFor({
      ...base,
      current: { id: "groceries", name: "Groceries" },
      merchantHistory: [{ categoryId: "groceries", name: "Groceries", count: 4 }],
    });
    expect(out.filter((s) => s.categoryId === "groceries")).toHaveLength(1);
  });

  it("caps at the number of keys available", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      categoryId: `c${i}`,
      name: `Category ${i}`,
      kind: "expense",
      count: 40 - i,
    }));
    // Ten offers on nine number keys would make the last one unreachable.
    expect(suggestFor({ ...base, popular: many })).toHaveLength(9);
  });

  it("orders popular categories by use", () => {
    const out = suggestFor(base);
    expect(out[0]!.categoryId).toBe("groceries");
    expect(out[1]!.categoryId).toBe("restaurants");
  });

  it("copes with a row that has no merchant and no history", () => {
    const out = suggestFor({ ...base, merchant: null, merchantHistory: [] });
    expect(out.length).toBeGreaterThan(0);
  });

  it("says once rather than 1× for a single prior filing", () => {
    const out = suggestFor({
      ...base,
      merchantHistory: [{ categoryId: "groceries", name: "Groceries", count: 1 }],
    });
    expect(out[0]!.why).toBe("filed here once");
  });
});

describe("canConfirm", () => {
  it("is true for a queued row, which has a real category already", () => {
    expect(canConfirm({ categoryId: "p2p", categoryName: "Person to person" })).toBe(true);
  });

  it("is false when there is nothing to confirm", () => {
    expect(canConfirm({ categoryId: null, categoryName: null })).toBe(false);
  });
});
