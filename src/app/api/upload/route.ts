import { limitSession } from "@/lib/http/guard";
import { POLICIES } from "@/lib/http/rate-limit";
import { guardApi } from "@/lib/auth";
import { ingestStatement, IngestError } from "@/lib/ingest";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { eq, isNull, sql } from "drizzle-orm";

/** PDF extraction on a long statement can take a while. */
export const maxDuration = 300;

const MAX_BYTES = 12 * 1024 * 1024;

export async function POST(request: Request) {
  const denied = await guardApi();
  if (denied) return denied;

  // A ceiling on cost, not on access: each import runs a classification pass
  // over every new row.
  const limited = await limitSession(POLICIES.upload);
  if (limited) return limited;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      { error: "Could not read the upload." },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "No file was attached." }, { status: 400 });
  }

  if (file.size === 0) {
    return Response.json({ error: "That file is empty." }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return Response.json(
      {
        error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 12 MB — split the statement or export a CSV.`,
      },
      { status: 413 },
    );
  }

  const rawAccountId = String(form.get("accountId") ?? "").trim();
  let accountId: string | null = null;
  if (rawAccountId) {
    const found = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, rawAccountId))
      .limit(1);
    if (!found[0]) {
      return Response.json(
        { error: "That account no longer exists." },
        { status: 400 },
      );
    }
    accountId = found[0].id;
  }

  /*
   * Once there is more than one account, an unfiled statement is unsafe rather
   * than merely untidy. `dedupe_hash` includes the account, so everything
   * imported without one shares a single "no-account" namespace: a $5.00
   * Starbucks charged to a card on the same day as a $5.00 Starbucks on
   * checking hashes identically, and the second is dropped as a duplicate with
   * no error. A CSV cannot say which account it belongs to, so this is the
   * only place to catch it.
   */
  if (!accountId) {
    const open = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(accounts)
      .where(isNull(accounts.archivedAt));

    if ((open[0]?.count ?? 0) > 1) {
      return Response.json(
        {
          error:
            "Choose which account this statement belongs to. With more than one account open, an unfiled import can collide with an identical charge on another account and be dropped as a duplicate.",
        },
        { status: 400 },
      );
    }
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  try {
    const result = await ingestStatement({
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      bytes,
      accountId,
      useLlm: form.get("useLlm") !== "false",
    });
    return Response.json(result);
  } catch (err) {
    if (err instanceof IngestError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("upload failed", err);
    return Response.json(
      { error: "Something went wrong importing that file." },
      { status: 500 },
    );
  }
}
