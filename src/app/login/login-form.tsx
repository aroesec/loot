"use client";

import { useActionState } from "react";
import { loginAction } from "../actions";

const ERROR_COPY: Record<string, string> = {
  state: "That sign-in attempt expired or did not come from this browser. Try again.",
  forbidden: "That account is not permitted to sign in to this deployment.",
  oidc: "The identity provider could not complete sign-in.",
};

export function LoginForm({
  showPassword,
  showOidc,
  oidcLabel,
  urlError,
}: {
  showPassword: boolean;
  showOidc: boolean;
  oidcLabel: string;
  urlError?: string;
}) {
  const [state, formAction, pending] = useActionState(loginAction, null);
  const error = state?.error ?? (urlError ? ERROR_COPY[urlError] : undefined);

  return (
    <div className="card p-6">
      {showPassword ? (
        <form action={formAction}>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoFocus
            autoComplete="current-password"
            className="field"
            aria-describedby={error ? "login-error" : undefined}
          />
          <button
            type="submit"
            className="btn btn-primary mt-4 w-full"
            disabled={pending}
          >
            {pending ? "Checking…" : "Sign in"}
          </button>
        </form>
      ) : null}

      {showPassword && showOidc ? (
        <div className="my-4 flex items-center gap-3 text-xs text-[var(--color-ink-muted)]">
          <span className="h-px flex-1 bg-[var(--color-border)]" />
          or
          <span className="h-px flex-1 bg-[var(--color-border)]" />
        </div>
      ) : null}

      {showOidc ? (
        <a
          href="/api/auth/oidc/start"
          className={`btn w-full justify-center ${showPassword ? "" : "btn-primary"}`}
        >
          Continue with {oidcLabel}
        </a>
      ) : null}

      {error ? (
        <p id="login-error" role="alert" className="mt-3 text-sm text-negative">
          {error}
        </p>
      ) : null}
    </div>
  );
}
