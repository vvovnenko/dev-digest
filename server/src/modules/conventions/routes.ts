import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ConventionCandidate,
  ConventionSkillCreate,
  ConventionSkillDraft,
  ConventionsState,
  ConventionUpdate,
  Skill,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { ConventionsService } from './service.js';
import { EXTRACT_RATE_LIMIT } from './constants.js';

/**
 * Conventions Extractor (Skills Lab → Conventions).
 *   GET  /repos/:id/conventions                → latest done scan, newest scan (any status), non-rejected candidates
 *   POST /repos/:id/conventions/extract        → 202: queue a scan job (sample → model → evidence check),
 *                                                or return the repo's active scan as it is
 *   PUT  /conventions/:id                      → accept / reject / pending, or edit the rule
 *   POST /repos/:id/conventions/deselect-all   → accepted → pending
 *   GET  /repos/:id/conventions/skill-draft    → the accepted candidates as one skill draft
 *   POST /repos/:id/conventions/skill          → create that skill (source `extracted`)
 *
 * A scan runs as a JobRunner job (kind 'conventions-scan'); the UI polls GET
 * until `latest_scan` is no longer queued or running.
 */
export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new ConventionsService({
    store: container.conventionsRepo,
    repos: container.reposRepo,
    samples: container.repoIntel,
    files: () => container.git,
    llm: (provider) => container.llm(provider),
    model: (workspaceId) => container.featureModel(workspaceId, 'conventions'),
    skills: container.skillsRepo,
    jobs: container.jobs,
  });

  // Register the scan job handler once, then fail the scans a previous process
  // left queued or running: their jobs lived in its memory (single instance,
  // like the boot job reaper). Non-fatal, as that reaper is.
  service.registerScanJobHandler();
  try {
    const reaped = await service.reapInterrupted();
    if (reaped > 0) app.log.info({ reaped }, 'failed interrupted conventions scans on boot');
  } catch (err) {
    app.log.warn({ err: (err as Error).message }, 'conventions scan reaping failed (non-fatal)');
  }

  app.get(
    '/repos/:id/conventions',
    // Polled every 2 s while a scan is active: exempt from the global rate limit.
    { schema: { params: IdParams, response: { 200: ConventionsState } }, config: { rateLimit: false } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.state(workspaceId, req.params.id);
    },
  );

  // Each scan it queues is one paid model call over up to ~90k characters of code.
  app.post(
    '/repos/:id/conventions/extract',
    {
      schema: { params: IdParams, response: { 202: ConventionsState } },
      config: { rateLimit: EXTRACT_RATE_LIMIT },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const state = await service.startScan(workspaceId, req.params.id);
      reply.status(202);
      return state;
    },
  );

  app.put(
    '/conventions/:id',
    { schema: { params: IdParams, body: ConventionUpdate, response: { 200: ConventionCandidate } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.update(workspaceId, req.params.id, req.body);
    },
  );

  app.post(
    '/repos/:id/conventions/deselect-all',
    { schema: { params: IdParams, response: { 200: z.object({ updated: z.number().int() }) } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.deselectAll(workspaceId, req.params.id);
    },
  );

  app.get(
    '/repos/:id/conventions/skill-draft',
    { schema: { params: IdParams, response: { 200: ConventionSkillDraft } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.skillDraft(workspaceId, req.params.id);
    },
  );

  app.post(
    '/repos/:id/conventions/skill',
    { schema: { params: IdParams, body: ConventionSkillCreate, response: { 201: Skill } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const skill = await service.createSkill(workspaceId, req.params.id, req.body);
      reply.status(201);
      return skill;
    },
  );
}
