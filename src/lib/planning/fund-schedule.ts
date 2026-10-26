import { z } from "zod";
import { incomeMonth } from "@/lib/income/logic";
import { monthBounds } from "@/lib/dates";
export const fundScheduleInput = z.object({
  fundId: z.uuid(),
  effectiveMonth: incomeMonth,
  amountCents: z.number().int().positive().max(100_000_000),
  weekday: z.number().int().min(0).max(6),
  enabled: z.boolean(),
});
export type FundSchedule = z.infer<typeof fundScheduleInput>;
export function weeklyFundForecast({
  month,
  schedule,
  contributedCents,
  withdrawnCents,
  rows,
}: {
  month: string;
  schedule: FundSchedule;
  contributedCents: number;
  withdrawnCents: number;
  rows: { id: string; amountCents: number; postedOn: string }[];
}) {
  const { start, end } = monthBounds(month);
  const dates: string[] = [];
  for (let day = Date.parse(start); day <= Date.parse(end); day += 86_400_000) {
    if (new Date(day).getUTCDay() === schedule.weekday)
      dates.push(new Date(day).toISOString().slice(0, 10));
  }
  const payments = [
    ...new Map(rows.map((row) => [row.id, row])).values(),
  ].filter(
    (row) =>
      row.amountCents === -schedule.amountCents &&
      row.postedOn >= start &&
      row.postedOn <= end,
  );
  const used = new Set<string>();
  let matched = 0;
  for (const date of dates) {
    const payment = payments
      .filter(
        (row) =>
          !used.has(row.id) &&
          Math.abs(Date.parse(row.postedOn) - Date.parse(date)) <=
            3 * 86_400_000,
      )
      .sort(
        (a, b) =>
          Math.abs(Date.parse(a.postedOn) - Date.parse(date)) -
          Math.abs(Date.parse(b.postedOn) - Date.parse(date)),
      )[0];
    if (payment) {
      used.add(payment.id);
      matched++;
    }
  }
  const remainingCents = schedule.enabled
    ? (dates.length - matched) * schedule.amountCents
    : 0;
  return {
    recurringCents: schedule.enabled ? dates.length * schedule.amountCents : 0,
    remainingCents,
    recordedCents: contributedCents - withdrawnCents,
    forecastCents: contributedCents - withdrawnCents + remainingCents,
  };
}
