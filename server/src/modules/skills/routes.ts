import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  Skill,
  SkillAgentUse,
  SkillCreate,
  SkillImportPreview,
  SkillImportRequest,
  SkillUpdate,
  SkillVersion,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams, pageQuery } from '../_shared/schemas.js';
import { SkillsService } from './service.js';
import { VERSIONS_PAGE } from './constants.js';

/** `/skills/:id/versions/:version` — id is a uuid, version a positive integer. */
const VersionParams = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});

/**
 * Skills Lab module.
 *   GET    /skills                                → list (with agent_count)
 *   POST   /skills                                → create (v1 + snapshot)
 *   GET    /skills/:id                            → one skill
 *   PUT    /skills/:id                            → update; content changes add a version
 *   DELETE /skills/:id                            → delete (links + versions cascade)
 *   GET    /skills/:id/versions                   → snapshots, newest first
 *   POST   /skills/:id/versions/:version/restore  → new version with vN's content
 *   GET    /skills/:id/agents                     → agents with it linked + enabled
 *   POST   /skills/import/preview                 → parse a .md/.zip into a draft (no write)
 */
export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService({ skills: app.container.skillsRepo });

  app.get('/skills', { schema: { response: { 200: z.array(Skill) } } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.post('/skills', { schema: { body: SkillCreate, response: { 201: Skill } } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.create(workspaceId, req.body);
    reply.status(201);
    return skill;
  });

  // Static path: registered before `/skills/:id/*` reads clearer; `:id` must be a uuid anyway.
  app.post(
    '/skills/import/preview',
    {
      schema: { body: SkillImportRequest, response: { 200: SkillImportPreview } },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.previewImport(workspaceId, req.body);
    },
  );

  app.get('/skills/:id', { schema: { params: IdParams, response: { 200: Skill } } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.get(workspaceId, req.params.id);
  });

  app.put(
    '/skills/:id',
    { schema: { params: IdParams, body: SkillUpdate, response: { 200: Skill } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.update(workspaceId, req.params.id, req.body);
    },
  );

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    await service.delete(workspaceId, req.params.id);
    return { ok: true };
  });

  app.get(
    '/skills/:id/versions',
    {
      schema: {
        params: IdParams,
        querystring: pageQuery(VERSIONS_PAGE),
        response: { 200: z.array(SkillVersion) },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.versions(workspaceId, req.params.id, req.query);
    },
  );

  app.post(
    '/skills/:id/versions/:version/restore',
    { schema: { params: VersionParams, response: { 200: Skill } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.restore(workspaceId, req.params.id, req.params.version);
    },
  );

  app.get(
    '/skills/:id/agents',
    { schema: { params: IdParams, response: { 200: z.array(SkillAgentUse) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.agents(workspaceId, req.params.id);
    },
  );
}
