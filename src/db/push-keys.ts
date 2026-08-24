import webpush from "web-push";

/**
 * Generate a VAPID key pair.
 *
 *   pnpm push:keys
 *
 * The public key is handed to browsers when they subscribe; the private key
 * signs each push and never leaves the server. Rotating them invalidates every
 * existing subscription — devices have to re-enable alerts — so generate once
 * and keep them.
 */
const keys = webpush.generateVAPIDKeys();

console.log("\nVAPID_PUBLIC_KEY=" + keys.publicKey);
console.log("VAPID_PRIVATE_KEY=" + keys.privateKey);
console.log('VAPID_SUBJECT="mailto:you@example.com"\n');
console.log("Set all three. The subject is a contact address the push service");
console.log("can reach if it needs to; the spec requires one.\n");
