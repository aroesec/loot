/**
 * Writing CSV that a spreadsheet reads back correctly.
 *
 * DB-free so it can be tested without a database.
 *
 * The whole difficulty is that transaction descriptions are hostile to CSV by
 * nature. They contain commas (`SQ *CAFE, SPRINGFIELD`), quotes, and occasionally a
 * newline from a badly parsed statement. Each of those silently shifts every
 * column to its right, so the file still opens and the numbers land under the
 * wrong headings — a wrong answer rather than an error, which is the failure
 * this module exists to prevent.
 */

/**
 * @param value Anything a column can hold. `null` and `undefined` become an
 *   empty field rather than the strings "null" or "undefined", which is what a
 *   naive template produces and what a spreadsheet then imports as text.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";

  const s =
    typeof value === "bigint"
      ? value.toString()
      : value instanceof Date
        ? value.toISOString()
        : String(value);

  // Quote only when required, so an ordinary file stays readable by eye.
  if (!/[",\n\r]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));

  /*
   * CRLF, and a trailing newline. RFC 4180 specifies CRLF, and Excel on Windows
   * merges rows when it sees bare LF in a file it treats as CSV.
   */
  return lines.join("\r\n") + "\r\n";
}
