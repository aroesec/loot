import { NextResponse, type NextRequest } from "next/server";

/**
 * Security headers.
 *
 * This app renders financial data and holds credentials for reading more of
 * it, so the headers are set restrictively and loosened only where something
 * actually needs it. `frame-ancestors 'none'` matters most: it stops the whole
 * UI being framed by another origin and clickjacked into issuing an MCP token
 * or deleting a rule.
 *
 * Plaid Link is the one exception — it opens an iframe and a popup on Plaid's
 * domains, so those are allowed explicitly rather than by relaxing the policy.
 */
const CSP = [
  "default-src 'self'",
  // Next.js inlines a bootstrap script; 'unsafe-inline' is required for it.
  "script-src 'self' 'unsafe-inline' https://cdn.plaid.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.plaid.com",
  "font-src 'self' data:",
  "connect-src 'self' https://*.plaid.com",
  "frame-src https://cdn.plaid.com https://*.plaid.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  response.headers.set("Content-Security-Policy", CSP);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );

  // Only meaningful over TLS, and setting it in dev would pin localhost to
  // HTTPS in the browser's HSTS store.
  if (process.env.NODE_ENV === "production") {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets, which need no policy and are hot paths.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
