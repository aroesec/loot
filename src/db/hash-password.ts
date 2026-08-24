import { hashPassword } from "@/lib/auth/password";

/**
 * Prints a scrypt digest for APP_PASSWORD_HASH.
 *
 *   pnpm auth:hash 'your password here'
 *
 * Read from argv rather than prompted so it composes, and quoted in the docs
 * so a shell does not eat the special characters people put in passwords.
 */
const plaintext = process.argv[2];

if (!plaintext) {
  console.error("Usage: pnpm auth:hash '<password>'");
  process.exit(1);
}

hashPassword(plaintext)
  .then((hash) => {
    console.log("\nAPP_PASSWORD_HASH=" + hash + "\n");
    console.log("Set that, then remove APP_PASSWORD from the environment.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("hashing failed", err);
    process.exit(1);
  });
