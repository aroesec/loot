import { describe, expect, it } from "vitest";
import { suggestSplit, type PriorPart } from "@/lib/split-suggest";

const sum = (parts: { amountCents: number }[]) =>
  parts.reduce((a, p) => a + p.amountCents, 0);

const prior: PriorPart[] = [
  { categoryId: "groceries", amountCents: 7000 },
  { categoryId: "household", amountCents: 3000 },
];

describe("suggestSplit", () => {
  it("applies last time's ratio to a new amount", () => {
    const parts = suggestSplit(20000, prior)!;
    expect(parts).toEqual([
      { categoryId: "groceries", amountCents: 14000 },
      { categoryId: "household", amountCents: 6000 },
    ]);
  });

  /**
   * The invariant the whole feature has to respect: a split's parts sum exactly
   * to what they replaced. Rounding each share on its own loses or invents a
   * cent, and nothing downstream re-checks it — `db:audit-splits` finds it
   * afterwards, which is not the same as not doing it.
   */
  it("sums exactly, including when the ratio does not divide cleanly", () => {
    // 1/3 of 10.00 three ways is 3.33 three times, which is a cent short.
    const thirds: PriorPart[] = [
      { categoryId: "a", amountCents: 1 },
      { categoryId: "b", amountCents: 1 },
      { categoryId: "c", amountCents: 1 },
    ];
    expect(sum(suggestSplit(1000, thirds)!)).toBe(1000);
    expect(sum(suggestSplit(9999, prior)!)).toBe(9999);
    expect(sum(suggestSplit(1, prior)!)).toBe(1);
  });

  it("gives the odd penny to the largest fraction rather than always the first", () => {
    const parts = suggestSplit(1000, [
      { categoryId: "small", amountCents: 1 },
      { categoryId: "large", amountCents: 2 },
    ])!;
    // 333.33 and 666.67 → the extra cent belongs to the larger share.
    expect(parts).toEqual([
      { categoryId: "small", amountCents: 333 },
      { categoryId: "large", amountCents: 667 },
    ]);
    expect(sum(parts)).toBe(1000);
  });

  it("copies the sign convention away, working on magnitudes", () => {
    // Splits are stored as negative outflows; the ratio is about size.
    const outflow: PriorPart[] = [
      { categoryId: "groceries", amountCents: -7000 },
      { categoryId: "household", amountCents: -3000 },
    ];
    expect(suggestSplit(20000, outflow)![0]!.amountCents).toBe(14000);
  });

  it("declines when there is nothing usable to copy", () => {
    expect(suggestSplit(1000, [])).toBeNull();
    expect(suggestSplit(1000, [{ categoryId: "solo", amountCents: 500 }])).toBeNull();
    expect(suggestSplit(0, prior)).toBeNull();
    expect(
      suggestSplit(1000, [
        { categoryId: "a", amountCents: 0 },
        { categoryId: "b", amountCents: 0 },
      ]),
    ).toBeNull();
  });
});
