import { describe, expect, it } from "vitest";
import { countCopyRows } from "@/db/dump-text";

/**
 * The row count is what stands between a good backup and a dump of a wiped
 * database quietly replacing it, so the parsing has to match what pg_dump
 * actually emits — including the cases that look like data and are not.
 */
describe("countCopyRows", () => {
  const dump = (body: string) =>
    `SET statement_timeout = 0;\n` +
    `COPY public.transactions (id, amount_cents, description) FROM stdin;\n` +
    body +
    `\\.\n\n\nCOPY public.categories (id, slug) FROM stdin;\n1\tgroceries\n\\.\n`;

  it("counts data rows", () => {
    expect(countCopyRows(dump("1\t-500\tcoffee\n2\t-100\ttea\n"), "transactions")).toBe(2);
  });

  it("reports zero for an empty table rather than one blank row", () => {
    expect(countCopyRows(dump(""), "transactions")).toBe(0);
  });

  it("stops at the table's own terminator, not a later table's", () => {
    // Two COPY blocks; reading past the first would return both tables' rows.
    expect(countCopyRows(dump("1\t-500\tcoffee\n"), "transactions")).toBe(1);
    expect(countCopyRows(dump("1\t-500\tcoffee\n"), "categories")).toBe(1);
  });

  it("counts a description containing a literal backslash-dot", () => {
    // `\.` only terminates when alone on its line. A merchant string that
    // contains one must not be mistaken for the end of the data.
    expect(countCopyRows(dump("1\t-500\tSQUARE \\.COM\n2\t-100\ttea\n"), "transactions")).toBe(2);
  });

  it("returns zero for a table that is not in the dump", () => {
    expect(countCopyRows(dump("1\t-500\tx\n"), "nonexistent")).toBe(0);
  });

  it("returns zero when the block is truncated mid-write", () => {
    // A dump cut short by a crash has no terminator; treating it as complete
    // would let a partial file pass the count check.
    expect(
      countCopyRows("COPY public.transactions (id) FROM stdin;\n1\t-500\n", "transactions"),
    ).toBe(0);
  });
});
