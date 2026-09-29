/** A tracked GitHub repo as the repos module works with it. */
export interface RepoRecord {
  id: string;
  workspaceId: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  clonePath: string | null;
  lastPolledAt: Date | null;
  createdBy: string | null;
}
