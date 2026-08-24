import { headers } from "next/headers";
import { env } from "@/lib/env";
import { clientAddress, trustedHops } from "./client-address";
import { consume, limitHeaders, type LimitPolicy, type LimitVerdict } from "./rate-limit";

/**
 * Applying a rate limit inside a route handler.
 *
 * The interesting decision here is what to count *against*, not how to count.
 */

let cachedHops: number | null = null;

function hops(): number {
  cachedHops ??= trustedHops(env.TRUST_PROXY_HOPS, Boolean(process.env.VERCEL));
  return cachedHops;
}

/**
 * Bucket an authenticated request.
 *
 * Keyed on the session rather than the address, deliberately. The person who
 * has already proved they own the deployment should not be throttled harder
 * because they are on mobile data behind a carrier NAT, and — more to the
 * point — an unauthenticated stranger must not be able to consume the owner's
 * upload allowance by guessing their IP.
 *
 * This is a ceiling on runaway cost (a script in a retry loop, a stuck client),
 * not an access control. Access control already happened: `guardApi` rejected
 * the request before this runs.
 */
export async function limitSession(
  policy: LimitPolicy,
): Promise<Response | null> {
  const store = await headers();
  const address = clientAddress(store, hops());

  /*
   * A single-user app has one session, so the session cookie is a poor
   * discriminator on its own — but combined with the address it separates the
   * owner's laptop from their phone, and costs nothing when the address is
   * unknown.
   */
  const key = address ?? "session";
  return apply(key, policy);
}

/**
 * Bucket an unauthenticated request by address.
 *
 * Returns a 429 when the address cannot be determined *and* the limit is a
 * credential guard — see `limitCredentialAttempt`. For ordinary limits an
 * unidentifiable caller falls into one shared bucket, which is the honest
 * outcome: the app cannot tell those callers apart, so it cannot give them
 * separate allowances.
 */
export async function limitAddress(
  policy: LimitPolicy,
  request?: Request,
): Promise<Response | null> {
  const store = request ? request.headers : await headers();
  const address = clientAddress(store, hops());
  return apply(address ?? "unidentified", policy);
}

/**
 * Count a failed credential attempt: a wrong bearer token, a wrong cron secret.
 *
 * Called only on failure, so a working integration never touches it however
 * often it polls. Counting successes here would throttle a legitimate MCP
 * client into uselessness for sharing an address with a prober.
 */
export async function limitCredentialAttempt(
  request: Request,
  policy: LimitPolicy,
): Promise<Response | null> {
  const address = clientAddress(request.headers, hops());
  return apply(address ?? "unidentified", policy);
}

/**
 * The same count, without composing the response.
 *
 * For callers that speak a protocol of their own: an MCP client parses every
 * response body as JSON-RPC, so handing it the plain `{error}` shape used
 * elsewhere reads as a malformed reply rather than a rate limit.
 */
export function checkAddress(request: Request, policy: LimitPolicy): LimitVerdict {
  const address = clientAddress(request.headers, hops());
  return consume(address ?? "unidentified", policy);
}

function apply(key: string, policy: LimitPolicy): Response | null {
  const verdict = consume(key, policy);
  if (verdict.allowed) return null;

  return Response.json(
    {
      error: "Too many requests.",
      retryAfter: verdict.retryAfter,
    },
    { status: 429, headers: limitHeaders(verdict) },
  );
}

/** Test seam: the hop count is read once and cached per process. */
export function resetHopCache(): void {
  cachedHops = null;
}
