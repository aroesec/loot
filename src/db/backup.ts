import { execFile } from "node:child_process";
import { createWriteStream, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { env } from "@/lib/env";
import { countCopyRows } from "./dump-text";

const execFileAsync = promisify(execFile);

export { countCopyRows };

/**
 * A copy of the ledger, on disk.
 *
 * There is exactly one place this data exists, and years of financial history
 * cannot be reconstructed from anywhere else — statements can be re-downloaded
 * for a while, but every correction, learned rule and manual category is
 * original work that only lives here.
 *
 * `pg_dump` rather than a table-by-table export, because a hand-rolled dump is
 * a restore that has never been tested. This produces a file `psql` can restore
 * without any of this code existing, which is the property that matters when
 * you need it.
 *
 * The dump includes the schema, so a restore does not depend on the migrations
 * still being runnable against whatever Postgres exists at that point.
 */

export type BackupResult = {
  path: string;
  bytes: number;
  tables: number;
  prunedOld: number;
};

/**
 * Rows that must be present for a dump to be worth keeping.
 *
 * A `pg_dump` of an empty or half-connected database exits zero and writes a
 * valid, useless file. Overwriting good backups with those is how a backup
 * system fails silently, so the dump is verified before it is kept.
 */
const EXPECTED_TABLES = ["transactions", "categories", "accounts"];

/**
 * Strip anything credential-shaped out of a child-process error.
 *
 * pg_dump echoes its connection string on failure and `execFile` repeats the
 * command it ran, so an ordinary version-mismatch error printed the database
 * password in full. Errors from this module are read by whoever is debugging a
 * failed backup, which is exactly the wrong audience for a live credential.
 */
function scrubError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/postgres(ql)?:\/\/[^\s"']+/g, "postgresql://[redacted]")
    .replace(/(password=)[^\s&"']+/gi, "$1[redacted]");
}

/**
 * Read result rows regardless of driver shape.
 *
 * postgres.js returns an array-like RowList while node-postgres returns
 * `{ rows }`. Reading the wrong one yields `undefined` rather than an error,
 * which silently disabled the version check below and let pg_dump produce its
 * own opaque failure instead.
 */
function rowsOf<T>(result: unknown): T[] {
  const maybe = (result as { rows?: unknown }).rows;
  return (Array.isArray(maybe) ? maybe : (result as T[])) ?? [];
}

/**
 * pg_dump refuses to dump a server newer than itself, and says so in a way
 * that reads like a bug rather than a missing package. Checking first turns it
 * into an instruction.
 */
async function checkVersions(): Promise<void> {
  const { stdout } = await execFileAsync("pg_dump", ["--version"]);
  const clientMajor = Number(stdout.match(/(\d+)\./)?.[1] ?? 0);

  const { db } = await import("./index");
  const { sql } = await import("drizzle-orm");
  const res = await db.execute(sql`SHOW server_version`);
  const serverVersion = rowsOf<{ server_version?: string }>(res)[0]?.server_version ?? "";
  const serverMajor = Number(serverVersion.match(/^(\d+)/)?.[1] ?? 0);

  if (clientMajor && serverMajor && clientMajor < serverMajor) {
    throw new Error(
      `pg_dump is version ${clientMajor} and the server is ${serverMajor}. ` +
        `pg_dump refuses to dump a newer server.\n\n` +
        `  macOS:  brew install postgresql@${serverMajor}\n` +
        `          export PATH="$(brew --prefix postgresql@${serverMajor})/bin:$PATH"\n` +
        `  Docker: docker run --rm -e PGURI="$DATABASE_URL" postgres:${serverMajor} \\\n` +
        `            pg_dump "$PGURI" --no-owner --no-privileges | gzip > backup.sql.gz`,
    );
  }
}

/**
 * The live row count, or null if it could not be read.
 *
 * Schema-qualified deliberately. An unqualified name depends on `search_path`
 * resolving, and this query runs moments after pg_dump has been talking to the
 * same database — a resuming serverless compute handed back a session where
 * `current_schema()` was null, and the check failed with "relation
 * transactions does not exist" against a database that plainly had one. The
 * dump was fine; only the verification broke, and it took a good backup with
 * it.
 *
 * Retried once, because the failure that prompted this was transient and
 * throwing away a correct dump over a blip is the wrong trade.
 */
async function liveTransactionCount(): Promise<number | null> {
  const { db } = await import("./index");
  const { sql } = await import("drizzle-orm");

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const rows = rowsOf<{ n: number }>(
        await db.execute(sql`SELECT count(*)::int AS n FROM public.transactions`),
      );
      const n = rows[0]?.n;
      if (typeof n === "number") return n;
    } catch (err) {
      if (attempt === 1) console.error("  count check failed:", scrubError(err));
    }
  }
  return null;
}

export async function backup(
  opts: { dir?: string; keep?: number } = {},
): Promise<BackupResult> {
  await checkVersions();
  const dir = opts.dir ?? "./backups";
  const keep = opts.keep ?? 14;

  mkdirSync(dir, { recursive: true });

  /*
   * Timestamped, never overwritten. A backup that replaces yesterday's is one
   * corruption away from being worthless: if the damage is not noticed the
   * same day, the only copy already has it.
   */
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const path = join(dir, `loot-${stamp}.sql.gz`);

  /*
   * The URI goes in argv because libpq only honours the full connection string
   * — including sslmode, which Neon requires — when it is given as one.
   *
   * That does mean it appears in `ps` and in any error text, so every error out
   * of here is scrubbed: `execFile` repeats the command it ran and pg_dump
   * echoes its connection string, which printed the database password in full
   * the first time an ordinary version mismatch occurred.
   */
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      "pg_dump",
      [env.DATABASE_URL, "--no-owner", "--no-privileges", "--clean", "--if-exists"],
      // A few years of transactions is small, but not default-buffer small.
      { maxBuffer: 512 * 1024 * 1024 },
    ));
  } catch (err) {
    throw new Error(scrubError(err));
  }

  for (const table of EXPECTED_TABLES) {
    if (!stdout.includes(`CREATE TABLE public.${table}`)) {
      throw new Error(
        `Dump is missing "${table}" — refusing to write it. An empty dump that ` +
          `replaces good backups is worse than a failed one.`,
      );
    }
  }

  /*
   * Schema presence is not evidence of data. A dump taken against a wiped or
   * freshly migrated database contains every CREATE TABLE above and would sail
   * through — which is the exact case that must not be allowed to age good
   * backups out of the retention window.
   *
   * So the row count is compared to the live table. Equal, or the dump is not
   * a copy of what is actually there.
   */
  const dumped = countCopyRows(stdout, "transactions");
  const live = await liveTransactionCount();

  if (live === null) {
    /*
     * Worth distinguishing from a mismatch. "The counts disagree" means the
     * dump is wrong; this means the dump might be perfect and the check could
     * not run — a serverless database resuming, a dropped connection. Saying
     * "not a copy of what is there" for that would send someone hunting a data
     * problem that does not exist.
     */
    throw new Error(
      "Could not read the live transaction count, so the dump was not verified " +
        "and has not been kept. The dump itself may be fine — try again.",
    );
  }

  if (dumped !== live) {
    throw new Error(
      `Dump has ${dumped} transactions but the database has ${live}. Refusing ` +
        `to write a dump that is not a copy of what is there.`,
    );
  }

  const gzip = createGzip();
  const out = createWriteStream(path);
  await pipeline(async function* () { yield stdout; }, gzip, out);

  const bytes = statSync(path).size;
  const tables = (stdout.match(/CREATE TABLE public\./g) ?? []).length;

  /*
   * Prune by count rather than age. A deployment that stops running for a
   * month should still have its last fourteen dumps when it comes back, not
   * nothing.
   */
  let prunedOld = 0;
  const existing = readdirSync(dir)
    .filter((f) => f.startsWith("loot-") && f.endsWith(".sql.gz"))
    .sort()
    .reverse();

  for (const stale of existing.slice(keep)) {
    unlinkSync(join(dir, stale));
    prunedOld += 1;
  }

  return { path, bytes, tables, prunedOld };
}

if (process.argv[1]?.endsWith("backup.ts")) {
  backup({
    dir: process.env.BACKUP_DIR ?? "./backups",
    keep: Number(process.env.BACKUP_KEEP ?? 14),
  })
    .then((r) => {
      console.log(
        `${r.path}\n  ${(r.bytes / 1024).toFixed(0)} KB, ${r.tables} tables` +
          (r.prunedOld ? `, pruned ${r.prunedOld} old` : ""),
      );
      console.log(`\nRestore with:\n  gunzip -c ${r.path} | psql "$DATABASE_URL"`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("backup failed:", err.message ?? err);
      // Non-zero so a scheduler notices. A backup that fails quietly is not a
      // backup.
      process.exit(1);
    });
}
