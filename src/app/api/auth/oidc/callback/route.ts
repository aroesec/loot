import { cookies } from "next/headers";
import { completeAuth, createSession, isAllowed, oidcEnabled } from "@/lib/auth";

export async function GET(request: Request) {
  if (!oidcEnabled()) {
    return Response.redirect(new URL("/login?error=oidc", request.url), 302);
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const jar = await cookies();
  const expectedState = jar.get("oidc_state")?.value;
  const verifier = jar.get("oidc_verifier")?.value;

  jar.delete("oidc_state");
  jar.delete("oidc_verifier");

  /*
   * State must match the cookie this browser was given. Without the check, an
   * attacker can complete a login as themselves in someone else's browser and
   * have that person's subsequent activity land in the attacker's account.
   */
  if (!code || !state || !expectedState || state !== expectedState || !verifier) {
    return Response.redirect(new URL("/login?error=state", request.url), 302);
  }

  try {
    const { identity } = await completeAuth({
      code,
      verifier,
      redirectUri: new URL("/api/auth/oidc/callback", request.url).toString(),
    });

    // A verified identity is not automatically an authorized one.
    if (!isAllowed(identity)) {
      console.warn(`oidc: rejected identity "${identity}" (not in OIDC_ALLOWED_USERS)`);
      return Response.redirect(new URL("/login?error=forbidden", request.url), 302);
    }

    await createSession(identity);
    return Response.redirect(new URL("/", request.url), 302);
  } catch (err) {
    console.error("oidc callback failed", err);
    return Response.redirect(new URL("/login?error=oidc", request.url), 302);
  }
}
