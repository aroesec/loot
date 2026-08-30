import { describe, it, expect } from "vitest";
import {
  monthBounds,
  yearBounds,
  shiftMonth,
  monthLabel,
  currentMonth,
  isIsoDate,
} from "@/lib/dates";

/**
 * Period boundaries decide which transactions a total contains, so an error
 * here does not throw — it silently attributes money to the wrong month. That
 * failure mode is the same shape as the transfer-flag bugs: a number that
 * looks right and is not.
 *
 * These matter more now that accounts carry several months of synced history.
 * With one imported statement every row fell inside the window and a broken
 * boundary was invisible; with June, July and August in the table, an off-by-one
 * pulls a prior month's card charges into the current one.
 */
describe("monthBounds", () => {
  it("covers the whole month, inclusive at both ends", () => {
    expect(monthBounds("2026-08")).toEqual({
      start: "2026-08-01",
      end: "2026-08-31",
    });
  });

  it("gets short months right", () => {
    // 30-day month: an end of the 31st would silently swallow nothing, but an
    // end of the 29th would drop a day of spending.
    expect(monthBounds("2026-06")).toEqual({
      start: "2026-06-01",
      end: "2026-06-30",
    });
    expect(monthBounds("2026-09").end).toBe("2026-09-30");
    expect(monthBounds("2026-04").end).toBe("2026-04-30");
    expect(monthBounds("2026-11").end).toBe("2026-11-30");
  });

  it("gets February right in common and leap years", () => {
    expect(monthBounds("2026-02").end).toBe("2026-02-28");
    expect(monthBounds("2027-02").end).toBe("2027-02-28");
    // 2028 is a leap year; 2100 is not, despite being divisible by four.
    expect(monthBounds("2028-02").end).toBe("2028-02-29");
    expect(monthBounds("2100-02").end).toBe("2100-02-28");
    expect(monthBounds("2000-02").end).toBe("2000-02-29");
  });

  it("does not spill across a year boundary", () => {
    expect(monthBounds("2026-12")).toEqual({
      start: "2026-12-01",
      end: "2026-12-31",
    });
    expect(monthBounds("2027-01")).toEqual({
      start: "2027-01-01",
      end: "2027-01-31",
    });
  });

  it("produces windows that tile without gaps or overlaps", () => {
    /*
     * The property that actually matters: every day of the year belongs to
     * exactly one month window. A gap loses transactions from every total; an
     * overlap counts them twice.
     */
    const months = Array.from(
      { length: 12 },
      (_, i) => `2026-${String(i + 1).padStart(2, "0")}`,
    );
    const bounds = months.map(monthBounds);

    expect(bounds[0]!.start).toBe("2026-01-01");
    expect(bounds[11]!.end).toBe("2026-12-31");

    for (let i = 1; i < bounds.length; i++) {
      const prevEnd = new Date(`${bounds[i - 1]!.end}T00:00:00Z`);
      const thisStart = new Date(`${bounds[i]!.start}T00:00:00Z`);
      const gapDays =
        (thisStart.getTime() - prevEnd.getTime()) / (24 * 60 * 60 * 1000);
      expect(gapDays, `${months[i - 1]} -> ${months[i]}`).toBe(1);
    }
  });

  it("is stable regardless of the machine's timezone", () => {
    /*
     * Built with Date.UTC rather than local dates. A local-time construction
     * shifts the boundary by a day west of UTC, which moves the first and last
     * day of every month into the neighbouring one.
     */
    const original = process.env.TZ;
    try {
      for (const tz of ["UTC", "America/New_York", "Pacific/Kiritimati", "Etc/GMT+12"]) {
        process.env.TZ = tz;
        expect(monthBounds("2026-08"), tz).toEqual({
          start: "2026-08-01",
          end: "2026-08-31",
        });
        expect(monthBounds("2026-03").end, tz).toBe("2026-03-31");
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

describe("period filtering semantics", () => {
  /**
   * The ledger filters with `postedOn >= start AND postedOn <= end` against a
   * `date` column, so comparison is lexicographic on ISO strings. These assert
   * the inclusivity the queries rely on.
   */
  const inWindow = (day: string, month: string) => {
    const { start, end } = monthBounds(month);
    return day >= start && day <= end;
  };

  it("includes both edge days", () => {
    expect(inWindow("2026-08-01", "2026-08")).toBe(true);
    expect(inWindow("2026-08-31", "2026-08")).toBe(true);
  });

  it("excludes the neighbouring days", () => {
    expect(inWindow("2026-07-31", "2026-08")).toBe(false);
    expect(inWindow("2026-09-01", "2026-08")).toBe(false);
  });

  it("keeps a prior month's card charges out of the current month", () => {
    // The concrete worry once several months of synced card history exist.
    for (const day of ["2026-05-28", "2026-06-11", "2026-06-30", "2026-07-15"]) {
      expect(inWindow(day, "2026-08"), day).toBe(false);
    }
    for (const day of ["2026-08-01", "2026-08-21", "2026-08-22"]) {
      expect(inWindow(day, "2026-08"), day).toBe(true);
    }
  });

  it("assigns every day of a year to exactly one month", () => {
    const months = Array.from(
      { length: 12 },
      (_, i) => `2026-${String(i + 1).padStart(2, "0")}`,
    );
    for (const day of ["2026-01-01", "2026-02-28", "2026-06-30", "2026-12-31"]) {
      const hits = months.filter((m) => inWindow(day, m));
      expect(hits.length, `${day} matched ${hits.join(",")}`).toBe(1);
    }
  });
});

describe("yearBounds", () => {
  it("covers the whole year inclusively", () => {
    expect(yearBounds(2026)).toEqual({
      start: "2026-01-01",
      end: "2026-12-31",
    });
  });

  it("excludes the neighbouring years", () => {
    const { start, end } = yearBounds(2026);
    expect("2025-12-31" >= start).toBe(false);
    expect("2027-01-01" <= end).toBe(false);
  });
});

describe("shiftMonth", () => {
  it("moves within a year", () => {
    expect(shiftMonth("2026-08", -1)).toBe("2026-07");
    expect(shiftMonth("2026-08", 1)).toBe("2026-09");
  });

  it("rolls over year boundaries in both directions", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -13)).toBe("2024-12");
    expect(shiftMonth("2026-12", 13)).toBe("2028-01");
  });

  it("does not drift when stepping back and forward", () => {
    // categoryTrends walks backwards month by month; drift there would
    // silently compare against the wrong baseline period.
    let m = "2026-08";
    for (let i = 0; i < 24; i++) m = shiftMonth(m, -1);
    expect(m).toBe("2024-08");
    for (let i = 0; i < 24; i++) m = shiftMonth(m, 1);
    expect(m).toBe("2026-08");
  });

  it("never lands on a month that does not exist", () => {
    // Stepping from a 31-day month must not overflow into the following one.
    for (const start of ["2026-01", "2026-03", "2026-05", "2026-08", "2026-10"]) {
      for (const delta of [-1, 1, -2, 2]) {
        const result = shiftMonth(start, delta);
        expect(result, `${start} ${delta}`).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
      }
    }
  });
});

describe("labels and current month", () => {
  it("labels a month readably", () => {
    expect(monthLabel("2026-08")).toContain("2026");
    expect(monthLabel("2026-08")).toMatch(/aug/i);
  });

  it("returns the current month in the key format", () => {
    expect(currentMonth()).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
  });
});

/**
 * The overlap guard that stops a synced row duplicating an imported statement.
 *
 * Mirrors `isCovered` in lib/plaid/sync.ts. Duplicated here rather than
 * imported because that module pulls in the Plaid SDK and the database; the
 * logic under test is the interval check, not the plumbing.
 */
function isCovered(
  date: string,
  ranges: Array<{ start: string; end: string }>,
): boolean {
  return ranges.some((r) => date >= r.start && date <= r.end);
}

describe("statement coverage ranges", () => {
  // A single uploaded statement covering most of August.
  const august = [{ start: "2026-08-03", end: "2026-08-21" }];

  it("skips rows inside the covered window", () => {
    for (const d of ["2026-08-03", "2026-08-12", "2026-08-21"]) {
      expect(isCovered(d, august), d).toBe(true);
    }
  });

  it("imports rows after the window", () => {
    expect(isCovered("2026-08-22", august)).toBe(false);
  });

  /*
   * The regression this replaced a single cutoff date for. "Skip everything on
   * or before the last statement row" also blocked June and July, so a
   * checking account with one uploaded month could never backfill the months
   * before it — and those months rendered as periods with card spending and no
   * income.
   */
  it("imports rows BEFORE the window", () => {
    for (const d of ["2026-05-28", "2026-06-11", "2026-07-15", "2026-08-02"]) {
      expect(isCovered(d, august), d).toBe(false);
    }
  });

  it("handles several statements with a gap between them", () => {
    const ranges = [
      { start: "2026-06-01", end: "2026-06-30" },
      { start: "2026-08-01", end: "2026-08-31" },
    ];
    expect(isCovered("2026-06-15", ranges)).toBe(true);
    expect(isCovered("2026-08-15", ranges)).toBe(true);
    // July was never uploaded, so it must still be importable.
    expect(isCovered("2026-07-15", ranges)).toBe(false);
  });

  it("covers everything when no statement has been imported", () => {
    // No ranges means nothing is covered, so a fresh account pulls full history.
    expect(isCovered("2026-06-01", [])).toBe(false);
    expect(isCovered("2026-08-22", [])).toBe(false);
  });

  it("treats the boundaries as inclusive", () => {
    const r = [{ start: "2026-08-01", end: "2026-08-31" }];
    expect(isCovered("2026-07-31", r)).toBe(false);
    expect(isCovered("2026-08-01", r)).toBe(true);
    expect(isCovered("2026-08-31", r)).toBe(true);
    expect(isCovered("2026-09-01", r)).toBe(false);
  });
});

/**
 * `2026-13-45` matches every reasonable shape check and is rejected by
 * Postgres, so a regex alone lets a form send user input to the database to
 * fail there.
 */
describe("isIsoDate", () => {
  it("accepts a real date and rejects one that only looks like it", () => {
    expect(isIsoDate("2026-08-30")).toBe(true);
    expect(isIsoDate("2026-13-45")).toBe(false);
  });

  it("rejects a day that does not exist in that month, and the wrong shape", () => {
    expect(isIsoDate("2025-02-30")).toBe(false);
    expect(isIsoDate("2026-2-3")).toBe(false);
  });
});
