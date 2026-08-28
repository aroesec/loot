import { describe, expect, it } from "vitest";
import { LOGO_MAX_BYTES, validateLogo } from "@/lib/logo";

describe("validateLogo", () => {
  it("accepts an allowed mime type and rejects one that isn't", () => {
    expect(validateLogo("image/png", 1024)).toEqual({ ok: true });
    const svg = validateLogo("image/svg+xml", 1024);
    expect(svg.ok).toBe(false);
    if (!svg.ok) expect(svg.message).toMatch(/PNG|JPEG|WebP/);
  });

  it("accepts exactly the size cap and rejects one byte over", () => {
    expect(validateLogo("image/png", LOGO_MAX_BYTES)).toEqual({ ok: true });
    const tooBig = validateLogo("image/png", LOGO_MAX_BYTES + 1);
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(tooBig.message).toMatch(/1MB/);
  });
});
