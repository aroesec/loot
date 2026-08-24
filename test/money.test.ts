import { describe, it, expect } from "vitest";
import { parseAmountToCents, formatCents, medianCents, pctChange } from "@/lib/money";

describe("parseAmountToCents", () => {
  it("parses plain and formatted amounts", () => {
    expect(parseAmountToCents("45.20")).toBe(4520);
    expect(parseAmountToCents("$1,234.56")).toBe(123456);
    expect(parseAmountToCents("1234")).toBe(123400);
  });

  it("treats accounting parentheses as negative", () => {
    expect(parseAmountToCents("(45.00)")).toBe(-4500);
  });

  it("handles leading and trailing minus signs", () => {
    expect(parseAmountToCents("-12.30")).toBe(-1230);
    expect(parseAmountToCents("12.30-")).toBe(-1230);
  });

  it("honors CR and DR suffixes", () => {
    expect(parseAmountToCents("45.00 CR")).toBe(4500);
    expect(parseAmountToCents("45.00 DR")).toBe(-4500);
  });

  it("handles European decimal separators", () => {
    expect(parseAmountToCents("1.234,56")).toBe(123456);
  });

  it("returns null for junk", () => {
    expect(parseAmountToCents("")).toBeNull();
    expect(parseAmountToCents("n/a")).toBeNull();
  });
});

describe("formatCents", () => {
  it("formats with sign conventions", () => {
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(formatCents(-4500)).toBe("-$45.00");
    expect(formatCents(4500, { signed: true })).toBe("+$45.00");
  });
});

describe("medianCents", () => {
  it("resists a single outlier", () => {
    expect(medianCents([999, 1000, 1001, 1002, 50000])).toBe(1001);
  });
  it("averages the middle pair for even counts", () => {
    expect(medianCents([100, 200])).toBe(150);
  });
});

describe("pctChange", () => {
  it("returns null when the base is zero", () => {
    expect(pctChange(0, 100)).toBeNull();
  });
  it("computes a percentage increase", () => {
    expect(pctChange(1000, 1200)).toBeCloseTo(20);
  });
});
