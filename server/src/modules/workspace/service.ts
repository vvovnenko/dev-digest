import type { WorkspaceDeps } from './ports.js';

/** `GET /workspace`: where clones live and which repos are cloned. */
export interface WorkspaceSummary {
  workspaceId: string;
  cloneDir: string;
  repos: {
    id: string;
    full_name: string;
    clone_path: string | null;
    last_polled_at: string | null;
    cloned: boolean;
  }[];
}

export class WorkspaceService {
  constructor(private deps: WorkspaceDeps) {}

  async summary(workspaceId: string): Promise<WorkspaceSummary> {
    const repos = await this.deps.repos.listRepos(workspaceId);
    return {
      workspaceId,
      cloneDir: this.deps.cloneDir,
      repos: repos.map((r) => ({
        id: r.id,
        full_name: r.fullName,
        clone_path: r.clonePath,
        last_polled_at: r.lastPolledAt?.toISOString() ?? null,
        cloned: Boolean(r.clonePath),
      })),
    };
  }
}
