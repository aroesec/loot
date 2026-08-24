import { createRemoteJWKSet, jwtVerify } from "jose";
import { createHash, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Generic OIDC, so any standards-compliant provider works: Google, GitHub via
 * an OIDC shim, Authentik, Keycloak, Zitadel, Okta, Auth0, Pocket ID.
 *
 * Written against the spec rather than pulling in an auth framework, because
 * the framework would bring a user model this app does not have. What is here
 * is the authorization-code flow with PKCE and nothing else.
 *
 * Three things are load-bearing and easy to skip:
 *
 *   PKCE — the code verifier never leaves this server, so an intercepted
 *   authorization code cannot be redeemed by whoever intercepted it.
 *
 *   State — bound to the browser in a cookie and checked on return. Without it
 *   an attacker can complete a login *as themselves* in someone else's browser.
 *
 *   ID token verification against the provider's JWKS. The token is the whole
 *   proof of identity; accepting it unverified accepts anything.
 */

export type OidcConfig = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
};

let discovered: OidcConfig | null = null;

export function oidcEnabled(): boolean {
  return Boolean(env.OIDC_ISSUER && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET);
}

/** Discovery, memoized. Endpoints do not move between requests. */
export async function discover(): Promise<OidcConfig> {
  if (discovered) return discovered;

  const base = env.OIDC_ISSUER!.replace(/\/+$/, "");
  const res = await fetch(`${base}/.well-known/openid-configuration`);
  if (!res.ok) {
    throw new Error(
      `OIDC discovery failed at ${base}: ${res.status}. Check OIDC_ISSUER.`,
    );
  }

  const doc = (await res.json()) as {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    jwks_uri: string;
  };

  discovered = {
    issuer: doc.issuer,
    authorizationEndpoint: doc.authorization_endpoint,
    tokenEndpoint: doc.token_endpoint,
    jwksUri: doc.jwks_uri,
  };
  return discovered;
}

export type PendingAuth = { state: string; verifier: string; url: string };

export async function beginAuth(redirectUri: string): Promise<PendingAuth> {
  const config = await discover();

  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(64).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  const url = new URL(config.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.OIDC_CLIENT_ID!);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", env.OIDC_SCOPES || "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");

  return { state, verifier, url: url.toString() };
}

/**
 * Exchange the code and verify the ID token. Returns the subject's email or
 * subject id, which is then matched against OIDC_ALLOWED_USERS.
 */
export async function completeAuth(input: {
  code: string;
  verifier: string;
  redirectUri: string;
}): Promise<{ identity: string; email: string | null }> {
  const config = await discover();

  const res = await fetch(config.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: env.OIDC_CLIENT_ID!,
      client_secret: env.OIDC_CLIENT_SECRET!,
      code_verifier: input.verifier,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Token exchange failed: ${res.status} ${body.slice(0, 200)}`);
  }

  const tokens = (await res.json()) as { id_token?: string };
  if (!tokens.id_token) {
    throw new Error("The provider returned no ID token.");
  }

  // Verified against the provider's published keys, with issuer and audience
  // checked. An unverified ID token proves nothing at all.
  const jwks = createRemoteJWKSet(new URL(config.jwksUri));
  const { payload } = await jwtVerify(tokens.id_token, jwks, {
    issuer: config.issuer,
    audience: env.OIDC_CLIENT_ID!,
  });

  const email = typeof payload.email === "string" ? payload.email : null;
  const identity = (email ?? String(payload.sub ?? "")).toLowerCase();
  if (!identity) throw new Error("The ID token carried no usable identity.");

  return { identity, email };
}

/**
 * Whether this identity may sign in.
 *
 * An empty allowlist denies everyone rather than admitting everyone. On a
 * personal deployment behind a public provider like Google, "no allowlist"
 * would otherwise mean "anyone with a Google account owns your finances".
 */
export function isAllowed(identity: string): boolean {
  const allowed = (env.OIDC_ALLOWED_USERS ?? "")
    .split(",")
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return false;
  return allowed.includes(identity.toLowerCase());
}
