import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import { env, hasPlaid } from "@/lib/env";

/**
 * Sandbox by default. Plaid's free Trial plan counts Production Items on a
 * lifetime basis — deleting one does not give the quota back — so iterating on
 * the Link flow against Production would permanently burn the allowance. Build
 * in sandbox, switch PLAID_ENV to production once the flow works.
 */
export function plaidClient(): PlaidApi {
  if (!hasPlaid) {
    throw new Error(
      "Bank syncing is not configured. Set PLAID_CLIENT_ID, PLAID_SECRET and PLAID_TOKEN_KEY.",
    );
  }

  return new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[env.PLAID_ENV],
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": env.PLAID_CLIENT_ID,
          "PLAID-SECRET": env.PLAID_SECRET,
        },
      },
    }),
  );
}

/** Plaid puts the useful part in the response body, not the HTTP error. */
export function plaidErrorMessage(err: unknown): string {
  const body = (err as { response?: { data?: unknown } })?.response?.data as
    | { error_code?: string; error_message?: string; display_message?: string }
    | undefined;
  if (body?.display_message) return body.display_message;
  if (body?.error_message) {
    return body.error_code
      ? `${body.error_message} (${body.error_code})`
      : body.error_message;
  }
  return err instanceof Error ? err.message : String(err);
}

export function plaidErrorCode(err: unknown): string | null {
  const body = (err as { response?: { data?: unknown } })?.response?.data as
    | { error_code?: string }
    | undefined;
  return body?.error_code ?? null;
}
