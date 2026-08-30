/**
 * Turning stored theme tokens into CSS, safely.
 *
 * DB-free, which is the point: this is pure string work and it was previously
 * stranded in `theme.ts` behind an `@/db` import, so the one function in the
 * codebase that writes attacker-influenceable text into HTML had no test.
 *
 * **The bug this exists to stop.** Token values are rendered into a `<style>`
 * element with `dangerouslySetInnerHTML` in the root layout, and were
 * interpolated raw. A value of
 *
 *     #fff</style><script>…</script>
 *
 * closed the element and ran. It executed because the CSP allows
 * `script-src 'unsafe-inline'` — Next inlines a bootstrap script, so the policy
 * cannot forbid it — and it rendered on **every** page including `/login`,
 * which is rendered before anyone has authenticated. Writing the value needs a
 * session, so this is not a way in; it is a way to persist, and to run script
 * on the page where the password gets typed.
 *
 * Values are therefore checked against what a token can legitimately be. The
 * real ones are hex colours, `10px`, `1`, and `var(--font-sans)`; nothing needs
 * `<`, `>`, `;`, `{`, `}`, a quote, or a comment. Anything else is not
 * sanitised into something similar — it is dropped for the default, because a
 * token that has been tampered with has no correct rendering.
 */

/**
 * Letters, digits, `#`, `%`, `.`, `,`, `()`, `-`, `_`, `/`, space.
 *
 * Deliberately an allowlist. A blocklist of dangerous characters is a bet that
 * the list is complete, and it only has to be wrong once.
 */
const SAFE_VALUE = /^[A-Za-z0-9#%.,()\-_/ ]{1,64}$/;

export function isSafeThemeValue(value: string): boolean {
  return SAFE_VALUE.test(value);
}

/** The value if it is safe, otherwise the fallback. */
export function safeThemeValue(value: string | undefined, fallback: string): string {
  return value !== undefined && isSafeThemeValue(value) ? value : fallback;
}

/**
 * Inline CSS for the stored tokens.
 *
 * Sanitises at render rather than only on save, so a value already sitting in
 * the database — written before this check existed, or by anything that did not
 * go through the form — cannot reach the page either.
 */
export function themeToCss(
  tokens: Record<string, string>,
  defaults: Record<string, string> = {},
): string {
  const light: string[] = [];
  const dark: string[] = [];

  for (const [key, value] of Object.entries(tokens)) {
    // A key becomes a custom property name, so it is checked too: `--a: b; }`
    // as a key would close the rule just as effectively as a value would.
    if (!/^[A-Za-z0-9-]{1,64}$/.test(key)) continue;

    const isDark = key.startsWith("dark-");
    const name = isDark ? key.slice(5) : key;
    const safe = safeThemeValue(value, defaults[key] ?? "");
    if (!safe) continue;

    (isDark ? dark : light).push(`--${name}: ${safe};`);
  }

  return `:root{${light.join("")}}\n:root[data-theme="dark"]{${dark.join("")}}`;
}
