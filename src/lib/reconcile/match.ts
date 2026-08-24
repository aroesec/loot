import { normalizeDescription } from "@/lib/classify/normalize";

/**
 * Matching a manually-logged purchase to the statement row that later
 * represents the same charge.
 *
 * The exact `dedupe_hash` handles re-uploading a statement, because that
 * produces byte-identical rows. It cannot handle "I just bought coffee"
 * against `SQ *BLUE BOTTLE COFFEE SPRINGFIELD CO` three days later: the date moves
 * with posting lag, the description is nothing alike, and the amount may have
 * grown by a tip. So this is a scored fuzzy match.
 *
 * Both failure modes cost real money in opposite directions. A miss
 * double-counts the purchase; a wrong merge hides one. The scoring is tuned so
 * that amount alone is never enough — two $6 coffees on the same day must not
 * collapse into one — while a genuine tipped restaurant charge still lands.
 */

export type MatchCandidate = {
  id: string;
  postedOn: string;
  amountCents: number;
  /** The description as recorded, raw. Normalized internally. */
  rawDescription: string;
  merchant?: string | null;
  /**
   * Category slug, when known. Carries real weight when the merchant text
   * cannot be compared — "gas" and `SHELL OIL 5744` share no words, but both
   * landing in gas-fuel is strong evidence they are the same charge.
   */
  categorySlug?: string | null;
};

export type MatchTarget = {
  postedOn: string;
  amountCents: number;
  rawDescription: string;
  merchant?: string | null;
  categorySlug?: string | null;
};

export type MatchResult = {
  candidate: MatchCandidate;
  score: number;
  amountKind: "exact" | "tip_adjusted";
  /** Positive when the statement charged more than was logged (a tip). */
  amountDeltaCents: number;
  dayGap: number;
  merchantMatch: MerchantMatch;
  categoryMatch: CategoryMatch;
  /**
   * What supported the match beyond amount and date. `amount_and_date_only` is
   * a real match, but it is the tier worth confirming before *refusing* to add
   * something — see logPurchase.
   */
  evidence: "strong" | "moderate" | "amount_and_date_only";
  /** Shown to the user in the review queue. */
  explanation: string;
};

/**
 * Note the distinction between `unknown` and `conflict`. One side simply not
 * naming a merchant ("gas") is an absence of evidence; two sides naming
 * *different* merchants is evidence against. Collapsing those into a single
 * "no match" made it impossible to let anything else rescue the first case
 * without also rescuing the second.
 */
export type MerchantMatch = "strong" | "partial" | "unknown" | "conflict";

export type CategoryMatch = "same" | "different" | "unknown";

// --- Tuning -----------------------------------------------------------------

/** A statement charge may exceed the logged amount by this much and still be
 *  the same purchase — the gap a tip leaves behind. */
export const TIP_MAX_FRACTION = 0.3;
/** ...but never by more than this, so a large charge can't absorb a small one. */
export const TIP_MAX_CENTS = 2500;
/** Posting lag window, in days, in either direction. */
export const MAX_DAY_GAP = 7;
/**
 * Retained for ranking comparisons and tests. It no longer gates whether a
 * match happens — that is decided by the explicit rules in scoreMatch.
 */
export const MATCH_THRESHOLD = 75;

const SCORE = {
  amountExact: 50,
  amountTip: 35,
  sameDay: 20,
  within3Days: 16,
  within7Days: 10,
  merchantStrong: 30,
  merchantPartial: 18,
  // A mild penalty: no merchant information is not evidence either way, but it
  // must not be free, or amount and date alone would clear the bar.
  merchantUnknown: -5,
  // Named, and different. Effectively disqualifying on its own — two distinct
  // merchants charging the same amount the same day are two purchases.
  merchantConflict: -40,
  // Agreement on category substitutes for merchant text that cannot be
  // compared. It cannot rescue a conflict, which is the point.
  categorySame: 25,
  categoryDifferent: -20,
} as const;

// --- Merchant similarity ----------------------------------------------------

/** Words that carry no identifying signal on their own. */
const STOPWORDS = new Set([
  "the", "and", "inc", "llc", "ltd", "corp", "com", "www", "pos",
  "purchase", "payment", "debit", "credit", "card", "usa", "usd",
]);

/**
 * Words that are real but far too common to identify a merchant by themselves.
 * "coffee" shared between "coffee" and "Blue Bottle Coffee" is weak evidence;
 * "barolo" shared between "Barolo" and "Barolo Ristorante" is strong.
 */
