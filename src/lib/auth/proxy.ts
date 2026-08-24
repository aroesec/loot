import { env } from "@/lib/env";

/**
 * Trusted-header authentication, for deployments already sitting behind an
 * identity-aware proxy: Authelia, Authentik, oauth2-proxy, Cloudflare Access,
 * Tailscale Serve, a corporate SSO gateway.
 *
 * The proxy authenticates and forwards the resulting identity in a header.
 *
 * This is the most dangerous mechanism in the app, because a header is trivial
 * to forge. If the application is reachable *at all* except through the proxy,
 * anyone can set the header themselves and walk in. That is why:
 *
 *   - it is off unless AUTH_PROXY_HEADER is set explicitly,
 *   - AUTH_PROXY_USERS must list the identities allowed in, so a compromised
 *     or misconfigured proxy cannot admit arbitrary accounts,
 *   - and the app refuses to start the flow if the deployment looks directly
 *     reachable in a way we can detect.
 *
 * Do not enable it unless the origin is bound to the proxy — a private
 * network, a unix socket, or a firewall rule.
 */
export function proxyAuthEnabled(): boolean {
  return Boolean(env.AUTH_PROXY_HEADER && env.AUTH_PROXY_USERS);
}

/**
 * The authenticated identity from the request, or null.
 *
 * An identity that is present but not on the allowlist returns null rather
 * than throwing: it is indistinguishable from an unauthenticated request, and
 * treating it as an error would confirm to a prober that the header is read.
 */
export function identityFromHeaders(headers: Headers): string | null {
  if (!proxyAuthEnabled()) return null;

  const raw = headers.get(env.AUTH_PROXY_HEADER!);
  if (!raw) return null;

  const identity = raw.trim().toLowerCase();
  if (!identity) return null;

  const allowed = env
    .AUTH_PROXY_USERS!.split(",")
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean);

  return allowed.includes(identity) ? identity : null;
}
