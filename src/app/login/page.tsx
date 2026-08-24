import { availableMethods } from "@/lib/auth";
import { env } from "@/lib/env";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

/**
 * Only the methods this deployment actually configured are offered. Showing a
 * password box on an OIDC-only install would be an invitation to guess at a
 * credential that does not exist.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const methods = availableMethods();

  // A friendlier label than the raw issuer URL, derived from its host.
  const oidcLabel = env.OIDC_ISSUER
    ? new URL(env.OIDC_ISSUER).hostname.replace(/^(www|auth|login|id)\./, "")
    : "SSO";

  return (
    <div className="flex min-h-screen items-center justify-center px-5">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-4xl">Loot</h1>
          <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
            Your ledger, your categories, your year.
          </p>
        </div>

        <LoginForm
          showPassword={methods.includes("password")}
          showOidc={methods.includes("oidc")}
          oidcLabel={oidcLabel}
          {...(params.error ? { urlError: params.error } : {})}
        />
      </div>
    </div>
  );
}
