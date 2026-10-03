// Applies db/migrations/*.sql in filename order, each in its own transaction,
// recording applied versions in schema_migrations. Safe to run repeatedly.
//   deno task migrate            (DATABASE_URL from the environment)
import postgres from 'postgres';

const MIGRATIONS_DIR = new URL('../db/migrations/', import.meta.url);
// Arbitrary constant: serializes concurrent runs (two deploys at once).
const LOCK_ID = 7_240_311;

/** Migration files not yet applied, in the order they must run. */
export function pendingMigrations(files: string[], applied: Iterable<string>): string[] {
  const done = new Set(applied);
  return files
    .filter((f) => /^\d+_[\w-]+\.sql$/.test(f))
    .sort()
    .filter((f) => !done.has(f.replace(/\.sql$/, '')));
}

export async function migrate(databaseUrl: string, dir: URL = MIGRATIONS_DIR): Promise<string[]> {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await sql`select pg_advisory_lock(${LOCK_ID})`;
    await sql`
      create table if not exists schema_migrations (
        version text primary key,
        applied_at timestamptz not null default now()
      )`;
    const applied = (await sql<{ version: string }[]>`select version from schema_migrations`).map((r) => r.version);

    const files: string[] = [];
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isFile) files.push(entry.name);
    }

    const ran: string[] = [];
    for (const file of pendingMigrations(files, applied)) {
      const version = file.replace(/\.sql$/, '');
      const text = await Deno.readTextFile(new URL(file, dir));
      await sql.begin(async (tx) => {
        await tx.unsafe(text);
        await tx`insert into schema_migrations (version) values (${version})`;
      });
      console.log(`applied ${version}`);
      ran.push(version);
    }
    if (ran.length === 0) console.log('migrations up to date');
    return ran;
  } finally {
    await sql`select pg_advisory_unlock(${LOCK_ID})`.catch(() => {});
    await sql.end();
  }
}

if (import.meta.main) {
  const url = Deno.env.get('DATABASE_URL');
  if (!url) {
    console.error('DATABASE_URL must be set');
    Deno.exit(1);
  }
  await migrate(url);
}
