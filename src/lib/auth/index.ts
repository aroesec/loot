import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { safeEqual, verifyAgainstHash } from "./password";
import { identityFromHeaders, proxyAuthEnabled } from "./proxy";
import { checkRateLimit, clearRateLimit, recordFailure } from "./rate-limit";

export * from "./password";
export * from "./proxy";
export * from "./rate-limit";
export { oidcEnabled, beginAuth, completeAuth, isAllowed } from "./oidc";

/**
 * One deployment, one owner, three ways to prove it:
 *
 *   password  — the default. Hashed where APP_PASSWORD_HASH is set.
 *   oidc      — any standards-compliant provider, for people who already have one.
 *   proxy     — a trusted header from an identity-aware reverse proxy.
 *
 * All three converge on the same signed session cookie, so everything
 * downstream — pages, API routes, MCP — is unchanged by which was used.
 *
 * The schema is keyed so a real multi-user layer could be added later, but
 * there is no point carrying user tables for an app with one user.
 */

const COOKIE_NAME = "loot_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const secret = new TextEncoder().encode(env.SESSION_SECRET);

/**
 * Bumping this invalidates every existing session without rotating
 * SESSION_SECRET, which would also break anything else signed with it.
 * Changing the password does not log other devices out on its own — that is
 * usually correct for a forgotten password and wrong for a leaked one, so it
 * is a separate lever.
 */
const SESSION_VERSION = env.SESSION_VERSION ?? "1";

export type AuthMethod = "password" | "oidc" | "proxy";

/** Which methods this deployment actually offers, for the login page. */
export function availableMethods(): AuthMethod[] {
  const methods: AuthMethod[] = [];
  if (env.APP_PASSWORD_HASH || env.APP_PASSWORD) methods.push("password");
  if (env.OIDC_ISSUER && env.OIDC_CLIENT_ID) methods.push("oidc");
  if (proxyAuthEnabled()) methods.push("proxy");
  return methods;
}

export async function verifyPassword(input: string): Promise<boolean> {
  if (env.APP_PASSWORD_HASH) {
    return verifyAgainstHash(input, env.APP_PASSWORD_HASH);
  }
  if (env.APP_PASSWORD) {
    return safeEqual(input, env.APP_PASSWORD);
  }
  return false;
}

/**
 * A login attempt, throttled. The key is the client address when one is
 * available, so one browser grinding guesses cannot lock out another — and a
 * shared fallback key still bounds the total rate when it is not.
 */
export async function attemptPasswordLogin(
  input: string,
  clientKey: string,
): Promise<{ ok: boolean; retryAfter: number }> {
  const limit = checkRateLimit(clientKey);
  if (!limit.allowed) return { ok: false, retryAfter: limit.retryAfter };

  if (await verifyPassword(input)) {
    clearRateLimit(clientKey);
    await createSession("owner");
    return { ok: true, retryAfter: 0 };
  }

  recordFailure(clientKey);
  return { ok: false, retryAfter: 0 };
}

export async function createSession(subject = "owner"): Promise<void> {
  const token = await new SignJWT({ sub: subject, v: SESSION_VERSION })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret);

  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Lax rather than strict: the OIDC provider redirects back with a
    // top-level GET, and strict would drop the cookie on arrival.
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export async function isAuthenticated(): Promise<boolean> {
  /*
   * Proxy identity is checked first and needs no cookie: the proxy is the
   * session. Requiring a login on top would be asking the user to authenticate
   * twice to the same deployment.
   */
  if (proxyAuthEnabled()) {
    const h = await headers();
    if (identityFromHeaders(h)) return true;
  }

  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return false;

  try {
    const { payload } = await jwtVerify(token, secret);
    // A version bump revokes every session issued before it.
    return (payload.v ?? "1") === SESSION_VERSION;
  } catch {
    return false;
  }
}

/** Use at the top of every protected page. */
export async function requireAuth(): Promise<void> {
  if (!(await isAuthenticated())) redirect("/login");
}

/** Use in route handlers; returns a 401 response when not signed in. */
export async function guardApi(): Promise<Response | null> {
  if (await isAuthenticated()) return null;
  return Response.json({ error: "Not signed in" }, { status: 401 });
}
