import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Encryption for Plaid access tokens.
 *
 * These are not like the MCP bearer tokens, which are stored as SHA-256 digests
 * because they only ever need to be *verified*. An access token has to be
 * replayed to Plaid on every sync, so it must be recoverable — which means
 * hashing is not an option and the plaintext has to be protected instead.
 *
 * What it protects against is a database dump: a leaked `plaid_items` row is
 * useless without PLAID_TOKEN_KEY, which lives in the environment. It does not
 * protect against an attacker who already has the running environment, and
 * nothing at this layer could.
 *
 * AES-256-GCM, so tampering is detected rather than silently decrypting to
 * garbage. A fresh 12-byte IV per token: reusing an IV under GCM is a total
 * break, not a weakness.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
/*
 * Never rename this, whatever the project is called.
 *
 * It is the scrypt salt that derives the AES key from PLAID_TOKEN_KEY, so
 * changing it changes the key and every access token already encrypted with
 * the old one becomes undecryptable — every bank connection would have to be
 * linked again, which on Plaid's Trial plan permanently consumes Item quota.
 * The `.v1` is the only part that should ever move, and only deliberately.
 */
const SALT = "moneybags.plaid.v1";

function key(): Buffer {
  const secret = env.PLAID_TOKEN_KEY;
  if (!secret) {
    throw new Error(
      "PLAID_TOKEN_KEY is not set. Bank syncing stays off rather than storing access tokens in the clear.",
    );
  }
  // Fixed salt: this derives one key for one purpose, and a stored random salt
  // would have to be read before it could be used to read anything.
  return scryptSync(secret, SALT, 32);
}

/** Returns `iv.ciphertext.authTag`, all base64url. */
export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

export function decryptToken(stored: string): string {
  const parts = stored.split(".");
  if (parts.length !== 3) {
    throw new Error("Stored Plaid token is malformed.");
  }
  const [ivPart, ciphertextPart, tagPart] = parts as [string, string, string];

  const decipher = createDecipheriv(
    ALGORITHM,
    key(),
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));

  try {
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // GCM auth failure: either the ciphertext was altered or the key changed.
    throw new Error(
      "Could not decrypt a Plaid access token. If PLAID_TOKEN_KEY was rotated, the linked banks need reconnecting.",
    );
  }
}
