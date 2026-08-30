/**
 * The kinds of account, and their labels.
 *
 * DB-free so the forms and the actions read the same list. The schema owns the
 * enum; this owns the order they are offered in and what they are called on
 * screen, which is not something a Postgres enum can carry.
 *
 * Before this existed the picker hard-coded six `<option>` tags and the action
 * cast whatever arrived straight into the column type, so a value the select
 * never offered would have been written unchecked.
 */

export const ACCOUNT_KINDS = [
  { value: "checking", label: "Checking" },
  { value: "savings", label: "Savings" },
  { value: "credit_card", label: "Credit card" },
  { value: "investment", label: "Investment" },
  { value: "loan", label: "Loan" },
  { value: "cash", label: "Cash" },
] as const;

export type AccountKind = (typeof ACCOUNT_KINDS)[number]["value"];

export function isAccountKind(value: string): value is AccountKind {
  return ACCOUNT_KINDS.some((k) => k.value === value);
}

/** Last four digits, or null. Anything that is not exactly four digits is not a last-four. */
export function normalizeLast4(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return /^\d{4}$/.test(trimmed) ? trimmed : null;
}
