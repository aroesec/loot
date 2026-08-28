/**
 * Validation for a roster entry (employee or contractor).
 *
 * DB-free, like `tax-math.ts` and `dates.ts`. This roster is a contact list
 * the business owner keeps for their own reference — no login, no payroll,
 * no link to any transaction — so validation stays equally light: a name and
 * a known type, everything else optional and unvalidated in format.
 */

export const PERSON_TYPES = ["employee", "contractor"] as const;
export type PersonType = (typeof PERSON_TYPES)[number];

export type PersonInput = {
  name: string;
  type: string;
  email?: string | null;
  note?: string | null;
};

export type PersonValidation =
  | { ok: true; name: string; type: PersonType; email: string | null; note: string | null }
  | { ok: false; message: string };

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function validatePerson(input: PersonInput): PersonValidation {
  const name = input.name.trim();
  if (!name) {
    return { ok: false, message: "Name is required." };
  }
  if (!PERSON_TYPES.includes(input.type as PersonType)) {
    return { ok: false, message: "Type must be employee or contractor." };
  }
  return {
    ok: true,
    name,
    type: input.type as PersonType,
    email: blankToNull(input.email),
    note: blankToNull(input.note),
  };
}
