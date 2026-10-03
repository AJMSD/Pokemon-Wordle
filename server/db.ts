import postgres from 'postgres';

// Connection settings: DATABASE_URL, or the libpq-style PGHOST / PGPORT /
// PGDATABASE / PGUSER / PGPASSWORD variables (used by docker-compose, so the
// password never needs URL-encoding).
export function connect(options: postgres.Options<Record<string, postgres.PostgresType>> = {}) {
  const url = Deno.env.get('DATABASE_URL');
  return url ? postgres(url, options) : postgres(options);
}

// One pool for the process.
export const sql = connect({
  max: Number(Deno.env.get('DB_POOL_SIZE') ?? 10),
  idle_timeout: 60,
  onnotice: () => {},
});

export type Sql = typeof sql;
/** A pool or a transaction handle; both run tagged queries. */
export type Db = Sql | postgres.TransactionSql;

/** Postgres unique_violation. */
export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === '23505';
}

/** Parameter for a jsonb column (postgres.js's own typing rejects interfaces). */
export function jsonb(value: unknown) {
  return sql.json(value as postgres.JSONValue);
}
