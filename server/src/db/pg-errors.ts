/**
 * Postgres error checks for repositories. postgres-js surfaces `code` and
 * `constraint_name` on its error; Drizzle ≥ 0.44 wraps that error in a
 * `DrizzleQueryError`, so walk the `cause` chain instead of reading the top level.
 */

/** A unique violation (23505), on `constraint` when one is given. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  let e: unknown = err;
  for (let depth = 0; e && depth < 5; depth++, e = (e as { cause?: unknown }).cause) {
    const pg = e as { code?: string; constraint_name?: string };
    if (pg.code === '23505' && (constraint === undefined || pg.constraint_name === constraint)) return true;
  }
  return false;
}
