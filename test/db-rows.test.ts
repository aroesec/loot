import { describe, expect, it } from "vitest";
import { rowsOf } from "@/lib/db-rows";

/**
 * postgres.js returns an array-like RowList, node-postgres returns `{ rows }`.
 * Reading the wrong one yields undefined rather than throwing, which is how it
 * silently disabled the pg_dump version check — the failure then surfaced as an
 * opaque pg_dump error instead of as the missing check it actually was.
 */
describe("rowsOf", () => {
  it("reads both driver shapes", () => {
    expect(rowsOf([{ n: 1 }])).toEqual([{ n: 1 }]);
    expect(rowsOf({ rows: [{ n: 1 }] })).toEqual([{ n: 1 }]);
  });

  it("returns an empty array rather than undefined for an empty result", () => {
    // The caller does `.length` and `.map` on this; undefined would throw at a
    // distance from the cause.
    expect(rowsOf({ rows: [] })).toEqual([]);
    expect(rowsOf(null)).toEqual([]);
  });
});
