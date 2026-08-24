/**
 * All money in this app is integer cents. Floats are only ever produced at the
 * formatting boundary, never stored or summed.
 */

/** Parse a human/statement amount ("$1,234.56", "(45.00)", "-12.30") to cents. */
export function parseAmountToCents(input: string | number): number | null {
  if (typeof input === "number") {
    return Number.isFinite(input) ? Math.round(input * 100) : null;
  }

  let s = input.trim();
  if (!s) return null;

  // Accounting notation: (45.00) means negative.
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }

  // A trailing or leading minus, and CR/DR suffixes some banks emit.
  if (/^-/.test(s)) {
    negative = true;
    s = s.slice(1);
  }
  if (/-$/.test(s)) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (/\bDR\b/i.test(s)) negative = true;
  if (/\bCR\b/i.test(s)) negative = false;

  s = s.replace(/\b(?:CR|DR)\b/gi, "");
  s = s.replace(/[^0-9.,]/g, "");
  if (!s) return null;

  // Decide which separator is the decimal point. European statements use
  // "1.234,56"; US uses "1,234.56".
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }

  const value = Number.parseFloat(s);
  if (!Number.isFinite(value)) return null;

  const cents = Math.round(value * 100);
  return negative ? -cents : cents;
}

export function formatCents(
  cents: number,
  opts: { currency?: string; signed?: boolean; compact?: boolean } = {},
): string {
  const { currency = "USD", signed = false, compact = false } = opts;
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: compact ? 0 : 2,
    maximumFractionDigits: compact ? 0 : 2,
    notation: compact ? "compact" : "standard",
  });
  const out = formatter.format(Math.abs(cents) / 100);
  if (signed && cents > 0) return `+${out}`;
  if (cents < 0) return `-${out}`;
  return out;
}

/** Median is used for recurring amounts so one odd charge can't skew a series. */
export function medianCents(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

export function sumCents(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

/** Outflows are stored negative; spend totals are reported as positive. */
export function spendOf(amountCents: number): number {
  return amountCents < 0 ? -amountCents : 0;
}

export function incomeOf(amountCents: number): number {
  return amountCents > 0 ? amountCents : 0;
}

export function pctChange(from: number, to: number): number | null {
  if (from === 0) return null;
  return ((to - from) / Math.abs(from)) * 100;
}
