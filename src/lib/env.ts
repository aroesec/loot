import { z } from "zod";

/**
 * Env is validated once at module load. A missing DATABASE_URL or
 * SESSION_SECRET should fail the deploy loudly rather than surface as a
 * confusing runtime error on the first request.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  /*
   * Authentication. At least one method must be configured, checked below.
   *
   * APP_PASSWORD_HASH is the preferred password form — see auth/password.ts.
   * APP_PASSWORD in plaintext still works so existing deployments keep running.
   */
  APP_PASSWORD: z.string().min(1).optional(),
  APP_PASSWORD_HASH: z.string().min(1).optional(),

  /** Bump to revoke every existing session without rotating SESSION_SECRET. */
  SESSION_VERSION: z.string().min(1).optional(),

  /**
   * Shared secret for the scheduled sync endpoint. On Vercel this is sent
   * automatically as a bearer token; elsewhere, whatever calls the endpoint
   * must send it. Without it the endpoint accepts only a signed-in session.
   */
  CRON_SECRET: z.string().min(16).optional(),

  /*
   * How many reverse proxies sit between the internet and this app.
   *
   * Rate limits are keyed on the caller's address, and that address is only
   * knowable from `X-Forwarded-For`, which the caller can write. Entries are
   * therefore counted from the right — the end a trusted proxy appends to — and
   * this says how many of them to believe.
   *
   * 0 (the default off Vercel) means the app is directly reachable and no
   * forwarding header is trusted at all. Behind one nginx, Caddy, Traefik or
   * Cloudflare, set 1. Setting this higher than reality is the harmful
   * direction: it starts trusting entries the caller supplied.
   */
  TRUST_PROXY_HOPS: z.string().optional(),

  /*
   * Web Push (VAPID). Generate with `pnpm push:keys`.
   *
   * The public key is handed to the browser; the private key signs and never
   * leaves the server. Both are required together — a public key alone cannot
   * send, and a private key alone cannot be subscribed to.
   */
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  /** mailto: address the push service can contact. Required by the spec. */
  VAPID_SUBJECT: z.string().min(1).optional(),

  /*
   * SMS via Twilio. All four are required together — a partial configuration
   * would fail at send time, which for an alerting system means finding out
   * during the emergency it was meant to warn about.
   */
  TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
  TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
  /** The Twilio number messages are sent from, in E.164. */
  TWILIO_FROM: z.string().min(1).optional(),
  /** Where alerts go, in E.164 (+15551234567). */
  ALERT_PHONE: z.string().min(1).optional(),

  /** OIDC — any standards-compliant provider. */
  OIDC_ISSUER: z.string().url().optional(),
  OIDC_CLIENT_ID: z.string().min(1).optional(),
  OIDC_CLIENT_SECRET: z.string().min(1).optional(),
  OIDC_SCOPES: z.string().min(1).optional(),
  /** Comma-separated. An empty list denies everyone; see auth/oidc.ts. */
  OIDC_ALLOWED_USERS: z.string().optional(),

  /**
   * Trusted-header auth, for an identity-aware reverse proxy. Only safe when
   * the app is unreachable except through that proxy — see auth/proxy.ts.
   */
  AUTH_PROXY_HEADER: z.string().min(1).optional(),
  AUTH_PROXY_USERS: z.string().min(1).optional(),
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters"),
  LLM_MODEL: z.string().default("claude-opus-5"),

  /*
   * Model configuration. `AI_*` is the current form; ANTHROPIC_API_KEY and
   * LLM_MODEL still work so existing deployments keep running.
   *
   * AI_PROVIDER="anthropic"  — Claude (default, and the only one that reads PDFs)
   * AI_PROVIDER="openai"     — anything speaking /v1/chat/completions:
   *                            OpenAI, OpenRouter, Groq, Together, Ollama,
   *                            LM Studio, vLLM. Set AI_BASE_URL to point at it.
   * unset                     — rules-only classification, CSV import only
   */
  AI_PROVIDER: z.enum(["anthropic", "openai"]).optional(),
  AI_API_KEY: z.string().min(1).optional(),
  AI_BASE_URL: z.string().url().optional(),
  AI_MODEL: z.string().min(1).optional(),
  PLAID_CLIENT_ID: z.string().min(1).optional(),
  PLAID_SECRET: z.string().min(1).optional(),
  PLAID_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  /**
   * Encrypts Plaid access tokens at rest. Separate from SESSION_SECRET
   * because it is a different blast radius: a session secret forges a login to
   * an app behind a password, while this one decrypts long-lived read access
   * to bank accounts. Rotating one should not force rotating the other.
   */
  PLAID_TOKEN_KEY: z
    .string()
    .min(32, "PLAID_TOKEN_KEY must be at least 32 characters")
    .optional(),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

