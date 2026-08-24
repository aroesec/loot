# Security

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private reporting:
[report a vulnerability](https://github.com/aroesec/loot/security/advisories/new).

Include what you did, what happened, and what you expected. A proof of concept
helps. You will get an acknowledgement. This is a small project, so a fix may
take a while.

There is no bug bounty.

## Threat model

Every deployment holds one household's complete financial history: what they
earn, what they spend it on, where they bank, and, if Plaid is connected, a
credential that can read more of it.

Loot is single-tenant and self-hosted. One household, one deployment, one
database. There is no multi-tenancy, so there is no cross-tenant isolation to
break, but equally there is nothing between an authenticated session and the
whole ledger.

In scope:

- authentication bypass, whether by password, OIDC, or the trusted-header proxy
- reading or writing the ledger without a session or a valid MCP token
- disclosure of secrets: Plaid access tokens, MCP tokens, the session secret,
  the database URL
- stored or reflected XSS, CSRF, clickjacking
- SQL injection

Out of scope:

- an attacker who already holds the deployment's `APP_PASSWORD` or a valid MCP
  token, since both grant full access by design
- rate limits being per-instance. They are cost ceilings rather than access
  control, and a serverless deployment multiplies each one by its instance
  count. See [docs/security.md](docs/security.md)
- vulnerabilities in Plaid, Neon, Vercel or any other provider. Report those to
  the provider
- missing hardening on a deployment the operator chose to expose without TLS

## Notes for operators

`TRUST_PROXY_HOPS` decides whether rate limits mean anything. Set it higher than
the number of proxies actually in front of the app and the app starts believing
`X-Forwarded-For` entries the caller wrote, which lets anyone sidestep a limit
or push someone else's bucket into lockout. Leaving it unset is the safe
default.

Plaid access tokens are encrypted rather than hashed, because they have to be
replayed to Plaid. `PLAID_TOKEN_KEY` is what protects them at rest: a database
dump on its own yields no working tokens, a leak of both does. Rotating the key
invalidates every bank connection.

MCP tokens are bearer tokens with full read and write access to the ledger.
They are stored as SHA-256 hashes, shown once at creation, and revocable from
Settings. Treat one like a password.

Deployment protection has to stay off if you use MCP, because MCP clients
cannot complete an SSO flow. The app has its own authentication and the endpoint
requires a bearer token, but it does mean the deployment is reachable from the
internet.

`pnpm db:backup` writes a verified dump. It is plaintext SQL containing
everything, so store it accordingly.
