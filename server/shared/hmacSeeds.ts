// Pure WebCrypto helper (no Deno APIs) so it can be unit-tested under Node.

const encoder = new TextEncoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

function importKey(salt: string): Promise<CryptoKey> {
  let key = keyCache.get(salt);
  if (!key) {
    key = crypto.subtle.importKey('raw', encoder.encode(salt), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    keyCache.set(salt, key);
  }
  return key;
}

/**
 * Two uint32 seeds for the affine pick, from HMAC-SHA256(salt, `wurmple:target:<userId>`).
 * Without the salt nobody can reproduce a user's target.
 */
export async function deriveSeeds(salt: string, userId: string): Promise<{ aSeed: number; bSeed: number }> {
  const key = await importKey(salt);
  const mac = new DataView(await crypto.subtle.sign('HMAC', key, encoder.encode(`wurmple:target:${userId}`)));
  return { aSeed: mac.getUint32(0), bSeed: mac.getUint32(4) };
}
