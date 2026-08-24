import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

/**
 * Password storage.
 *
 * `APP_PASSWORD_HASH` is the form to use: the deployment holds a scrypt digest
 * rather than the password itself, so an environment dump — a leaked CI log, a
 * screen-shared dashboard, a `printenv` in a support thread — does not hand
 * over the login.
 *
 * `APP_PASSWORD` in plaintext still works, because breaking every existing
 * deployment to make a security point would be its own kind of failure. It is
 * a supported downgrade, not the recommendation, and `pnpm auth:hash` exists to
 * move off it.
 *
 * scrypt rather than bcrypt to avoid a native dependency: this is a
 * single-user login, and the attack it defends against is an offline guess
 * against a stolen digest, which scrypt's memory hardness handles well.
 */

const KEY_LENGTH = 64;
const SALT_BYTES = 16;

export async function hashPassword(plaintext: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = (await scryptAsync(plaintext, salt, KEY_LENGTH)) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

/** Constant-time throughout: a timing difference leaks the password. */
export async function verifyAgainstHash(
  plaintext: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;

  const salt = Buffer.from(parts[1]!, "base64url");
  const expected = Buffer.from(parts[2]!, "base64url");
  const derived = (await scryptAsync(plaintext, salt, expected.length)) as Buffer;

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/**
 * Compares two strings without leaking length or content through timing.
 * Used for the plaintext fallback.
 */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}
