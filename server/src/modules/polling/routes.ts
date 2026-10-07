import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { PollingService } from './service.js';

/**
 * F1 — polling module: the only import of a repo's PRs (`GET /repos/:id/pulls`
 * is read-only). It does NOT trigger any review — review is manual (user
 * presses Run Review, owned by A2).
 *
 *   POST /repos/:id/poll  → sync PR list from GitHub, backfill diff stats, bump last_polled_at
 */
export default async function pollingRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new PollingService({ pulls: container.pullsRepo, github: () => container.github(), log: app.log });

  app.post('/repos/:id/poll', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.poll(workspaceId, req.params.id);
  });
}
