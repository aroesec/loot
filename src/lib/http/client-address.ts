/**
 * Working out who is calling.
 *
 * Every rate limit in the app is only as good as this function. If the address
 * can be chosen by the caller, a limit keyed on it is decorative: an attacker
 * picks a fresh value per request and never hits a bucket.
 *
 * `X-Forwarded-For` is a *chain*, and it grows left to right as each proxy
 * appends the peer it accepted the connection from:
 *
 *   client → CDN → app     arrives as   `X-Forwarded-For: <client>`
 *   client → nginx → CDN → app          `X-Forwarded-For: <client>, <nginx>`
 *
 * Only the entries a trusted proxy wrote itself mean anything. Everything to
 * the left of those was supplied by whoever connected, so reading the *leftmost*
 * value — the obvious thing, and what this app did — takes a header the caller
 * fully controls. That is worse than having no limit at all, because it also
 * lets someone target a *chosen* address: sending the owner's IP as the first
 * entry drives the owner's login bucket into lockout from anywhere.
 *
 * So the address is counted from the right, and how far in is deployment
 * configuration rather than a guess.
 */

/**
 * How many proxies sit between the internet and this app.
 *
 * 0 means the app is directly reachable, and no forwarding header can be
 * believed at all. 1 is a single CDN or reverse proxy (Vercel, Cloudflare, one
 * nginx). Getting this *too high* is the dangerous direction — it starts
 * trusting entries the caller wrote — so an unset value assumes the safest
 * thing that still works on the platform.
 */
export function trustedHops(envValue: string | undefined, onVercel: boolean): number {
  const parsed = Number(envValue);
  if (envValue !== undefined && envValue !== "" && Number.isInteger(parsed) && parsed >= 0) {
    return parsed;
  }
  /*
   * Vercel terminates every request at its own edge and appends the real peer,
   * so exactly one entry is trustworthy there and a default of 0 would throw
   * away a working limit for every deployment that never sets this.
   *
   * Anywhere else, assume direct exposure. Someone running behind nginx has to
   * say so — the cost of being wrong that way is a weaker limit, while the
   * cost of guessing 1 on a directly-reachable host is a forgeable one.
   */
  return onVercel ? 1 : 0;
}

/** Strip an IPv4 port and IPv6 brackets so the same peer is one bucket. */
function normalize(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;

  if (value.startsWith("[")) {
    // [::1]:1234 → ::1
    const close = value.indexOf("]");
    if (close > 0) value = value.slice(1, close);
  } else if (value.split(":").length === 2) {
    /*
     * `203.0.113.5:1234` → `203.0.113.5`.
     *
     * Keyed on there being exactly *one* colon rather than on the value also
     * containing a dot: `::ffff:203.0.113.5` has both, and testing for their
     * presence truncated it to nothing. An unbracketed address with two or
     * more colons is IPv6 and cannot carry a port.
     */
    value = value.slice(0, value.indexOf(":"));
  }

  value = value.toLowerCase();
  // IPv6-mapped IPv4 arrives both ways depending on the proxy.
  if (value.startsWith("::ffff:")) value = value.slice(7);

  return value || null;
}

/**
 * The caller's address, or null when it cannot be established.
 *
 * Null is a real answer and callers must handle it rather than substituting a
 * constant: bucketing every unidentifiable request together turns a rate limit
 * into a way for a stranger to exhaust the owner's allowance.
 */
export function clientAddress(
  headers: Headers,
  hops: number,
): string | null {
  if (hops <= 0) return null;

  const chain = headers.get("x-forwarded-for");
  if (chain) {
    const parts = chain.split(",").map((p) => p.trim()).filter(Boolean);
    /*
     * The last `hops` entries were written by trusted proxies; the first of
     * those is the address the outermost one saw. A chain shorter than the
     * configured hop count means the request did not arrive the way the
     * deployment says it does, so nothing in it is trustworthy.
     */
    if (parts.length >= hops) return normalize(parts[parts.length - hops]!);
    return null;
  }

  /*
   * `x-real-ip` is single-valued: a proxy sets it to the peer it saw and
   * overwrites anything inbound. Only meaningful when a proxy is trusted at
   * all, and only as a fallback — a chain, where present, carries more.
   */
  const real = headers.get("x-real-ip");
  return real ? normalize(real) : null;
}
