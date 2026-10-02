// Prints fresh POSTGRES_PASSWORD, JWT_SECRET, ANON_KEY and SERVICE_ROLE_KEY
// lines for selfhost/.env. Keys are HS256 JWTs valid for 10 years.
import { createHmac, randomBytes } from 'node:crypto';

const b64url = (input) => Buffer.from(input).toString('base64url');

function sign(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

const jwtSecret = randomBytes(48).toString('base64url');
const iat = Math.floor(Date.now() / 1000);
const exp = iat + 10 * 365 * 24 * 60 * 60;

console.log(`POSTGRES_PASSWORD=${randomBytes(24).toString('hex')}`);
console.log(`JWT_SECRET=${jwtSecret}`);
console.log(`ANON_KEY=${sign({ role: 'anon', iss: 'supabase', iat, exp }, jwtSecret)}`);
console.log(`SERVICE_ROLE_KEY=${sign({ role: 'service_role', iss: 'supabase', iat, exp }, jwtSecret)}`);
