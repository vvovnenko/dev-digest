import { z } from 'zod';

/**
 * Shared route param schemas. Most `/:id` routes address a DB row whose primary
 * key is a uuid (see db/schema/*), so validate that shape at the edge — an
 * invalid id becomes a clean 422 instead of a downstream DB/500.
 *
 * NOTE: not every `:id` is a uuid (e.g. `/providers/:id` where id is a provider
 * name like "openai"); those routes use their own schema.
 */
export const IdParams = z.object({ id: z.string().uuid() });
export type IdParams = z.infer<typeof IdParams>;

/** The most rows one list response returns. */
export const MAX_PAGE = 1000;

/**
 * `?limit=&offset=` for a list route: a bound on one response rather than UI
 * paging — the studio takes the default, which is sized to what it shows.
 */
export function pageQuery(defaultLimit: number) {
  return z.object({
    limit: z.coerce.number().int().min(1).max(MAX_PAGE).default(defaultLimit),
    offset: z.coerce.number().int().min(0).default(0),
  });
}
