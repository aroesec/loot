import { parseAmountToCents } from "@/lib/money";
import type { ParsedTransaction, ParseResult } from "./types";

/**
 * Every bank exports a different CSV. Rather than maintain per-institution
 * templates, we detect the delimiter, find the header row, and score each
 * column by name to work out which is the date, the description and the
 * amount. Falls back to inspecting the data when headers are missing.
 */

// --- Tokenizer --------------------------------------------------------------

/** RFC4180-ish row splitter: handles quoted fields and escaped quotes. */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  // Strip a UTF-8 BOM, which several banks emit and which otherwise corrupts
  // the first header cell.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field.trim());
      field = "";
    } else if (ch === "\n") {
      row.push(field.trim());
      field = "";
      rows.push(row);
      row = [];
    } else if (ch === "\r") {
      // handled by the \n branch
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    rows.push(row);
  }

  return rows.filter((r) => r.some((c) => c !== ""));
}

export function detectDelimiter(text: string): string {
  const sample = text.split("\n").slice(0, 20).join("\n");
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestScore = -1;

  for (const d of candidates) {
    const counts = sample
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => l.split(d).length);
    if (counts.length === 0) continue;
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    // Consistency across rows matters more than raw count.
    const variance =
      counts.reduce((a, b) => a + (b - avg) ** 2, 0) / counts.length;
    const score = avg > 1 ? avg - variance : -1;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

// --- Column detection -------------------------------------------------------

type ColumnMap = {
  date: number;
  description: number;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  balance: number | null;
  currency: number | null;
};

const DATE_HEADERS = [
  "date",
  "transaction date",
  "posted date",
  "post date",
  "posting date",
  "trans date",
  "value date",
  "effective date",
  "date posted",
  "completed date",
];

const DESC_HEADERS = [
  "description",
  "payee",
  "merchant",
  "name",
  "memo",
  "details",
  "transaction",
  "narrative",
  "reference",
  "particulars",
  "transaction description",
  "original description",
];

const AMOUNT_HEADERS = [
  "amount",
  "transaction amount",
  "amt",
  "value",
  "net amount",
];

const DEBIT_HEADERS = [
  "debit",
  "withdrawal",
  "withdrawals",
  "money out",
  "paid out",
  "charge",
  "debit amount",
];

const CREDIT_HEADERS = [
  "credit",
  "deposit",
  "deposits",
  "money in",
  "paid in",
  "credit amount",
];

function headerIndex(headers: string[], candidates: string[]): number | null {
  const lower = headers.map((h) => h.toLowerCase().trim());
  // Exact match first — "date" should not lose to "date posted".
  for (const c of candidates) {
    const i = lower.indexOf(c);
    if (i !== -1) return i;
  }
  for (const c of candidates) {
    const i = lower.findIndex((h) => h.includes(c));
    if (i !== -1) return i;
  }
  return null;
}

function looksLikeHeader(row: string[]): boolean {
  const joined = row.join(" ").toLowerCase();
  const hasDateWord = DATE_HEADERS.some((h) => joined.includes(h));
  const hasMoneyWord =
    AMOUNT_HEADERS.some((h) => joined.includes(h)) ||
    DEBIT_HEADERS.some((h) => joined.includes(h)) ||
    CREDIT_HEADERS.some((h) => joined.includes(h));
  // A header row has words, not values.
  const mostlyNonNumeric =
    row.filter((c) => c && !/^-?[\d.,$()]+$/.test(c)).length >= row.length / 2;
  return hasDateWord && hasMoneyWord && mostlyNonNumeric;
}

// --- Dates ------------------------------------------------------------------

/** Returns an ISO yyyy-mm-dd string, or null. */
export function parseDate(input: string, preferDayFirst = false): string | null {
  const s = input.trim();
  if (!s) return null;

  // ISO: 2026-03-14 or 2026/03/14
  const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) {
    return toIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  // Numeric: 03/14/2026, 14/03/2026, 3-14-26
  const numeric = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (numeric) {
    let a = Number(numeric[1]);
    let b = Number(numeric[2]);
    let year = Number(numeric[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;

    // If one value can only be a day, it settles the order regardless of locale.
    let month: number;
    let day: number;
    if (a > 12) {
      day = a;
      month = b;
    } else if (b > 12) {
      month = a;
      day = b;
    } else if (preferDayFirst) {
      day = a;
      month = b;
    } else {
      month = a;
      day = b;
    }
    return toIso(year, month, day);
  }

  // Textual: 14 Mar 2026, Mar 14 2026, 14-MAR-26
  const months: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  const textual = s
    .toLowerCase()
    .match(/^(\d{1,2})[\s-]([a-z]{3,})[\s-](\d{2,4})/);
  if (textual) {
    const month = months[textual[2]!.slice(0, 3)];
    if (month) {
      let year = Number(textual[3]);
      if (year < 100) year += year < 70 ? 2000 : 1900;
      return toIso(year, month, Number(textual[1]));
    }
  }
  const textual2 = s
    .toLowerCase()
    .match(/^([a-z]{3,})[\s-](\d{1,2}),?[\s-](\d{2,4})/);
  if (textual2) {
    const month = months[textual2[1]!.slice(0, 3)];
    if (month) {
      let year = Number(textual2[3]);
      if (year < 100) year += year < 70 ? 2000 : 1900;
      return toIso(year, month, Number(textual2[2]));
    }
  }

  return null;
}

function toIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Ambiguous numeric dates (both parts <= 12) can't be resolved row by row, but
 * a whole file usually contains at least one unambiguous row. If any row has a
 * first component above 12 the file is month-first; if any has a second
 * component above 12 it's day-first.
 */
function detectDayFirst(rows: string[][], dateCol: number): boolean {
  let monthFirstEvidence = 0;
  let dayFirstEvidence = 0;

  for (const row of rows) {
    const cell = row[dateCol];
    if (!cell) continue;
    const m = cell.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12) dayFirstEvidence++;
    else if (b > 12) monthFirstEvidence++;
  }

  return dayFirstEvidence > monthFirstEvidence;
}

// --- Main -------------------------------------------------------------------

export function parseCsvStatement(
  text: string,
  opts: {
    /**
     * The account this file was filed against, when the user picked one. Used
     * only to decide the sign convention — see the flip heuristic below, where
     * knowing "this is a checking account" is what stops a deposit-heavy month
     * being negated into spending.
     */
    accountKind?: string | null;
  } = {},
): ParseResult {
  const accountKind = opts.accountKind ?? null;
  const warnings: string[] = [];
  const delimiter = detectDelimiter(text);
  const rows = parseCsv(text, delimiter);

  if (rows.length === 0) {
    return { transactions: [], warnings: ["The file contained no rows."] };
  }

  // Banks often prepend account summary lines before the real header.
  let headerRow = -1;
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    if (looksLikeHeader(rows[i]!)) {
      headerRow = i;
      break;
    }
  }

  let headers: string[];
  let dataRows: string[][];

  if (headerRow === -1) {
    warnings.push(
      "No header row was recognized — columns were inferred from the data.",
    );
    headers = [];
    dataRows = rows;
  } else {
    headers = rows[headerRow]!;
    dataRows = rows.slice(headerRow + 1);
  }

  const map = headers.length
    ? mapFromHeaders(headers)
    : mapFromData(dataRows);

  if (!map) {
    return {
      transactions: [],
      warnings: [
        ...warnings,
        "Could not identify date, description and amount columns in this file.",
      ],
    };
  }

  if (map.amount === null && map.debit === null && map.credit === null) {
    return {
      transactions: [],
      warnings: [...warnings, "No amount column was found."],
    };
  }

  const dayFirst = detectDayFirst(dataRows, map.date);
  if (dayFirst) {
    warnings.push("Dates were read as day-first (DD/MM/YYYY).");
  }

  const out: ParsedTransaction[] = [];
  let skipped = 0;

  for (const row of dataRows) {
    const dateCell = row[map.date] ?? "";
    const postedOn = parseDate(dateCell, dayFirst);
    if (!postedOn) {
      skipped++;
      continue;
    }

    const description = (row[map.description] ?? "").trim();
    if (!description) {
      skipped++;
      continue;
    }

    let amountCents: number | null = null;

    if (map.amount !== null) {
      amountCents = parseAmountToCents(row[map.amount] ?? "");
    } else {
      // Separate debit/credit columns: debit is an outflow, credit an inflow.
      const debit = map.debit !== null ? parseAmountToCents(row[map.debit] ?? "") : null;
      const credit = map.credit !== null ? parseAmountToCents(row[map.credit] ?? "") : null;
      if (debit) amountCents = -Math.abs(debit);
      else if (credit) amountCents = Math.abs(credit);
    }

    if (amountCents === null || amountCents === 0) {
      skipped++;
      continue;
    }

    out.push({
      postedOn,
      amountCents,
      rawDescription: description,
      currency: map.currency !== null ? (row[map.currency] || undefined) : undefined,
    });
  }

  if (skipped > 0) {
    warnings.push(`${skipped} row${skipped === 1 ? "" : "s"} skipped (no usable date, description or amount).`);
  }

  /*
   * Some exports write spending as a positive number, so the whole file has to
   * be negated. Getting this wrong in the other direction is the expensive
   * mistake: negating a genuine deposit-heavy month turns every paycheck into
   * spending, silently and for the whole statement.
   *
   * So the threshold depends on what we know about the account:
   *
   *   credit card — spending-positive is a normal export convention, and a
   *     card statement is overwhelmingly charges. A clear majority is enough.
   *
   *   checking / savings — never flip. A month with more deposits than
   *     withdrawals is an ordinary thing (a bonus, a tax refund, a transfer
   *     in), and no amount of inference is worth eating someone's income. Say
   *     so instead and let them look.
   *
   *   unknown — only when there is not a single outflow in the file. Any real
   *     deposit account has some spending in it, so an all-positive file is a
   *     spending-positive export rather than a month of pure income.
   */
  if (map.amount !== null && out.length >= 5) {
    const positives = out.filter((t) => t.amountCents > 0).length;
    const share = positives / out.length;
    const isCard = accountKind === "credit_card";
    const isDepositAccount =
      accountKind === "checking" || accountKind === "savings";

    if (isCard ? share > 0.6 : !isDepositAccount && share === 1) {
      warnings.push(
        isCard
          ? `${positives} of ${out.length} amounts were positive on a credit card, so the file was read as a spending-positive export and signs were flipped.`
          : "Every amount in the file was positive, so it was read as a spending-positive export and signs were flipped.",
      );
      for (const t of out) t.amountCents = -t.amountCents;
    } else if (isDepositAccount && share > 0.8) {
      warnings.push(
        `${positives} of ${out.length} amounts are positive. They were read as money arriving. If this export writes spending as a positive number, the totals will be wrong — check one row before trusting them.`,
      );
    }
  }

  return { transactions: out, warnings };
}

function mapFromHeaders(headers: string[]): ColumnMap | null {
  const date = headerIndex(headers, DATE_HEADERS);
  const description = headerIndex(headers, DESC_HEADERS);
  if (date === null || description === null) return null;

  const debit = headerIndex(headers, DEBIT_HEADERS);
  const credit = headerIndex(headers, CREDIT_HEADERS);
  // Prefer explicit debit/credit pairs over a generic "amount" column when the
  // file has both — the pair carries the direction unambiguously.
  const amount = debit !== null && credit !== null
    ? null
    : headerIndex(headers, AMOUNT_HEADERS);

  return {
    date,
    description,
    amount,
    debit: amount === null ? debit : null,
    credit: amount === null ? credit : null,
    balance: headerIndex(headers, ["balance", "running balance"]),
    currency: headerIndex(headers, ["currency", "curr"]),
  };
}

/** Header-free fallback: score each column by what its values look like. */
function mapFromData(rows: string[][]): ColumnMap | null {
  const sample = rows.slice(0, 40);
  if (sample.length === 0) return null;
  const width = Math.max(...sample.map((r) => r.length));

  let dateCol = -1;
  let amountCol = -1;
  let descCol = -1;
  let bestDate = 0;
  let bestAmount = 0;
  let bestDesc = 0;

  for (let col = 0; col < width; col++) {
    const values = sample.map((r) => r[col] ?? "").filter(Boolean);
    if (values.length === 0) continue;

    const dateScore = values.filter((v) => parseDate(v) !== null).length / values.length;
    const amountScore =
      values.filter((v) => /[\d]/.test(v) && parseAmountToCents(v) !== null && !/^\d{4}-\d{2}-\d{2}/.test(v)).length /
      values.length;
    const descScore =
      values.filter((v) => /[a-z]{3,}/i.test(v)).length / values.length;

    if (dateScore > bestDate && dateScore > 0.7) {
      bestDate = dateScore;
      dateCol = col;
    }
    if (amountScore > bestAmount && amountScore > 0.7 && col !== dateCol) {
      bestAmount = amountScore;
      amountCol = col;
    }
    if (descScore > bestDesc && descScore > 0.5) {
      bestDesc = descScore;
      descCol = col;
    }
  }

  if (dateCol === -1 || amountCol === -1 || descCol === -1) return null;
  if (descCol === dateCol || descCol === amountCol) return null;

  return {
    date: dateCol,
    description: descCol,
    amount: amountCol,
    debit: null,
    credit: null,
    balance: null,
    currency: null,
  };
}
