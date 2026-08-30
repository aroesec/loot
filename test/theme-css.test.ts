import { describe, expect, it } from "vitest";
import { isSafeThemeValue, safeThemeValue, themeToCss } from "@/lib/theme-css";

/**
 * Theme values are rendered into a `<style>` element with
 * `dangerouslySetInnerHTML`, and were interpolated raw. `#fff</style><script>…`
 * closed the element and ran — on every page, including `/login`, which is
 * rendered before anyone has signed in. The CSP could not stop it: Next inlines
 * a bootstrap script, so `script-src` has to allow `'unsafe-inline'`.
 */
describe("theme values cannot break out of the style element", () => {
  it("drops a value that closes the tag, and keeps a real colour", () => {
    const escaped = themeToCss({ bg: `#fff</style><script>alert(1)</script>` }, { bg: "#FBFAF7" });
    expect(escaped).not.toContain("</style>");
    expect(escaped).not.toContain("<script>");
    expect(escaped).toContain("--bg: #FBFAF7;");

    expect(themeToCss({ bg: "#FBFAF7" })).toContain("--bg: #FBFAF7;");
  });

  it("drops a value that would inject an extra declaration or rule", () => {
    // `;` ends the declaration, `{}` opens a new rule — neither belongs in a value.
    expect(isSafeThemeValue("#fff; position: fixed")).toBe(false);
    expect(isSafeThemeValue("red}html{display:none")).toBe(false);
  });

  it("rejects a key that would close the rule, since keys become property names", () => {
    const css = themeToCss({ "bg; } html { display": "none" });
    expect(css).not.toContain("display");
    expect(css).toBe(':root{}\n:root[data-theme="dark"]{}');
  });
});

describe("legitimate values still render", () => {
  it("accepts every shape the real theme uses", () => {
    for (const v of ["#FBFAF7", "#33291533", "10px", "1", "var(--font-sans)"]) {
      expect(isSafeThemeValue(v), v).toBe(true);
    }
  });

  it("splits dark tokens into the dark rule", () => {
    const css = themeToCss({ bg: "#FFFFFF", "dark-bg": "#100F0C" });
    expect(css).toContain(':root{--bg: #FFFFFF;}');
    expect(css).toContain(':root[data-theme="dark"]{--bg: #100F0C;}');
  });
});

describe("safeThemeValue", () => {
  it("falls back rather than passing a tampered value through", () => {
    expect(safeThemeValue("<svg onload=alert(1)>", "#808080")).toBe("#808080");
    expect(safeThemeValue("#123456", "#808080")).toBe("#123456");
  });
});
