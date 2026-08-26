import { guardApi } from "@/lib/auth";
import { limitSession } from "@/lib/http/guard";
import { POLICIES } from "@/lib/http/rate-limit";
import { exportBundle, transactionsCsv } from "@/lib/export";

/** A whole ledger is a large response; give it room. */
export const maxDuration = 120;

export async function GET(request: Request) {
  const denied = await guardApi();
  if (denied) return denied;

  // Reads and serializes the entire ledger, so it belongs behind the same kind
  // of ceiling as an import rather than being free to call in a loop.
  const limited = await limitSession(POLICIES.export);
  if (limited) return limited;

  const format = new URL(request.url).searchParams.get("format") ?? "csv";
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "json") {
    return new Response(JSON.stringify(await exportBundle(), null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="loot-export-${stamp}.json"`,
        "cache-control": "no-store",
      },
    });
  }

  if (format !== "csv") {
    return Response.json(
      { error: "format must be csv or json." },
      { status: 400 },
    );
  }

  return new Response(await transactionsCsv(), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="loot-transactions-${stamp}.csv"`,
      // A full ledger must never sit in a shared cache.
      "cache-control": "no-store",
    },
  });
}
