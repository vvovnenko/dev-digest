import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { PrReviewComment } from '@devdigest/shared';
import { PrCommentInput, PrDetail, PrMeta } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams, MAX_PAGE, pageQuery } from '../_shared/schemas.js';
import { PullsService } from './service.js';

/**
 * F1 — pulls module. PR import via Octokit (list + per-PR detail).
 *   GET  /repos/:id/pulls    → list PRs for a repo (open + recently merged/closed,
 *                              synced from GitHub, persisted). `status` is GitHub's
 *                              merge state (open/merged/closed).
 *   GET  /pulls/:id          → full PR detail (diff/files, commits, body, linked issue)
 *   GET  /pulls/:id/comments → inline review comments, proxied live to GitHub
 *   POST /pulls/:id/comments → post one (no local persistence)
 *
 * Import is idempotent (unique repo_id+number). Review trigger is MANUAL
 * and owned by A2 — this module only imports/reads.
 */
export default async function pullsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new PullsService({
    pulls: container.pullsRepo,
    github: () => container.github(),
    log: app.log,
  });

  // The studio searches and sorts the whole list client-side, so its page is the maximum.
  app.get(
    '/repos/:id/pulls',
    { schema: { params: IdParams, querystring: pageQuery(MAX_PAGE), response: { 200: z.array(PrMeta) } } },
    async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listForRepo(workspaceId, req.params.id, req.query);
    },
  );

  app.get('/pulls/:id', { schema: { params: IdParams, response: { 200: PrDetail } } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.detail(workspaceId, req.params.id, req.log);
  });

  // Inline review comments (Files changed tab) are proxied live to GitHub, so the
  // tab stays in lock-step with it and there is no stale local mirror.
  app.get('/pulls/:id/comments', { schema: { params: IdParams } }, async (req): Promise<PrReviewComment[]> => {
    const { workspaceId } = await getContext(container, req);
    return service.comments(workspaceId, req.params.id, req.log);
  });

  app.post(
    '/pulls/:id/comments',
    { schema: { params: IdParams, body: PrCommentInput } },
    async (req): Promise<PrReviewComment> => {
      const { workspaceId } = await getContext(container, req);
      return service.addComment(workspaceId, req.params.id, req.body);
    },
  );
}
