import { describe, expect, it } from "vitest";
import { validatePerson } from "@/lib/people-validate";

describe("validatePerson", () => {
  it("requires a non-blank name", () => {
    const ok = validatePerson({ name: "  Ada Lovelace  ", type: "employee" });
    expect(ok).toMatchObject({ ok: true, name: "Ada Lovelace" });

    const blank = validatePerson({ name: "   ", type: "employee" });
    expect(blank).toEqual({ ok: false, message: "Name is required." });
  });

  it("only accepts a known type", () => {
    expect(validatePerson({ name: "Grace Hopper", type: "contractor" })).toMatchObject({
      ok: true,
      type: "contractor",
    });

    const bad = validatePerson({ name: "Grace Hopper", type: "manager" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toMatch(/employee or contractor/);
  });

  it("turns blank optional fields into null", () => {
    const result = validatePerson({ name: "Ada", type: "employee", email: "  ", note: "" });
    expect(result).toMatchObject({ ok: true, email: null, note: null });
  });
});
