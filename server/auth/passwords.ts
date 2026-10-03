import bcrypt from 'bcryptjs';

const COST = 10;
// Compared against when the account doesn't exist, so timing doesn't reveal it.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', COST);

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST);
}

/** bcrypt check; accepts the $2a$ hashes carried over from the old auth server. */
export async function verifyPassword(password: string, hash: string | null): Promise<boolean> {
  if (!hash) {
    await bcrypt.compare(password, DUMMY_HASH);
    return false;
  }
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}
