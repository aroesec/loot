import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { mcpTokens } from "@/db/schema";

/**
 * Bearer tokens for the MCP server.
 *
 * Only the hash is persisted, so a leaked database yields no working token,
 * and resolution is a hash lookup rather than a scan comparing candidates —
 * there is no secret-dependent comparison to time.
 */

/*
 * Cosmetic. Tokens resolve by hashing the presented value and looking that
 * hash up, so the prefix is never parsed — tokens issued under an older
 * prefix keep working after a rename. It exists to make a leaked string
 * recognizable in a log.
 */
const PREFIX = "loot_";

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type IssuedToken = {
  id: string;
  name: string;
  /** Returned exactly once, at creation. Only the hash is stored. */
  token: string;
};

export async function createMcpToken(name: string): Promise<IssuedToken> {
  const token = `${PREFIX}${randomBytes(32).toString("hex")}`;
  const [row] = await db
    .insert(mcpTokens)
    .values({ name, tokenHash: hash(token) })
    .returning({ id: mcpTokens.id });
  return { id: row!.id, name, token };
}

export type TokenIdentity = { tokenId: string; name: string };

export async function resolveMcpToken(
  token: string | null | undefined,
): Promise<TokenIdentity | null> {
  if (!token) return null;

  const [row] = await db
    .select({ id: mcpTokens.id, name: mcpTokens.name })
    .from(mcpTokens)
    .where(and(eq(mcpTokens.tokenHash, hash(token)), eq(mcpTokens.revoked, false)))
    .limit(1);

  if (!row) return null;

  // Best effort — a failed stats write must not fail the request.
  void db
    .update(mcpTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(mcpTokens.id, row.id))
    .catch(() => {});

  return { tokenId: row.id, name: row.name };
}

export async function revokeMcpToken(id: string): Promise<void> {
  await db.update(mcpTokens).set({ revoked: true }).where(eq(mcpTokens.id, id));
}

export async function listMcpTokens() {
  return db
    .select({
      id: mcpTokens.id,
      name: mcpTokens.name,
      revoked: mcpTokens.revoked,
      createdAt: mcpTokens.createdAt,
      lastUsedAt: mcpTokens.lastUsedAt,
    })
    .from(mcpTokens)
    .orderBy(mcpTokens.createdAt);
}

/** Extracts the token from an `Authorization: Bearer …` header. */
export function bearerFrom(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1]!.trim() : null;
}
