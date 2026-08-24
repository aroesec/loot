import { medianCents, pctChange } from "../money";

/**
 * Recurring detection works on merchant groups rather than on descriptions,
 * because the same subscription appears with a different reference number
 * every month. A group is a series when both its timing and its amount are
 * regular — either signal alone produces false positives (a weekly grocery run
 * has regular timing but wildly varying amounts; two coincidental $9.99
 * charges have a matching amount but no rhythm).
 */

export type Cadence =
  | "weekly"
  | "biweekly"
  | "monthly"
  | "quarterly"
  | "annual"
  | "irregular";

/** Median gap in days -> cadence, with tolerance for weekends and short months. */
const CADENCE_BANDS: Array<{
  cadence: Cadence;
  min: number;
  max: number;
  perYear: number;
}> = [
  { cadence: "weekly", min: 5, max: 9, perYear: 52 },
  { cadence: "biweekly", min: 12, max: 18, perYear: 26 },
  { cadence: "monthly", min: 26, max: 35, perYear: 12 },
  { cadence: "quarterly", min: 84, max: 98, perYear: 4 },
  { cadence: "annual", min: 350, max: 380, perYear: 1 },
];

export function cadenceFor(medianDays: number): {
  cadence: Cadence;
  perYear: number;
} {
  for (const band of CADENCE_BANDS) {
    if (medianDays >= band.min && medianDays <= band.max) {
      return { cadence: band.cadence, perYear: band.perYear };
    }
  }
  return { cadence: "irregular", perYear: medianDays > 0 ? 365 / medianDays : 0 };
}

function daysBetween(a: string, b: string): number {
  const ms = Date.parse(b) - Date.parse(a);
  return Math.round(ms / 86_400_000);
}

function addDays(iso: string, days: number): string {
  const d = new Date(Date.parse(iso) + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export type SeriesCandidate = {
  merchant: string;
  categoryId: string | null;
  cadence: Cadence;
  typicalAmountCents: number;
  lastAmountCents: number;
  firstSeenOn: string;
  lastSeenOn: string;
  nextExpectedOn: string | null;
  occurrences: number;
  status: "active" | "ended";
  priceChangePct: number | null;
  annualizedCents: number;
  transactionIds: string[];
};

export type DetectionInput = {
  id: string;
  merchant: string;
  categoryId: string | null;
  postedOn: string;
  amountCents: number;
};

/** Minimum observations before we're willing to call something recurring. */
const MIN_OCCURRENCES = 3;
/** Amounts must be this consistent: max deviation from median, as a fraction. */
const AMOUNT_TOLERANCE = 0.25;
/** Timing must be this consistent: max deviation from median gap. */
const INTERVAL_TOLERANCE = 0.4;

export function detectSeries(
  rows: DetectionInput[],
  today = new Date().toISOString().slice(0, 10),
): SeriesCandidate[] {
  const groups = new Map<string, DetectionInput[]>();
  for (const row of rows) {
    const key = row.merchant.trim().toLowerCase();
    if (!key) continue;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  const out: SeriesCandidate[] = [];

  for (const [, group] of groups) {
    if (group.length < MIN_OCCURRENCES) continue;

    const sorted = [...group].sort((a, b) => a.postedOn.localeCompare(b.postedOn));

    // Collapse same-day duplicates — a split charge is one occurrence.
    const byDate = new Map<string, DetectionInput[]>();
    for (const row of sorted) {
      const list = byDate.get(row.postedOn);
      if (list) list.push(row);
      else byDate.set(row.postedOn, [row]);
    }
    const occurrences = [...byDate.entries()].map(([date, items]) => ({
      date,
      amountCents: items.reduce((a, b) => a + b.amountCents, 0),
      ids: items.map((i) => i.id),
    }));

    if (occurrences.length < MIN_OCCURRENCES) continue;

    const gaps: number[] = [];
    for (let i = 1; i < occurrences.length; i++) {
      gaps.push(daysBetween(occurrences[i - 1]!.date, occurrences[i]!.date));
    }
    if (gaps.length === 0) continue;

    const medianGap = median(gaps);
    if (medianGap < 4) continue; // same-week noise, not a subscription

    // Timing regularity.
    const irregularGaps = gaps.filter(
      (g) => Math.abs(g - medianGap) / medianGap > INTERVAL_TOLERANCE,
    ).length;
    if (irregularGaps / gaps.length > 0.34) continue;

    // Amount regularity. Magnitudes, since these are outflows.
    const amounts = occurrences.map((o) => Math.abs(o.amountCents));
    const typical = medianCents(amounts);
    if (typical === 0) continue;
    const offAmounts = amounts.filter(
      (a) => Math.abs(a - typical) / typical > AMOUNT_TOLERANCE,
    ).length;
    if (offAmounts / amounts.length > 0.34) continue;

    const { cadence, perYear } = cadenceFor(medianGap);
    if (cadence === "irregular") continue;

    const first = occurrences[0]!;
    const last = occurrences[occurrences.length - 1]!;
    const nextExpectedOn = addDays(last.date, Math.round(medianGap));

    // A series is "ended" once it's overdue by more than half a period —
    // that's the signal for "you cancelled this" or "the charge stopped".
    const daysSinceLast = daysBetween(last.date, today);
    const status: "active" | "ended" =
      daysSinceLast > medianGap * 1.5 + 5 ? "ended" : "active";

    // Compare the earliest amount to the most recent to surface price hikes.
    const priceChangePct = pctChange(
      Math.abs(first.amountCents),
      Math.abs(last.amountCents),
    );

    const source = group[0]!;

    out.push({
      merchant: source.merchant.trim(),
      categoryId: source.categoryId,
      cadence,
      typicalAmountCents: typical,
      lastAmountCents: Math.abs(last.amountCents),
      firstSeenOn: first.date,
      lastSeenOn: last.date,
      nextExpectedOn,
      occurrences: occurrences.length,
      status,
      priceChangePct,
      annualizedCents: Math.round(typical * perYear),
      transactionIds: occurrences.flatMap((o) => o.ids),
    });
  }

  return out.sort((a, b) => b.annualizedCents - a.annualizedCents);
}