function load() {
  /*
   * An unset variable in a `.env` file is usually an empty string, not an
   * absent key — `.env.example` ships every optional variable as `NAME=""` so
   * people can see what exists. Zod treats "" as present, so `.optional()`
   * does not apply and a `.min(1)` rejects it.
   *
   * Following the README exactly therefore produced a build that refused to
   * start, because `APP_PASSWORD_HASH=""` failed validation. Normalizing here,
   * once, is what makes the documented setup work — and is more reliable than
   * remembering `|| undefined` on every line.
   */
  const raw: Record<string, string | undefined> = {
    DATABASE_URL: process.env.DATABASE_URL,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    APP_PASSWORD: process.env.APP_PASSWORD,
    APP_PASSWORD_HASH: process.env.APP_PASSWORD_HASH,
    SESSION_VERSION: process.env.SESSION_VERSION,
    CRON_SECRET: process.env.CRON_SECRET,
    TRUST_PROXY_HOPS: process.env.TRUST_PROXY_HOPS,
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT,
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
    TWILIO_FROM: process.env.TWILIO_FROM,
    ALERT_PHONE: process.env.ALERT_PHONE,
    OIDC_ISSUER: process.env.OIDC_ISSUER,
    OIDC_CLIENT_ID: process.env.OIDC_CLIENT_ID,
    OIDC_CLIENT_SECRET: process.env.OIDC_CLIENT_SECRET,
    OIDC_SCOPES: process.env.OIDC_SCOPES,
    OIDC_ALLOWED_USERS: process.env.OIDC_ALLOWED_USERS,
    AUTH_PROXY_HEADER: process.env.AUTH_PROXY_HEADER,
    AUTH_PROXY_USERS: process.env.AUTH_PROXY_USERS,
    SESSION_SECRET: process.env.SESSION_SECRET,
    LLM_MODEL: process.env.LLM_MODEL,
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_API_KEY: process.env.AI_API_KEY,
    AI_BASE_URL: process.env.AI_BASE_URL,
    AI_MODEL: process.env.AI_MODEL,
    PLAID_CLIENT_ID: process.env.PLAID_CLIENT_ID,
    PLAID_SECRET: process.env.PLAID_SECRET,
    PLAID_ENV: process.env.PLAID_ENV,
    PLAID_TOKEN_KEY: process.env.PLAID_TOKEN_KEY,
    NODE_ENV: process.env.NODE_ENV,
  };

  for (const key of Object.keys(raw)) {
    if (raw[key] === "") raw[key] = undefined;
  }

  const parsed = schema.safeParse(raw);

  if (parsed.success) {
    const d = parsed.data;
    /*
     * At least one way in. Starting with no auth configured would serve the
     * whole ledger to anyone who finds the URL, and failing at boot is far
     * better than discovering it later.
     */
    const hasAuth =
      d.APP_PASSWORD ||
      d.APP_PASSWORD_HASH ||
      (d.OIDC_ISSUER && d.OIDC_CLIENT_ID && d.OIDC_CLIENT_SECRET) ||
      (d.AUTH_PROXY_HEADER && d.AUTH_PROXY_USERS);

    if (!hasAuth) {
      throw new Error(
        "No authentication is configured. Set APP_PASSWORD_HASH (or APP_PASSWORD), " +
          "or OIDC_ISSUER + OIDC_CLIENT_ID + OIDC_CLIENT_SECRET, " +
          "or AUTH_PROXY_HEADER + AUTH_PROXY_USERS.",
      );
    }
  }

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return parsed.data;
}

export const env = load();

/**
 * Model-backed features degrade to rules-only rather than erroring without a
 * key. Either variable enables them; see `src/lib/ai` for provider selection.
 */
export const hasLlm = Boolean(env.AI_API_KEY || env.ANTHROPIC_API_KEY);

/**
 * Bank syncing is off until all three are set, so the app runs exactly as it
 * did on CSV uploads alone. All three are required together — credentials
 * without the encryption key would mean storing access tokens in the clear.
 */
/** SMS is off unless the provider and destination are both set. */
export const hasSms = Boolean(
  env.TWILIO_ACCOUNT_SID &&
    env.TWILIO_AUTH_TOKEN &&
    env.TWILIO_FROM &&
    env.ALERT_PHONE,
);

/** Push is off unless both keys are present. */
export const hasPush = Boolean(
  env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY,
);

export const hasPlaid = Boolean(
  env.PLAID_CLIENT_ID && env.PLAID_SECRET && env.PLAID_TOKEN_KEY,
);
