import postgres from 'postgres';

// One pool for the process. DATABASE_URL e.g. postgres://postgres:pw@postgres:5432/wurmple
export const sql = postgres(Deno.env.get('DATABASE_URL') ?? 'postgres://postgres@localhost:5432/wurmple', {
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
