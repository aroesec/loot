import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "@/lib/export-csv";

/**
 * Transaction descriptions are hostile to CSV by nature. Every case here shifts
 * the columns to its right if it is not escaped, which leaves a file that still
 * opens cleanly with the numbers under the wrong headings.
 */
describe("csvCell", () => {
  it("leaves an ordinary value alone", () => {
    // Quoting everything would be safe and unreadable.
    expect(csvCell("STARBUCKS")).toBe("STARBUCKS");
    expect(csvCell("-42.50")).toBe("-42.50");
  });

  it("quotes a value containing a comma", () => {
    // The common one: "SQ *CAFE, SPRINGFIELD" is a single field.
    expect(csvCell("SQ *CAFE, SPRINGFIELD")).toBe('"SQ *CAFE, SPRINGFIELD"');
  });

  it("doubles embedded quotes", () => {
    expect(csvCell('SAM"S CLUB')).toBe('"SAM""S CLUB"');
  });

  it("quotes a value containing a newline", () => {
    // A badly parsed PDF statement produces these.
    expect(csvCell("LINE ONE\nLINE TWO")).toBe('"LINE ONE\nLINE TWO"');
    expect(csvCell("LINE ONE\r\nLINE TWO")).toBe('"LINE ONE\r\nLINE TWO"');
  });

  it("writes an empty field for null and undefined", () => {
    // Not the strings "null" and "undefined", which a spreadsheet imports as
    // text and which look like real values in a column of merchants.
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("keeps a bigint exact", () => {
    // Amounts are bigint cents. Going through Number would lose precision at
    // the top of the range, which is the reason cents are stored this way.
    expect(csvCell(9007199254740993n)).toBe("9007199254740993");
  });

  it("writes a date in a sortable form", () => {
    expect(csvCell(new Date("2026-03-15T12:00:00Z"))).toBe("2026-03-15T12:00:00.000Z");
  });

  it("does not quote a value merely containing a space or a dollar sign", () => {
    expect(csvCell("TRADER JOE'S #123")).toBe("TRADER JOE'S #123");
    expect(csvCell("$1234.56")).toBe("$1234.56");
  });
});

describe("toCsv", () => {
  it("keeps every row the same width as the header", () => {
    /*
     * The property that matters. A row that parses to a different number of
     * fields than the header is how a column silently shifts, so it is asserted
     * on a row built entirely from hostile values.
     */
    const csv = toCsv(
      ["date", "description", "amount"],
      [
        ["2026-03-15", "SQ *CAFE, SPRINGFIELD", "-12.40"],
        ["2026-03-16", 'SAM"S CLUB', "-88.00"],
        ["2026-03-17", "LINE ONE\nLINE TWO", "-5.00"],
      ],
    );

    // Split on record boundaries, honouring quoted fields.
    const records = csv.trimEnd().split(/\r\n(?=(?:[^"]*"[^"]*")*[^"]*$)/);
    expect(records).toHaveLength(4);
    for (const r of records) {
      const fields = r.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
      expect(fields).toHaveLength(3);
    }
  });

  it("uses CRLF and ends with a newline", () => {
    // RFC 4180, and Excel on Windows merges rows on a bare LF.
    const csv = toCsv(["a"], [["1"]]);
    expect(csv).toBe("a\r\n1\r\n");
  });

  it("writes a header even with no rows", () => {
    // An empty ledger should still produce a file a spreadsheet can open.
    expect(toCsv(["date", "amount"], [])).toBe("date,amount\r\n");
  });
});
