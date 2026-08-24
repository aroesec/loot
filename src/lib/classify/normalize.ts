/**
 * Bank descriptions are noisy in predictable ways. Stripping that noise before
 * matching is what lets a single rule ("trader joes") cover every variation a
 * dozen banks produce:
 *
 *   "POS DEBIT 1234 TRADER JOE'S #123 SPRINGFIELD CO"
 *   "PURCHASE AUTHORIZED ON 03/14 TRADER JOES 452 S1234567890"
 *   "SQ *TRADER JOES        SPRINGFIELDCO"
 *
 * all normalize to "trader joes".
 */

/** Transaction-type prefixes banks prepend. Order matters: longest first. */
const LEADING_NOISE = [
  "purchase authorized on",
  "recurring payment authorized on",
  "pos purchase authorized on",
  "debit card purchase",
  "credit card purchase",
  "point of sale withdrawal",
  "preauthorized debit",
  "preauthorized credit",
  "electronic withdrawal",
  "electronic deposit",
  "external withdrawal",
  "external deposit",
  "online transfer to",
  "online transfer from",
  "mobile purchase",
  "recurring debit card",
  "withdrawal made in a branch",
  "ach withdrawal",
  "ach deposit",
  "ach debit",
  "ach credit",
  "pos debit",
  "pos credit",
  "card purchase",
  "checkcard",
  "check card",
  "debit purchase",
  "visa purchase",
  "web pmt",
  "web payment",
  "bill payment",
  "direct debit",
  "direct dep",
  "pos withdrawal",
  "withdrawal",
  "deposit",
  "purchase",
  "payment to",
  "payment from",
  "transfer to",
  "transfer from",
];

/**
 * Payment aggregators that prefix the real merchant name. The merchant is what
 * we want, not the processor, so these are stripped along with their separator.
 */
const PROCESSOR_PREFIXES = [
  "sq *",
  "sq*",
  "tst*",
  "tst *",
  "py *",
  "py*",
  "sp *",
  "sp*",
  "in *",
  "in*",
  "paypal *",
  "paypal*",
  "pp*",
  "pp *",
  "wl *",
  "wl*",
  "gumroad*",
  "shopify*",
  "stripe*",
  "toast*",
  "clover*",
  "ezc*",
  "chk*",
];

/** Trailing metadata: store numbers, refs, phone numbers, city + state. */
const US_STATES =
  "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";

