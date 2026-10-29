// Prints fresh values for BETTER_AUTH_SECRET and APP_ENCRYPTION_KEY. Paste them into .env.local.
import { randomBytes } from "node:crypto";

console.log(`BETTER_AUTH_SECRET=${randomBytes(32).toString("base64url")}`);
console.log(`APP_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`);
