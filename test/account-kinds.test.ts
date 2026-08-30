import { describe, expect, it } from "vitest";
import { ACCOUNT_KINDS, isAccountKind, normalizeLast4 } from "@/lib/account-kinds";

describe("isAccountKind", () => {
  it("accepts every kind the picker offers", () => {
    // The picker is rendered from this list, so a value it can produce must
    // survive the action that receives it.
    for (const k of ACCOUNT_KINDS) expect(isAccountKind(k.value), k.value).toBe(true);
  });

  it("rejects a value that is not a kind", () => {
    expect(isAccountKind("brokerage")).toBe(false);
    expect(isAccountKind("")).toBe(false);
  });
});

describe("normalizeLast4", () => {
  it("keeps exactly four digits and drops anything else", () => {
    expect(normalizeLast4(" 4321 ")).toBe("4321");
    expect(normalizeLast4("432")).toBeNull();
  });

  it("treats blank and non-numeric as absent rather than storing them", () => {
    expect(normalizeLast4("")).toBeNull();
    expect(normalizeLast4("12a4")).toBeNull();
  });
});
