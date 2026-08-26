# Deploying

Two paths. Neither is the "real" one — pick by whether you want to run a
server.

---

## Docker Compose

App plus Postgres, nothing else required.

```bash
git clone https://github.com/YOUR-USERNAME/loot && cd loot
cp .env.example .env
```

Set three values in `.env`:

```bash
SESSION_SECRET="..."          # node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
APP_PASSWORD_HASH="..."       # pnpm auth:hash 'your password'
POSTGRES_PASSWORD="..."       # anything; only reachable inside the compose network
```

Then:

```bash
docker compose up -d
```

The entrypoint runs migrations and seeds the taxonomy before serving, both
idempotent, so restarts and upgrades apply their own schema changes.

Two deliberate choices in `docker-compose.yml`:

**Postgres is not published to the host.** The app reaches it over the compose
network. A database holding every transaction you have made should not be
listening on `5432` by default. Add a `ports` mapping if you need direct
access, and understand what you are exposing.

**The app runs as an unprivileged user.** The process holds database
credentials and, if you enable syncing, bank access tokens.

### Upgrading

```bash
git pull && docker compose up -d --build
```

### Backups

`docker compose exec db pg_dump -U loot loot > backup.sql`. Nothing
in the app does this for you.

---

## Vercel + Neon

No server to run, and both free tiers are sufficient for one person.

1. Create a Postgres database at [neon.tech](https://neon.tech) and copy the
   connection string.

2. Deploy:

   ```bash
   npx vercel
   ```

3. Set the environment variables, marking every secret **Sensitive**:

   ```bash
   npx vercel env add DATABASE_URL production
   npx vercel env add SESSION_SECRET production --sensitive
   npx vercel env add APP_PASSWORD_HASH production --sensitive
   ```

4. Run migrations against the database from your machine — they do not run on
   Vercel:

   ```bash
   pnpm db:migrate && pnpm db:seed
   ```

5. `npx vercel --prod`

**If you use the MCP server, Vercel's SSO deployment protection has to stay
off.** MCP clients cannot complete an SSO flow, so it makes `/api/mcp`
unreachable. The app has its own auth and the endpoint requires a bearer token.

Note that `vercel env pull` returns `[SENSITIVE]` rather than the value for
variables marked sensitive, so they cannot be round-tripped back out. Keep them
in a password manager.

### Schema and code deploy separately

`db:migrate` runs from your machine while code deploys separately, so a live
deployment can briefly run old code against a new schema. Migrations here are
additive, which makes that window safe — but deploy right after changing
classifier behaviour, not eventually. The failure mode is subtle: the running
app writes classification rules using superseded logic.

---

## Scheduled sync

A daily sync keeps the ledger no more than a day stale and lets pending charges
update as they settle, instead of sitting at their authorization amount.

**It is cheaper than people expect.** `transactions/sync` returns only what
changed since the cursor, so a run moves kilobytes rather than re-downloading
history — a few transactions a day is a few KB. And Plaid bills Transactions as
a **monthly subscription per Item, not per call**, so syncing daily costs
exactly the same as syncing monthly.

Set `CRON_SECRET` (generate it like `SESSION_SECRET`) and the endpoint at
`/api/cron/sync` accepts a `Bearer` token — or a signed-in session, so you can
trigger it by hand.

**On Vercel** it is already configured in `vercel.json`, daily at 11:00 UTC.
Vercel sends `CRON_SECRET` automatically. Note that the Hobby plan allows one
run per day; more frequent schedules need Pro, and for this workload daily is
plenty.

**Self-hosting**, `docker-compose.yml` includes a small `cron` service that
sleeps until the next 11:00 UTC and calls the endpoint. Delete the service to
sync by hand instead. Anything that can make an HTTP request works equally
well:

```
0 11 * * *  curl -sS -H "Authorization: Bearer $CRON_SECRET" \
              https://your-host/api/cron/sync
```

The endpoint also runs debt reconciliation afterwards, in both directions —
importing a card's charges has to move its payments back to transfers, and that
moment arrives during a sync.

---

## Behind a reverse proxy

If you already run Authelia, Authentik, oauth2-proxy, Cloudflare Access or
Tailscale, you can let it do the authenticating:

```bash
AUTH_PROXY_HEADER="x-forwarded-user"
AUTH_PROXY_USERS="you@example.com"
```

**This is only safe when the app is unreachable except through the proxy.** A
header is trivial to forge — if the origin is directly reachable, anyone can
set that header and walk in. Bind it to a private network, a unix socket, or a
firewall rule.

A Caddy example:

```
finance.example.com {
    forward_auth authelia:9091 {
        uri /api/verify?rd=https://auth.example.com
        copy_headers Remote-User>X-Forwarded-User
    }
    reverse_proxy loot:3000
}
```

With the app's port bound to the internal network only:

```yaml
services:
  app:
    ports: []              # not published to the host
    networks: [internal]
```

---

## Any other host

The app is a standard Next.js server. `BUILD_STANDALONE=true pnpm build`
produces `.next/standalone`, which runs with `node server.js` and needs only
`DATABASE_URL`, `SESSION_SECRET` and one auth method in the environment.
Nothing is specific to Vercel or Docker.

## Prebuilt images

`ghcr.io/aroesec/loot` is published from `main` by CI.

| Tag | Moves | Use for |
|---|---|---|
| `latest` | every push to `main` | trying it out |
| `sha-<commit>` | never | anything you depend on |
| `v0.1.0`, `0.1` | on release | tracking a release line |

The image runs as an unprivileged user and expects the same environment
variables as a source deployment. It does not run migrations on start; run
`pnpm db:migrate` against the database first, as documented above.
