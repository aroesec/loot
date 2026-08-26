import { guardApi } from "@/lib/auth";
import { ledgerMode } from "@/lib/mode";
import { scheduleC, scheduleCsv } from "@/lib/tax";

/** The year's figures as a spreadsheet, for an accountant or a tax program. */
export async function GET(request: Request) {
  const denied = await guardApi();
  if (denied) return denied;

  if ((await ledgerMode()) !== "business") {
    return Response.json(
      { error: "Schedule C applies to a business ledger." },
      { status: 400 },
    );
  }

  const year = Number(new URL(request.url).searchParams.get("year"));
  if (!Number.isInteger(year) || year < 1990 || year > 2200) {
    return Response.json({ error: "Pass a four-digit year." }, { status: 400 });
  }

  const csv = scheduleCsv(await scheduleC(year));

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="schedule-c-${year}.csv"`,
      // A year of business figures should not sit in a shared cache.
      "cache-control": "no-store",
    },
  });
}
