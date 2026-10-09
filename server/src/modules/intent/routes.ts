import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PrIntentState } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { DERIVE_RATE_LIMIT } from './constants.js';

/**
 * Intent Layer (PR Overview → Intent card).
 *   GET  /pulls/:id/intent   → the PR's derived intent and the latest attempt (`status: none` before the first)
 *   POST /pulls/:id/intent   → 202: queue a derive job (refresh → sources → model → store),
 *                              or return the PR's active attempt as it is
 *
 * A derive runs as a JobRunner job (kind 'pr-intent'); the UI polls GET until
 * `status` is no longer queued or running. The service is the container's, shared
 * with the reviews module, which derives an intent inline when a PR has none.
 */
export default async function intentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = container.intentService;

  // Register the job handler once, then fail the attempts a previous process left
  // queued or running: their jobs lived in its memory (single instance, like the
  // boot job reaper). Non-fatal, as that reaper is.
  service.registerJobHandler();
  try {
    const reaped = await service.reapInterrupted();
    if (reaped > 0) app.log.info({ reaped }, 'failed interrupted intent derives on boot');
  } catch (err) {
    app.log.warn({ err: (err as Error).message }, 'intent derive reaping failed (non-fatal)');
  }

  app.get(
    '/pulls/:id/intent',
    // Polled every 2 s while an attempt is active: exempt from the global rate limit.
    { schema: { params: IdParams, response: { 200: PrIntentState } }, config: { rateLimit: false } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.state(workspaceId, req.params.id);
    },
  );

  // Each attempt it queues is one paid model call.
  app.post(
    '/pulls/:id/intent',
    {
      schema: { params: IdParams, response: { 202: PrIntentState } },
      config: { rateLimit: DERIVE_RATE_LIMIT },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const state = await service.requestDerive(workspaceId, req.params.id);
      reply.status(202);
      return state;
    },
  );
}
