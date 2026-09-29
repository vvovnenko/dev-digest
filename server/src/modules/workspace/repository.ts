import { eq } from 'drizzle-orm';
import type { AuthUser, AuthWorkspace } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { RepoLister, WorkspaceRepo } from './ports.js';

/**
 * Workspace data: the overview's repo list, and the identity lookups the
 * no-login auth adapter needs (it takes this as its `IdentityStore`).
 */
export class WorkspaceRepository implements RepoLister {
  constructor(private db: Db) {}

  async listRepos(workspaceId: string): Promise<WorkspaceRepo[]> {
    return this.db
      .select({
        id: t.repos.id,
        fullName: t.repos.fullName,
        clonePath: t.repos.clonePath,
        lastPolledAt: t.repos.lastPolledAt,
      })
      .from(t.repos)
      .where(eq(t.repos.workspaceId, workspaceId));
  }

  async userByEmail(email: string): Promise<AuthUser | undefined> {
    const [u] = await this.db
      .select({ id: t.users.id, email: t.users.email, name: t.users.name })
      .from(t.users)
      .where(eq(t.users.email, email));
    return u;
  }

  async workspaceByName(name: string): Promise<AuthWorkspace | undefined> {
    const [w] = await this.db
      .select({ id: t.workspaces.id, name: t.workspaces.name })
      .from(t.workspaces)
      .where(eq(t.workspaces.name, name));
    return w;
  }
}
