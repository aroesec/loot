/**
 * Schedule C shapes and formatting, with no database behind them.
 *
 * Split from `tax.ts` for the reason `match.ts` and `dump-text.ts` were split
 * from theirs: importing `@/db` pulls in the whole env schema, which needs a
 * live database URL to load and puts anything in the module out of reach of a
 * unit test.
 */

export type ScheduleCLine = {
  /** "8 — Advertising". Null for anything not mapped. */
  line: string | null;
  /** Sort key parsed out of the line label. */
  lineNumber: number;
  categories: Array<{ slug: string; name: string; amountCents: number }>;
  amountCents: number;
  deductibleCents: number;
  /** Null when the categories on this line disagree about the percentage. */
  deductiblePct: number | null;
  transactionCount: number;
};

export type ScheduleCSummary = {
  year: number;
  grossReceiptsCents: number;
  /** Expenses at face value, before any deductible percentage. */
  expensesCents: number;
  /** What the percentages actually allow. */
  deductibleCents: number;
  netProfitCents: number;

  revenueLines: ScheduleCLine[];
  expenseLines: ScheduleCLine[];

  /**
   * Business spending in categories with no Schedule C line.
   *
   * Surfaced rather than folded into a total. A category that maps to no line
   * is money the ledger cannot place on the form, and quietly adding it to
   * "other expenses" would be inventing an answer.
   */
  unmapped: ScheduleCLine | null;

  /** Owner draws and contributions, reported separately and never deducted. */
  ownerEquityCents: number;
};

/** "24b — Meals" sorts after "24a". "38" sorts after "11". */
export function lineOrder(line: string | null): number {
  if (!line) return 9999;
  const m = line.match(/^(\d+)([a-z])?/);
  if (!m) return 9998;
  return Number(m[1]) * 10 + (m[2] ? m[2].charCodeAt(0) - 96 : 0);
}

/** One row per Schedule C line, for a spreadsheet or an accountant. */
export function scheduleCsv(summary: ScheduleCSummary): string {
  const esc = (v: string | number) =>
    typeof v === "number" ? String(v) : `"${v.replace(/"/g, '""')}"`;
  const money = (cents: number) => (cents / 100).toFixed(2);

  const out: string[] = [
    ["Section", "Schedule C line", "Category", "Amount", "Deductible %", "Deductible amount", "Transactions"]
      .map(esc)
      .join(","),
  ];

  const emit = (section: string, lines: ScheduleCLine[]) => {
    for (const l of lines) {
      for (const c of l.categories) {
        const pct = l.deductiblePct ?? 100;
        out.push(
          [
            esc(section),
            esc(l.line ?? "Not mapped"),
            esc(c.name),
            money(c.amountCents),
            section === "Revenue" ? "" : String(pct),
            section === "Revenue" ? "" : money(Math.round(c.amountCents * (pct / 100))),
            l.transactionCount,
          ].join(","),
        );
      }
    }
  };

  emit("Revenue", summary.revenueLines);
  emit("Expense", summary.expenseLines);
  if (summary.unmapped) emit("Not mapped", [summary.unmapped]);

  out.push("");
  out.push([esc("Gross receipts"), "", "", money(summary.grossReceiptsCents)].join(","));
  out.push([esc("Total expenses"), "", "", money(summary.expensesCents)].join(","));
  out.push([esc("Total deductible"), "", "", money(summary.deductibleCents)].join(","));
  out.push([esc("Net profit"), "", "", money(summary.netProfitCents)].join(","));
  out.push([esc("Owner's draw (not an expense)"), "", "", money(summary.ownerEquityCents)].join(","));

  return out.join("\n") + "\n";
}
