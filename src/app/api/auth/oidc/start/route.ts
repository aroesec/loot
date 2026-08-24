import { cookies } from "next/headers";
import { beginAuth, oidcEnabled } from "@/lib/auth";

/** Kicks off the authorization-code flow and parks state + verifier. */
export async function GET(request: Request) {
  if (!oidcEnabled()) {
    return Response.json({ error: "OIDC is not configured." }, { status: 400 });
  }

  const redirectUri = new URL("/api/auth/oidc/callback", request.url).toString();

  try {
    const { state, verifier, url } = await beginAuth(redirectUri);

    const jar = await cookies();
    const opts = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/",
      // Only has to survive the round trip to the provider.
      maxAge: 600,
    };
    // The verifier stays server-side in the sense that matters: the browser
    // holds it but never sends it to the provider, so an intercepted code
    // cannot be redeemed by whoever intercepted it.
    jar.set("oidc_state", state, opts);
    jar.set("oidc_verifier", verifier, opts);

    return Response.redirect(url, 302);
  } catch (err) {
    console.error("oidc start failed", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not start sign-in." },
      { status: 502 },
    );
  }
}
