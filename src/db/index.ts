import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { env } from "@/lib/env";

/**
 * Serverless functions get recycled constantly, so the connection is cached on
 * globalThis to avoid opening a new pool on every warm invocation.
 */
const globalForDb = globalThis as unknown as {
  __lootSql?: ReturnType<typeof postgres>;
};

const client =
  globalForDb.__lootSql ??
  postgres(env.DATABASE_URL, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__lootSql = client;
}

export const db = drizzle(client, { schema });
export { schema };
export type Db = typeof db;
