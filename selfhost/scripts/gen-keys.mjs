// Prints fresh POSTGRES_PASSWORD and TARGET_SALT lines for selfhost/.env.
import { randomBytes } from 'node:crypto';

console.log(`POSTGRES_PASSWORD=${randomBytes(24).toString('hex')}`);
console.log(`TARGET_SALT=${randomBytes(48).toString('base64url')}`);
