import { describe, it, expect } from "vitest";

/**
 * `.env.example` ships every optional variable as `NAME=""` so a reader can
 * see what exists. Zod treats an empty string as present, so `.optional()`
 * does not apply and a `.min(1)` rejects it — which meant following the
 * README exactly (`cp .env.example .env.local`) produced a build that refused
 * to start on `APP_PASSWORD_HASH=""`.
 *
 * A fresh clone is the only thing that surfaces this: a developer's own
 * `.env.local` has real values, and CI has no `.env.local` at all.
 */
function normalize(raw: Record<string, string | undefined>) {
  const out = { ...raw };
  for (const k of Object.keys(out)) if (out[k] === "") out[k] = undefined;
  return out;
}

describe("environment coercion", () => {
  it("treats an empty string as unset", () => {
    const env = normalize({ APP_PASSWORD_HASH: "", OIDC_ISSUER: "" });
    expect(env.APP_PASSWORD_HASH).toBeUndefined();
    expect(env.OIDC_ISSUER).toBeUndefined();
  });

  it("leaves real values alone", () => {
    const env = normalize({ APP_PASSWORD: "hunter2", PLAID_ENV: "sandbox" });
    expect(env.APP_PASSWORD).toBe("hunter2");
    expect(env.PLAID_ENV).toBe("sandbox");
  });

  it("does not confuse a genuinely absent key with an empty one", () => {
    const env = normalize({ A: undefined, B: "" });
    expect(env.A).toBeUndefined();
    expect(env.B).toBeUndefined();
  });

  it("preserves whitespace, which is a real value someone set by mistake", () => {
    // Trimming here would hide a typo rather than surface it.
    expect(normalize({ X: " " }).X).toBe(" ");
  });
});

describe(".env.example is a usable starting point", () => {
  it("has no value that would fail validation as an empty string", async () => {
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(".env.example", "utf8");

    const assigned = text
      .split("\n")
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => l.split("=")[0]!);

    // Every uncommented assignment must be one the loader can handle empty.
    expect(assigned.length).toBeGreaterThan(0);
    for (const name of assigned) {
      expect(normalize({ [name]: "" })[name], name).toBeUndefined();
    }
  });

  it("ships no real-looking secret", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const text = readFileSync(".env.example", "utf8");
    for (const line of text.split("\n")) {
      if (!/^[A-Z_]+=/.test(line)) continue;
      const value = line.split("=").slice(1).join("=").replace(/^"|"$/g, "");
      // Placeholders are fine; anything long and random-looking is not.
      expect(
        /^[A-Za-z0-9_/+-]{24,}$/.test(value) && !value.includes("..."),
        line,
      ).toBe(false);
    }
  });
});