export function normalizeDescription(raw: string): string {
  let s = raw.toLowerCase().trim();

  // Normalize separators and unicode punctuation early.
  s = s.replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"');
  s = s.replace(/\s+/g, " ");

  // Strip leading transaction-type noise, repeatedly — banks stack them.
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of LEADING_NOISE) {
      if (s.startsWith(prefix + " ") || s === prefix) {
        s = s.slice(prefix.length).trim();
        changed = true;
        break;
      }
    }
    // A date immediately after the prefix ("purchase authorized on 03/14 ...").
    const dateStripped = s.replace(/^\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\s+/, "");
    if (dateStripped !== s) {
      s = dateStripped;
      changed = true;
    }
  }

  // Strip payment-processor prefixes (also repeatedly: "sq *tst*cafe").
  changed = true;
  while (changed) {
    changed = false;
    for (const prefix of PROCESSOR_PREFIXES) {
      if (s.startsWith(prefix)) {
        s = s.slice(prefix.length).trim();
        changed = true;
        break;
      }
    }
  }

  // Amazon's many surface forms all mean the same merchant.
  s = s.replace(
    /\bamzn\s*mktp\b|\bamazon\s*mktpl?\b|\bamzn\.com\/bill\b|\bamazon\.com\b/g,
    "amazon",
  );

  // Trailing reference/auth ids: long digit or alnum runs.
  s = s.replace(/\b(?:ref|auth|conf|trace|id|inv)#?\s*[:#]?\s*[a-z0-9-]{4,}\b/g, " ");
  s = s.replace(/\b[a-z0-9]*\d[a-z0-9]*\b(?=\s*$)/g, (m) =>
    m.length >= 6 ? " " : m,
  );

  // Store numbers: "#452", "store 1234", "- 00123".
  s = s.replace(/#\s*\d+/g, " ");
  s = s.replace(/\bstore\s*\d+\b/g, " ");

  // Phone numbers.
  s = s.replace(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, " ");
  s = s.replace(/\b8\d{2}-\d{3}-\d{4}\b/g, " ");

  // Dates anywhere.
  s = s.replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, " ");
  s = s.replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ");

  // Card tails: "xxxx1234", "card 1234", "****5678".
  s = s.replace(/\b(?:x{2,}|\*{2,})\d{2,4}\b/g, " ");
  s = s.replace(/\bcard\s*\d{4}\b/g, " ");

  /*
   * Location tails ("... SPRINGFIELD CO") are stripped in two conservative steps,
   * because over-stripping is far more damaging than leaving a city in place.
   * Rules match on `contains`, so a leftover trailing word costs nothing — but
   * eating a real word silently breaks every rule that depended on it. The
   * original single-pass version turned "UBER EATS 800... CA" into "uber",
   * which quietly filed food delivery as rideshare.
   */

  // Step 1: a bare trailing two-letter state code. Safe on its own, since by
  // this point a standalone trailing 2-letter token is not part of a name.
  const stateMatch = s.match(new RegExp(`\\s+(${US_STATES})\\s*$`, "i"));
  if (stateMatch) {
    s = s.slice(0, s.length - stateMatch[0].length).trim();
  }

  /*
   * Step 2: the city word that preceded it.
   *
   * Skipped when the code is one that doubles as a business suffix — CO is
   * Colorado but also "Great Divide Brewing Co", IN is Indiana but also
   * "Incorporated". Treating those as locations would delete a real word of
   * the merchant name. The cost of skipping is only a leftover city token,
   * which contains-matching rules ignore.
   */
  const AMBIGUOUS = new Set(["co", "in", "or", "de", "la", "pa", "md", "me", "ok", "hi", "id", "oh"]);
  if (stateMatch && !AMBIGUOUS.has(stateMatch[1]!.toLowerCase())) {
    const tokens = s.split(" ").filter(Boolean);
    // Two tokens must survive, so "uber eats" keeps "eats".
    if (tokens.length >= 3) s = tokens.slice(0, -1).join(" ");
  }

  /*
   * Card feeds also glue the city to the state ("SAN FRANCISCOCA"). This is
   * genuinely ambiguous — STARBUCKS ends in KS, EXPRESS in SS, PELOTON in ON —
   * so it only fires with corroborating evidence: two other words before it,
   * and a city part long enough not to be the tail of a brand name.
   */
  const glued = new RegExp(
    `^(.*\\S\\s+\\S+)\\s+([a-z]{5,})(?:${US_STATES})\\s*$`,
    "i",
  );
  s = s.replace(glued, "$1");

  // Bare trailing store numbers ("CHIPOTLE 1111"). Applied after the city has
  // gone, so "MERCHANT 2244 SPRINGFIELD CO" reduces all the way down.
  s = s.replace(/\s+\d{2,6}\s*$/g, "");

  // Currency/country tails and generic filler.
  s = s.replace(/\b(?:usd|usa|inc|llc|ltd|corp)\b\.?\s*$/g, " ");

  // Collapse leftover punctuation and whitespace.
  s = s.replace(/[*_|]+/g, " ");
  s = s.replace(/\s{2,}/g, " ").trim();
  s = s.replace(/^[-.,;:\s]+|[-.,;:\s]+$/g, "");

  return s;
}

/**
 * Human-facing merchant name derived from the normalized description.
 *
 * Normalization deliberately leaves some location text in place rather than
 * risk eating a real word (see the location-tail note above), so the display
 * name does the last bit of tidying: bare store numbers are dropped and only
 * the leading words are kept.
 */
export function toMerchantName(normalized: string): string {
  if (!normalized) return "";
  const words = normalized
    .split(" ")
    .filter(Boolean)
    // Bare numeric tokens are store or lane numbers, never part of a name.
    .filter((w) => !/^\d+$/.test(w));
  // Keep it short — the tail is usually location or product detail.
  const head = words.slice(0, 3);
  return head
    .map((w) => {
      if (w.length <= 2 && /^[a-z]+$/.test(w)) return w.toUpperCase();
      if (/^[a-z]/.test(w)) return w[0]!.toUpperCase() + w.slice(1);
      return w;
    })
    .join(" ");
}

/**
 * Stable identity for a transaction. Two uploads describing the same real
 * charge produce the same hash, which is what makes overlapping statement
 * uploads idempotent.
 */
export async function dedupeHash(input: {
  accountId: string | null;
  postedOn: string;
  amountCents: number;
  normalizedDescription: string;
}): Promise<string> {
  const key = [
    input.accountId ?? "no-account",
    input.postedOn,
    String(input.amountCents),
    input.normalizedDescription,
  ].join("|");

  const bytes = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
