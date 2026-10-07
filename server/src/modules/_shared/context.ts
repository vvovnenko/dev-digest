import type { FastifyRequest } from 'fastify';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';

export interface RequestContext {
  workspaceId: string;
  userId: string;
}

/**
 * Resolve the tenancy context for a request via the AuthProvider. In MVP
 * (LocalNoAuthProvider) this always returns the default workspace + system user.
 * Every module uses this so workspace scoping is never forgotten.
 */
export async function getContext(
  container: Container,
  req: FastifyRequest,
): Promise<RequestContext> {
  const [user, workspace] = await Promise.all([
    container.auth.currentUser(req),
    container.auth.currentWorkspace(req),
  ]);
  return { workspaceId: workspace.id, userId: user.id };
}

/**
 * 404 unless the repo belongs to the request's workspace — for routes of a
 * module that addresses repos by id but doesn't own them (repo-intel).
 */
export async function requireRepoInWorkspace(
  container: Container,
  workspaceId: string,
  repoId: string,
): Promise<void> {
  if (!(await container.reposRepo.getById(workspaceId, repoId))) throw new NotFoundError('Repo not found');
}
