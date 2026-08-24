import { limitSession } from "@/lib/http/guard";
import { POLICIES } from "@/lib/http/rate-limit";
import { guardApi } from "@/lib/auth";
import { hasPlaid } from "@/lib/env";
import { exchangePublicToken } from "@/lib/plaid/link";
import { syncItem } from "@/lib/plaid/sync";
import { plaidErrorMessage } from "@/lib/plaid/client";

/** Link succeeded in the browser; turn its public token into a stored Item. */
export async function POST(request: Request) {
  const denied = await guardApi();
  if (denied) return denied;

  // Precedes every connection attempt.
  const limited = await limitSession(POLICIES.plaidLink);
  if (limited) return limited;
  if (!hasPlaid) {
    return Response.json({ error: "Bank syncing is not configured." }, { status: 400 });
  }

  try {
    const body = (await request.json()) as { publicToken?: string };
    if (!body.publicToken) {
      return Response.json({ error: "No public token was sent." }, { status: 400 });
    }

    const result = await exchangePublicToken(body.publicToken);
    // Pull straight away so linking produces something visible.
    const sync = await syncItem(result.itemRowId);

    return Response.json({ ...result, sync });
  } catch (err) {
    console.error("plaid exchange failed", err);
    return Response.json({ error: plaidErrorMessage(err) }, { status: 502 });
  }
}
