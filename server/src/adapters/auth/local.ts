import type { AuthProvider, AuthUser, AuthWorkspace } from '@devdigest/shared';
import { ConfigError } from '../../platform/errors.js';

/** Where the no-login provider finds the seeded user and workspace (a repository). */
export interface IdentityStore {
  userByEmail(email: string): Promise<AuthUser | undefined>;
  workspaceByName(name: string): Promise<AuthWorkspace | undefined>;
}

/** Which seeded identity every request acts as. */
export interface LocalIdentity {
  email: string;
  workspaceName: string;
}

/**
 * LocalNoAuthProvider — MVP no-login mode. Always returns the single
 * seeded system user + default workspace. Resolves them through the store
 * (lazily cached) so every request scopes to the same workspace_id.
 *
 * Swap for a real AuthProvider later; call sites only depend on the interface.
 */
export class LocalNoAuthProvider implements AuthProvider {
  private cachedUser?: AuthUser;
  private cachedWorkspace?: AuthWorkspace;

  constructor(
    private store: IdentityStore,
    private identity: LocalIdentity,
  ) {}

  async currentUser(): Promise<AuthUser> {
    if (this.cachedUser) return this.cachedUser;
    const user = await this.store.userByEmail(this.identity.email);
    if (!user) throw new ConfigError('No system user found — run `pnpm db:seed`.');
    this.cachedUser = user;
    return user;
  }

  async currentWorkspace(): Promise<AuthWorkspace> {
    if (this.cachedWorkspace) return this.cachedWorkspace;
    const workspace = await this.store.workspaceByName(this.identity.workspaceName);
    if (!workspace) throw new ConfigError('No default workspace found — run `pnpm db:seed`.');
    this.cachedWorkspace = workspace;
    return workspace;
  }
}
