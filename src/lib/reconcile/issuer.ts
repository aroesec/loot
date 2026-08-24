/**
 * Naming the issuer behind a card payment, with no database behind it.
 *
 * The fourth module split out for this reason. Anything worth unit-testing does
 * not belong in a file that imports `@/db`, because that pulls in the whole env
 * schema and puts the module out of a test's reach.
 */

/**
 * A human-usable issuer name from a payment description.
 *
 * Deliberately crude: the goal is a stable grouping key and something a person
 * recognizes, not a canonical merchant. "Payment to Chase card ending in 4242"
 * and "APPLECARD GSBANK PAYMENT 10000001" both need to become something you
 * can read in a warning.
 */
export function issuerFromDescription(description: string): string {
  const d = description.toLowerCase();

  const last4 = d.match(/(?:ending in|card)\s*#?\s*(\d{4})/)?.[1];
  const known = [
    ["applecard", "Apple Card"],
    ["apple card", "Apple Card"],
    ["capital one", "Capital One"],
    ["chase", "Chase"],
    ["amex", "American Express"],
    ["american express", "American Express"],
    ["discover", "Discover"],
    ["citi", "Citi"],
    ["barclay", "Barclays"],
    ["synchrony", "Synchrony"],
    ["wells fargo", "Wells Fargo"],
    ["bank of america", "Bank of America"],
  ] as const;

  for (const [needle, name] of known) {
    if (d.includes(needle)) return last4 ? `${name} ••${last4}` : name;
  }
  if (last4) return `Card ••${last4}`;

  // Fall back to the leading words, which is usually the institution.
  return description.trim().split(/\s+/).slice(0, 2).join(" ");
}
