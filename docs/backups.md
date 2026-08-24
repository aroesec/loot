# Backups

`pnpm db:backup` writes a gzipped `pg_dump` to `backups/`, keeping the last 14
(`BACKUP_KEEP`, `BACKUP_DIR`). Restore is plain `psql`, so it does not depend on
this codebase still existing:

```
gunzip -c backups/loot-<stamp>.sql.gz | psql "$DATABASE_URL"
```

It refuses to write a dump whose `transactions` row count disagrees with the
database. A dump taken against a wiped or freshly migrated database is a
complete, valid file containing no data, and letting one of those in ages the
real backups out of the retention window. The failure mode where you discover
the backups were empty at the moment you need them.

**`pg_dump` must be at least the server's major version**, or it refuses to
run; the command checks first and tells you what to install. Neon reports its
version with `SHOW server_version`.

## Restoring

```sh
gunzip -c backups/loot-<stamp>.sql.gz | psql "$DATABASE_URL"
```

The dump includes the schema, so a restore does not depend on the migrations
still being runnable. It is plain SQL, so it does not depend on this codebase
existing either.

## Automating it

There is no scheduled backup. `pnpm db:backup` runs where you run it, and on
Vercel there is no `pg_dump` binary, so a cron job there will not work. Run it
from a machine that has one, or from a container:

```sh
docker run --rm -e PGURI="$DATABASE_URL" postgres:18 \
  pg_dump "$PGURI" --no-owner --no-privileges | gzip > loot-backup.sql.gz
```

A managed Postgres usually has point-in-time restore of its own. That covers
accidents inside its retention window. This covers losing the account.
