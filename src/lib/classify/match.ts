/**
 * Rule matching, with no database behind it.
 *
 * Split out of `rules.ts` for the same reason `constants.ts` is: importing
 * that module pulls in `@/db` and therefore the whole env schema, which puts
 * it out of reach of unit tests and client components. Deciding which rule a
 * description matches is pure, and the tests that pin the transfer-flag and
 * pattern-collision regressions need to call it directly.
 */
import type { MerchantRule } from "@/db/schema";
import { normalizeDescription } from "./normalize";

export type RuleMatch = {
  rule: MerchantRule;
  /**
   * Null on a merchant-only rule. Who answers the category next depends on
   * `queueForReview`: the model, or the person.
   */
  categoryId: string | null;
  merchantName: string | null;
  isTransfer: boolean;
  /** Skip the model and surface this for the user to categorize. */
  queueForReview: boolean;
};

/** Learned rules sit above seeds so a correction always beats the default. */
export const LEARNED_PRIORITY = 200;
export const SEED_PRIORITY = 100;

/**
 * Sort into match order: priority desc, then longer patterns first. A longer
 * pattern is the more specific one ("uber eats" must beat "uber"), so at equal
 * priority specificity decides.
 */
export function sortRules(rules: MerchantRule[]): MerchantRule[] {
  return [...rules].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return b.pattern.length - a.pattern.length;
  });
}

function ruleMatches(rule: MerchantRule, normalized: string): boolean {
  const p = rule.pattern;
  switch (rule.matchType) {
    case "exact":
      return normalized === p;
    case "prefix":
      return normalized.startsWith(p);
    case "regex":
      try {
        return new RegExp(p, "i").test(normalized);
      } catch {
        // A malformed user-supplied pattern must not take down classification.
        return false;
      }
    case "contains":
    default:
      return normalized.includes(p);
  }
}

/**
 * A rule scoped to one direction only fires on that sign. Zero is treated as
 * neither, so a $0 adjustment can't pick up a direction-specific category.
 */
function directionMatches(
  rule: MerchantRule,
  amountCents: number | null,
): boolean {
  if (rule.appliesTo === "any") return true;
  if (amountCents === null || amountCents === 0) return false;
  return rule.appliesTo === "debit" ? amountCents < 0 : amountCents > 0;
}

/**
 * First match wins — the list must already be in `sortRules` order.
 *
 * `amountCents` scopes direction-specific rules. It is optional so callers that
 * only want a merchant guess can omit it, but a classification pass should
 * always pass it: without it, "fid bkg svc" matches neither direction and
 * falls through to the model instead of quietly picking the wrong one.
 */
export function matchRule(
  normalized: string,
  rules: MerchantRule[],
  amountCents: number | null = null,
): RuleMatch | null {
  for (const rule of rules) {
    if (!directionMatches(rule, amountCents)) continue;
    if (ruleMatches(rule, normalized)) {
      return {
        rule,
        categoryId: rule.categoryId,
        merchantName: rule.merchantName,
        isTransfer: rule.isTransfer,
        queueForReview: rule.queueForReview,
      };
    }
  }
  return null;
}

/**
 * Payment rails that lead a description without identifying the merchant. On
 * these the distinguishing part is the counterparty further along the string.
 */
const PAYMENT_RAILS = ["venmo", "zelle", "cash app", "paypal", "square cash"];

/**
 * Derive a rule pattern from a description. Uses the leading words of the
 * normalized text: specific enough not to over-match, general enough to catch
 * the same merchant with a different store number or city.
 *
 * Payment rails are the exception and get a longer window. "zelle payment to
 * jordan" truncated to two words is "zelle payment", so correcting a single
 * large transfer for contract work would have refiled every future Zelle as
 * home maintenance. Reaching the counterparty keeps the rule about that one payee.
 *
 * When the rail carries no counterparty — "venmo payment 1000000000000 web" —
 * the reference number lands in the pattern and the rule simply never fires
 * again. That is the intended failure: a rule that learns nothing costs one
 * re-correction, while one that over-matches silently rewrites real history.
 */
export function derivePattern(rawDescription: string): string {
  const normalized = normalizeDescription(rawDescription);
  if (!normalized) return "";
  const words = normalized.split(" ").filter(Boolean);

  const onRail = PAYMENT_RAILS.some((rail) => normalized.startsWith(rail));
  // Two words is usually the sweet spot ("trader joes", "blue bottle").
  // Single distinctive words ("netflix") are kept as-is.
  const want = onRail ? 4 : 2;
  const take = words.length <= want ? words.length : want;
  return words.slice(0, take).join(" ");
}
