/**
 * Read result rows regardless of driver shape.
 *
 * postgres.js returns an array-like RowList while node-postgres returns
 * `{ rows }`. Reading the wrong one yields `undefined` rather than throwing,
 * which is the trap AGENTS.md names: it silently disabled the pg_dump version
 * check, and the failure surfaced later as an opaque pg_dump error rather than
 * as the missing check it was.
 *
 * Lifted out of `db/backup.ts`, where it was private and untested. Writing the
 * test found that the trailing `?? []` never fired: `.rows` was read off the
 * result first, so a null result threw on the line meant to tolerate one.
 */
export function rowsOf<T>(result: unknown): T[] {
  // Nullish first. The original spelled its intent with a trailing `?? []` but
  // read `.rows` before it, so a null result threw on the line meant to
  // tolerate one — callers then do `.length` and `.map` on the way back.
  if (result === null || result === undefined) return [];
  const maybe = (result as { rows?: unknown }).rows;
  return (Array.isArray(maybe) ? maybe : (result as T[])) ?? [];
}