const GENERIC = new Set([
  "coffee", "cafe", "caffe", "market", "restaurant", "resto", "bar", "grill",
  "shop", "store", "gas", "fuel", "food", "kitchen", "pizza", "deli", "bakery",
  "tavern", "pub", "diner", "bistro", "juice", "tea", "wine", "beer", "liquor",
  "pharmacy", "hotel", "motel", "supply", "service", "services", "center",
  "centre", "group", "company", "brands", "online", "mobile",
  // People often name what they bought rather than where: "lunch", "gas",
  // "parking". These identify a category, never a merchant.
  "lunch", "dinner", "breakfast", "brunch", "snack", "drinks", "meal",
  "groceries", "grocery", "parking", "ticket", "tickets", "subscription",
  "bill", "bills", "supplies", "stuff", "things", "misc", "haircut", "refill",
]);

function tokenize(text: string): string[] {
  return normalizeDescription(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

export function merchantSimilarity(a: string, b: string): MerchantMatch {
  const at = tokenize(a);
  const bt = tokenize(b);

  const aSet = new Set(at);
  const bSet = new Set(bt);

  // A side with no distinctive words has not named a merchant at all: "gas",
  // "lunch", "coffee". That is unknown, not a conflict.
  const aDistinctive = [...aSet].filter((t) => !GENERIC.has(t));
  const bDistinctive = [...bSet].filter((t) => !GENERIC.has(t));
  if (aDistinctive.length === 0 || bDistinctive.length === 0) {
    // Generic words still agreeing ("coffee" both sides) is weak support.
    const sharedGeneric = [...aSet].filter((t) => bSet.has(t));
    return sharedGeneric.length > 0 ? "partial" : "unknown";
  }

  const shared = [...aSet].filter((t) => bSet.has(t));
  // Both sides named something, and they have nothing in common.
  if (shared.length === 0) return "conflict";

  const distinctive = shared.filter((t) => !GENERIC.has(t));

  // Two distinctive words in common is unambiguous.
  if (distinctive.length >= 2) return "strong";

  if (distinctive.length === 1) {
    const word = distinctive[0]!;
    // One distinctive word is strong when it genuinely identifies the
    // merchant: either it's long enough to be a name, or one description is
    // wholly contained in the other ("barolo" inside "barolo ristorante").
    const contained =
      [...aSet].every((t) => bSet.has(t)) || [...bSet].every((t) => aSet.has(t));
    if (word.length >= 5 || contained) return "strong";
    return "partial";
  }

  // Only generic words in common.
  return "partial";
}

export function categorySimilarity(
  a: string | null | undefined,
  b: string | null | undefined,
): CategoryMatch {
  if (!a || !b) return "unknown";
  // Uncategorized is a placeholder, not an agreement.
  if (a === "uncategorized" || b === "uncategorized") return "unknown";
  return a === b ? "same" : "different";
}

// --- Scoring ----------------------------------------------------------------

export function daysBetween(a: string, b: string): number {
  return Math.round(Math.abs(Date.parse(b) - Date.parse(a)) / 86_400_000);
}

function describe(r: Omit<MatchResult, "explanation">): string {
  const parts: string[] = [];

  parts.push(
    r.dayGap === 0
      ? "the same day"
      : `${r.dayGap} day${r.dayGap === 1 ? "" : "s"} apart`,
  );

  if (r.amountKind === "tip_adjusted") {
    const dollars = (r.amountDeltaCents / 100).toFixed(2);
    parts.push(`the statement is $${dollars} higher, consistent with a tip`);
  } else {
    parts.push("the same amount");
  }

  if (r.merchantMatch === "strong") parts.push("the merchant clearly matches");
  else if (r.merchantMatch === "partial") parts.push("the merchant partly matches");
  else if (r.merchantMatch === "unknown" && r.categoryMatch === "same") {
    parts.push("you did not name a merchant but both are the same category");
  } else if (r.merchantMatch === "unknown") {
    // Say plainly that nothing beyond the amount and the date lined up. This
    // is the tier most worth a glance in the review queue.
    parts.push("nothing else identified it either way");
  }

  return parts.join(", ");
}

/**
 * Decides whether a candidate is the same charge as the target.
 *
 * The rule is "amount and date agree, unless something contradicts it" —
 * *not* "amount and date agree AND something corroborates it". That choice
 * follows from what the two mistakes actually cost, which is not symmetric:
 *
 *   A miss double-counts the purchase. Real money, wrong totals.
 *
 *   A wrong merge costs a label. The pending entry attaches to the wrong
 *   statement row, but it can only be consumed once, so the purchase it should
 *   have matched still inserts normally and the total stays correct. See the
 *   "false merge keeps the total correct" test.
 *
 * The candidate pool is also small and highly relevant: only purchases this
 * person logged themselves within the last few days. Two charges agreeing on
 * amount *and* date inside that pool are very likely the same charge.
 *
 * So positive evidence is required only where the amount itself is inexact.
 */
export function scoreMatch(
  target: MatchTarget,
  candidate: MatchCandidate,
): MatchResult | null {
  // Direction must agree. A refund never reconciles against a purchase.
  if (Math.sign(target.amountCents) !== Math.sign(candidate.amountCents)) {
    return null;
  }

  const dayGap = daysBetween(target.postedOn, candidate.postedOn);
  if (dayGap > MAX_DAY_GAP) return null;

  const targetMag = Math.abs(target.amountCents);
  const candidateMag = Math.abs(candidate.amountCents);

  let amountScore: number;
  let amountKind: MatchResult["amountKind"];
  let amountDeltaCents = 0;

  if (targetMag === candidateMag) {
    amountScore = SCORE.amountExact;
    amountKind = "exact";
  } else {
    // Only the statement charging *more* is explainable as a tip. A statement
    // charging less than was logged is a different purchase.
    const delta = targetMag - candidateMag;
    const withinFraction = delta > 0 && delta <= candidateMag * TIP_MAX_FRACTION;
    const withinCap = delta > 0 && delta <= TIP_MAX_CENTS;
    if (!withinFraction || !withinCap) return null;
    amountScore = SCORE.amountTip;
    amountKind = "tip_adjusted";
    amountDeltaCents = delta;
  }

  const merchantMatch = merchantSimilarity(
    target.merchant || target.rawDescription,
    candidate.merchant || candidate.rawDescription,
  );
  const categoryMatch = categorySimilarity(
    target.categorySlug,
    candidate.categorySlug,
  );

  /*
   * Category disagreement is the one decisive contradiction.
   *
   * It is trustworthy because both sides are categorized by the same
   * classifier, so a disagreement means the classifier saw two genuinely
   * different kinds of purchase. Merchant disagreement is *not* trustworthy in
   * the same way: the logged side is prose, and someone naming what they
   * bought rather than where ("new headphones" against `BEST BUY`) reads as a
   * conflicting merchant when it is nothing of the sort. Treating that as
   * decisive caused misses, and a miss double-counts real money where a wrong
   * merge only mislabels a row.
   */
  if (categoryMatch === "different") return null;

  /*
   * A tip-adjusted amount is a weaker starting point — the amounts genuinely
   * differ, so the tip reading is an inference rather than an observation.
   * Here the extra caution is worth it: require positive support, and let a
   * merchant conflict block.
   */
  if (amountKind === "tip_adjusted") {
    if (merchantMatch === "conflict") return null;
    const supported =
      merchantMatch === "strong" ||
      merchantMatch === "partial" ||
      categoryMatch === "same";
    if (!supported) return null;
  }

  // Everything below is ranking only: which candidate is the best match when
  // several qualify. It no longer gates whether a match happens at all.
  const dateScore =
    dayGap === 0
      ? SCORE.sameDay
      : dayGap <= 3
        ? SCORE.within3Days
        : SCORE.within7Days;

  const merchantScore =
    merchantMatch === "strong"
      ? SCORE.merchantStrong
      : merchantMatch === "partial"
        ? SCORE.merchantPartial
        : merchantMatch === "conflict"
          // Ranking only now: a differently-named merchant still makes this a
          // worse candidate than one that agrees, it just no longer blocks.
          ? SCORE.merchantConflict
          : SCORE.merchantUnknown;

  const categoryScore = categoryMatch === "same" ? SCORE.categorySame : 0;

  const partial = {
    candidate,
    score: amountScore + dateScore + merchantScore + categoryScore,
    amountKind,
    amountDeltaCents,
    dayGap,
    merchantMatch,
    categoryMatch,
    // How much there is to go on beyond the amount and the date. Callers use
    // this to decide whether to merge silently or ask.
    evidence:
      merchantMatch === "strong"
        ? ("strong" as const)
        : merchantMatch === "partial" || categoryMatch === "same"
          ? ("moderate" as const)
          : ("amount_and_date_only" as const),
  };
  return { ...partial, explanation: describe(partial) };
}

/**
 * Best match among candidates, or null. Ties break toward the closer date,
 * then the smaller amount difference — the more likely of two equals.
 */
export function bestMatch(
  target: MatchTarget,
  candidates: MatchCandidate[],
): MatchResult | null {
  const scored = candidates
    .map((c) => scoreMatch(target, c))
    .filter((r): r is MatchResult => r !== null);

  if (scored.length === 0) return null;

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.dayGap !== b.dayGap) return a.dayGap - b.dayGap;
    return a.amountDeltaCents - b.amountDeltaCents;
  });

  return scored[0]!;
}
