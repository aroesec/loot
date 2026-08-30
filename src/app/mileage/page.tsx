import { desc } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { db } from "@/db";
import { mileageTrips } from "@/db/schema";
import { PageHeader, Card, Stat } from "@/components/ui";
import { ledgerMode } from "@/lib/mode";
import { redirect } from "next/navigation";
import {
  milesFromTenths,
  mileageRate,
  tripDeductionCents,
  totalDeduction,
} from "@/lib/mileage";
import { createMileageTripAction, deleteMileageTripAction } from "../actions";

export const dynamic = "force-dynamic";

function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * The mileage log.
 *
 * The only Schedule C figure that cannot come from a statement: it is derived
 * from miles driven rather than money that moved, so nothing imports it.
 */
export default async function MileagePage() {
  await requireAuth();

  // Business-only, like the P&L. A household ledger has no Schedule C to put
  // this on, and the nav hides the link — this is the direct-URL case.
  if ((await ledgerMode()) !== "business") redirect("/");

  const trips = await db
    .select()
    .from(mileageTrips)
    .orderBy(desc(mileageTrips.droveOn));

  const year = new Date().getFullYear();
  const thisYear = trips.filter((t) => t.droveOn.startsWith(String(year)));
  const total = totalDeduction(thisYear);
  const today = new Date().toISOString().slice(0, 10);
  const currentRate = mileageRate(today);

  return (
    <>
      <PageHeader
        title="Mileage"
        subtitle={`Business driving for ${year}, at the standard rate`}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label={`Miles in ${year}`} value={milesFromTenths(total.milesTenths).toLocaleString("en-US")} />
        <Stat label="Deduction" value={usd(total.deductionCents)} />
        <Stat
          label="Rate today"
          value={`${currentRate.centsPerMile}¢`}
        />
      </div>

      {/*
        Stated once, prominently. Claiming the standard rate and the actual
        running costs for the same vehicle is double-counting, and the ledger
        cannot detect it — the fuel is a bank transaction and the mileage is
        this list, and neither knows about the other.
      */}
      <Card className="mb-4">
        <p className="text-sm text-[var(--color-ink-muted)]">
          This is the <strong>standard mileage</strong> method. It is an
          alternative to deducting what the vehicle actually cost to run, not an
          addition to it — if you claim these miles, the fuel and maintenance
          filed under <span className="figure">vehicle</span> are not also
          deductible. That is why this total is shown on its own rather than
          added to the expenses on Schedule C.
          {currentRate.exact ? null : (
            <>
              {" "}
              The IRS has not published a rate covering today, so the most recent
              one is being carried forward.
            </>
          )}
        </p>
      </Card>

      <Card className="mb-4">
        <h2 className="text-lg">Log a trip</h2>
        <form action={createMileageTripAction} className="mt-3 grid gap-3 sm:grid-cols-4">
          <div>
            <label htmlFor="drove-on" className="mb-1 block text-xs font-medium">Date</label>
            <input id="drove-on" type="date" name="droveOn" defaultValue={today} className="field" />
          </div>
          <div>
            <label htmlFor="miles" className="mb-1 block text-xs font-medium">Miles</label>
            <input id="miles" name="miles" inputMode="decimal" placeholder="12.4" className="field" />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="purpose" className="mb-1 block text-xs font-medium">
              Business purpose
            </label>
            <input id="purpose" name="purpose" placeholder="Client meeting" className="field" />
          </div>
          <div className="sm:col-span-3">
            <label htmlFor="destination" className="mb-1 block text-xs font-medium">
              Destination <span className="text-[var(--color-ink-faint)]">(optional)</span>
            </label>
            <input id="destination" name="destination" placeholder="Denver, CO" className="field" />
          </div>
          <div className="flex items-end">
            <button type="submit" className="btn btn-primary">Add trip</button>
          </div>
        </form>
        <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
          The purpose is required because it is what makes the miles deductible.
          The rate is not asked for: it follows from the date you drove.
        </p>
      </Card>

      <Card>
        <h2 className="text-lg">Trips</h2>
        {trips.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--color-ink-faint)]">
            Nothing logged yet.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--color-border)]">
            {trips.map((t) => {
              const rate = mileageRate(t.droveOn);
              return (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span>
                    <span className="figure">{t.droveOn}</span>
                    <span className="ml-2">{t.purpose}</span>
                    {t.destination ? (
                      <span className="ml-2 text-xs text-[var(--color-ink-faint)]">
                        {t.destination}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-xs text-[var(--color-ink-muted)]">
                      {milesFromTenths(t.milesTenths)} mi × {rate.centsPerMile}¢
                    </span>
                    <span className="figure">
                      {usd(tripDeductionCents(t.milesTenths, t.droveOn))}
                    </span>
                    <form action={deleteMileageTripAction}>
                      <input type="hidden" name="tripId" value={t.id} />
                      <button
                        type="submit"
                        className="text-xs text-[var(--color-ink-faint)] underline underline-offset-4 hover:text-[var(--color-negative)]"
                      >
                        Delete
                      </button>
                    </form>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
