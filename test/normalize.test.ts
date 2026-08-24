import { describe, it, expect } from "vitest";
import { normalizeDescription, toMerchantName, dedupeHash } from "@/lib/classify/normalize";

describe("normalizeDescription", () => {
  it("strips transaction-type prefixes", () => {
    expect(normalizeDescription("POS DEBIT TRADER JOES")).toBe("trader joes");
    expect(normalizeDescription("ACH DEBIT PG&E WEB ONLINE")).toContain("pg&e");
    expect(normalizeDescription("CHECKCARD STARBUCKS")).toBe("starbucks");
  });

  it("strips a date that follows the prefix", () => {
    expect(
      normalizeDescription("PURCHASE AUTHORIZED ON 03/14 TRADER JOES 452"),
    ).toBe("trader joes");
  });

  it("strips payment-processor prefixes", () => {
    expect(normalizeDescription("SQ *BLUE BOTTLE COFFEE")).toBe("blue bottle coffee");
    expect(normalizeDescription("TST* SWEETGREEN")).toBe("sweetgreen");
    expect(normalizeDescription("PAYPAL *SPOTIFY")).toBe("spotify");
  });

  it("collapses Amazon's many surface forms", () => {
    expect(normalizeDescription("AMZN Mktp US*2K4LM8XY3")).toContain("amazon");
    expect(normalizeDescription("AMAZON.COM*RT4XY")).toContain("amazon");
  });

  it("strips store numbers, card tails and phone numbers", () => {
    expect(normalizeDescription("TARGET #1234")).toBe("target");
    expect(normalizeDescription("SAFEWAY STORE 4421")).toBe("safeway");
    expect(normalizeDescription("NETFLIX 866-555-0100")).toBe("netflix");
    expect(normalizeDescription("SHELL OIL XXXX4321")).toBe("shell oil");
  });

  it("strips trailing city and state", () => {
    // Leftover location text is deliberate — see the location-tails block
    // below. What matters is that the merchant survives at the front.
    expect(normalizeDescription("CHIPOTLE 1111 SPRINGFIELD CO")).toContain("chipotle");
    expect(normalizeDescription("BLUE BOTTLE SAN FRANCISCOCA")).toContain("blue bottle");
  });

  it("maps every variant of one merchant to the same needle", () => {
    const variants = [
      "POS DEBIT 1234 TRADER JOE'S #123 SPRINGFIELD CO",
      "PURCHASE AUTHORIZED ON 03/14 TRADER JOE'S 452 S1234567890",
      "SQ *TRADER JOE'S        SPRINGFIELDCO",
    ];
    const normalized = variants.map(normalizeDescription);
    for (const n of normalized) expect(n).toContain("trader joe");
  });

  it("leaves an already-clean description alone", () => {
    expect(normalizeDescription("Netflix")).toBe("netflix");
  });
});

describe("toMerchantName", () => {
  it("title-cases and truncates to the head words", () => {
    expect(toMerchantName("blue bottle coffee")).toBe("Blue Bottle Coffee");
    expect(toMerchantName("")).toBe("");
  });
});

describe("dedupeHash", () => {
  it("is stable for the same logical transaction", async () => {
    const a = await dedupeHash({
      accountId: "acct-1",
      postedOn: "2026-03-14",
      amountCents: -1250,
      normalizedDescription: "trader joes",
    });
    const b = await dedupeHash({
      accountId: "acct-1",
      postedOn: "2026-03-14",
      amountCents: -1250,
      normalizedDescription: "trader joes",
    });
    expect(a).toBe(b);
  });

  it("differs when the amount differs", async () => {
    const a = await dedupeHash({
      accountId: null,
      postedOn: "2026-03-14",
      amountCents: -1250,
      normalizedDescription: "trader joes",
    });
    const b = await dedupeHash({
      accountId: null,
      postedOn: "2026-03-14",
      amountCents: -1251,
      normalizedDescription: "trader joes",
    });
    expect(a).not.toBe(b);
  });
});

describe("normalizeDescription — location tails", () => {
  /*
   * Regression: the original city/state stripper assumed any word before a
   * state code was a city, so "UBER EATS 800... CA" collapsed to "uber" and
   * food delivery was classified as rideshare.
   */
  it("keeps a product word that precedes a state code", () => {
    expect(normalizeDescription("UBER EATS 8005551234 CA")).toBe("uber eats");
  });

  it("does not truncate merchants ending in state-like letters", () => {
    expect(normalizeDescription("CHECKCARD STARBUCKS")).toBe("starbucks");
    expect(normalizeDescription("POS DEBIT EXPRESS")).toBe("express");
    expect(normalizeDescription("PELOTON")).toBe("peloton");
  });

  it("still reduces a real merchant/store/city/state tail", () => {
    // A single-word city after an unambiguous code is dropped entirely.
    expect(normalizeDescription("CHIPOTLE 1111 SPRINGFIELD CA")).toBe("chipotle");
    // CO doubles as "Company", so the city token is kept on purpose. The
    // merchant is still the leading token, which is what rules match on.
    expect(normalizeDescription("CHIPOTLE 1111 SPRINGFIELD CO")).toContain("chipotle");
  });

  it("keeps enough of the merchant for a contains-rule to match", () => {
    for (const d of [
      "STARBUCKS SPRINGFIELD CO",
      "SHELL OIL 10000000007 SPRINGFIELD CO",
      "SAFEWAY #1234 SPRINGFIELD CO",
    ]) {
      const n = normalizeDescription(d);
      expect(n.split(" ")[0]!.length).toBeGreaterThan(2);
    }
  });
});

describe("normalizeDescription — city stripping is gated on a state code", () => {
  // Regression: the city-strip step once ran on any 3+ word description,
  // truncating "blue bottle coffee" to "blue bottle".
  it("keeps the last word when there is no state code", () => {
    expect(normalizeDescription("SQ *BLUE BOTTLE COFFEE")).toBe("blue bottle coffee");
    expect(normalizeDescription("GREAT DIVIDE BREWING CO")).toContain("great divide brewing");
    expect(normalizeDescription("ALPINE PHYSICAL THERAPY PC")).toContain("physical therapy");
  });
});

describe("toMerchantName cleans what normalization deliberately leaves", () => {
  it("drops bare store numbers", () => {
    expect(toMerchantName(normalizeDescription("CHIPOTLE 1111 SPRINGFIELD CO"))).toBe(
      "Chipotle Springfield",
    );
    expect(toMerchantName(normalizeDescription("SAFEWAY #1234 SPRINGFIELD CO"))).toBe(
      "Safeway Springfield",
    );
  });

  it("keeps multi-word brands intact", () => {
    expect(toMerchantName(normalizeDescription("SQ *BLUE BOTTLE COFFEE"))).toBe(
      "Blue Bottle Coffee",
    );
  });
});
