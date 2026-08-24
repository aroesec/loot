/**
 * Reading pg_dump's text output.
 *
 * Split from `backup.ts` because that module imports `@/lib/env`, which
 * validates a live database URL on load — the same reason `dates.ts` and
 * `classify/match.ts` are separate. Parsing is the part worth testing, and it
 * should not need a database to run.
 */

/**
 * Count the data rows pg_dump wrote for one table.
 *
 * The text format emits `COPY public.x (...) FROM stdin;`, the rows, then a
 * lone `\.` terminator. Exported for the test, which is the only way to be sure
 * this keeps agreeing with pg_dump's actual output.
 */
export function countCopyRows(dump: string, table: string): number {
  const start = dump.indexOf(`COPY public.${table} (`);
  if (start === -1) return 0;

  const bodyStart = dump.indexOf("\n", dump.indexOf("FROM stdin;", start)) + 1;
  if (bodyStart === 0) return 0;

  /*
   * Walk lines to the terminator rather than searching for "\n\\.\n".
   *
   * That search cannot match a terminator sitting at the very start of the
   * body, because the newline it needs belongs to the header line before it —
   * so an *empty* table skipped its own terminator and counted the next
   * table's rows instead. An empty `transactions` reported `categories`,
   * which is precisely the wiped-database case this count exists to catch.
   */
  let rows = 0;
  let pos = bodyStart;
  while (pos < dump.length) {
    const nl = dump.indexOf("\n", pos);
    // No terminator: the dump was truncated, so nothing here is trustworthy.
    if (nl === -1) return 0;
    if (dump.slice(pos, nl) === "\\.") return rows;
    rows++;
    pos = nl + 1;
  }
  return 0;
}
