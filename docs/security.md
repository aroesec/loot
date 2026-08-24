# Security

What this protects, how, and what it does not.

---

## The threat model

Loot is a single-owner app holding transaction history and, optionally,
long-lived read access to bank accounts. The realistic threats, in the order
they deserve attention:

1. **Someone finds the URL.** The app is on the internet; an unauthenticated
   visitor must get nothing.
2. **The database leaks.** A stolen dump, a misconfigured backup, a shared
   snapshot.
3. **Credentials leak from the environment.** A pasted `printenv`, a CI log, a
   screen share.
4. **A malicious page in the owner's browser** tries to act as them.

Explicitly **not** in the model: an attacker with the running environment. Once
someone can read your process environment, they have the decryption keys and
nothing at this layer helps.

## Authentication

At least one method must be configured — **the app refuses to start
otherwise**, rather than serving a ledger to anyone who finds it.

**Password.** Prefer `APP_PASSWORD_HASH` (`pnpm auth:hash`), a scrypt digest
with a per-password salt. The environment then holds a verifier rather than the
credential, which is what makes threat 3 survivable. Plaintext `APP_PASSWORD`
still works and is compared in constant time — a supported downgrade, not the
recommendation.

**OIDC.** Authorization-code flow with PKCE. Three things are load-bearing:
the code verifier means an intercepted code cannot be redeemed by whoever
intercepted it; the state parameter is bound to a cookie so an attacker cannot
complete a login *as themselves* in your browser; and the ID token is verified
against the provider's JWKS with issuer and audience checked.

`OIDC_ALLOWED_USERS` is required. **An empty allowlist denies everyone**,
deliberately — behind a public provider, the alternative default would mean
anyone with an account there owns your finances.

**Trusted header.** The most dangerous option, and off unless explicitly
configured. A header is trivial to forge, so it is only safe when the app is
unreachable except through the proxy. The allowlist is required so a
misconfigured proxy cannot admit arbitrary identities.

## Sessions

Signed JWTs (HS256) in an `httpOnly`, `secure`, `sameSite=lax` cookie, 30-day
expiry. `lax` rather than `strict` because the OIDC provider returns via a
top-level GET that `strict` would drop.

Bump `SESSION_VERSION` to **revoke every existing session** without rotating
`SESSION_SECRET`, which would invalidate other things signed with it. Changing
your password does not log other devices out on its own — correct for a
forgotten password, wrong for a leaked one, so it is a separate lever you pull
deliberately.

## Rate limiting

Login attempts are throttled per client address: eight failures in fifteen
minutes triggers a fifteen-minute lockout. Keyed by address so one browser
cannot lock out another; a missing address falls back to a shared key that
still bounds the overall rate.

In-process, therefore per-instance. On a serverless deployment with many cold
instances this is weaker, which is exactly why the password is also hashed and
compared in constant time. Defence in depth, not a single wall.

## Secrets at rest

**Plaid access tokens** are AES-256-GCM encrypted with a key derived from
`PLAID_TOKEN_KEY`, with a fresh IV per token — IV reuse under GCM is a total
break. Tampering fails authentication rather than decrypting to garbage. This
is what makes threat 2 survivable: a leaked `plaid_items` row is useless
without the key.

They are encrypted rather than hashed because they must be replayed to Plaid on
every sync. **MCP tokens** are the opposite case — only ever verified, so they
are stored as SHA-256 digests and cannot be recovered even by the app.

Rotating `PLAID_TOKEN_KEY` invalidates every bank connection; they have to be
re-linked.

## Browser hardening

Security headers are set in middleware:

- `Content-Security-Policy` with `frame-ancestors 'none'` — the one that
  matters most, stopping the UI being framed and clickjacked into issuing an
  MCP token or deleting a rule. Plaid's domains are allowed explicitly rather
  than by relaxing the policy.
- `Strict-Transport-Security` in production only, so localhost is not pinned to
  HTTPS in your browser's HSTS store.
- `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy: no-referrer`,
  and a restrictive `Permissions-Policy`.

Server actions carry Next.js's built-in CSRF protection; the OIDC flow adds its
own state check.

## The MCP endpoint

Bearer tokens, stored as SHA-256 digests in `mcp_tokens`, shown once at
creation. The endpoint is stateless and separate from the session cookie, so a
token grants API access without a browser session.

**There is no delete tool.** Fourteen tools read, log and correct. A misheard
instruction must not be able to destroy a record.

Revoke a token from Settings; it stops working immediately.

## What you are responsible for

- **Backups.** Nothing here backs up your database.
- **TLS.** Vercel gives it to you; a self-host behind your own proxy does not.
- **Key storage.** `SESSION_SECRET` and `PLAID_TOKEN_KEY` are not recoverable.
  Losing the latter means re-linking every bank.
- **Who you share the deployment with.** There is one owner. Sharing the
  password shares everything.

## Reporting a vulnerability

Open a private security advisory on the repository rather than a public issue.

## Rate limiting and proxies

The API routes are rate limited in-process. No Redis, no KV store, nothing
extra to run. Limits are ceilings on cost and abuse (a CSV import runs a
classification pass; a Plaid sync is billed), not access control, which has
already happened by the time they run.

Limits key on the caller's address, and that address comes from
`X-Forwarded-For`. A header the caller writes. Proxies **append** to that
chain rather than replacing it, so entries are counted from the right and
`TRUST_PROXY_HOPS` says how many a trusted proxy wrote:

| Deployment | `TRUST_PROXY_HOPS` |
|---|---|
| Vercel | unset (defaults to 1) |
| Behind one nginx / Caddy / Traefik / Cloudflare | `1` |
| Directly exposed | unset (defaults to 0. No header is believed) |

Setting this **higher than reality is the harmful direction**: the app starts
believing entries the caller supplied, and anyone can then evade a limit by
varying them, or drive someone else's bucket into lockout by naming their
address.

Being in-process means limits are per instance, so a serverless deployment
spread over N warm instances effectively multiplies each one by N. That is
accepted. The numbers are low enough to bound the damage even
multiplied, and the things that actually protect a secret (hashed passwords and
MCP tokens, constant-time comparison) do not depend on this.
