/** A repo as the workspace overview lists it. */
export interface WorkspaceRepo {
  id: string;
  fullName: string;
  clonePath: string | null;
  lastPolledAt: Date | null;
}

export interface RepoLister {
  listRepos(workspaceId: string): Promise<WorkspaceRepo[]>;
}

export interface WorkspaceDeps {
  repos: RepoLister;
  /** Where clones live (config). */
  cloneDir: string;
}
