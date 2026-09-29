import { describe, it, expect } from 'vitest';
import type { AuthUser, AuthWorkspace } from '@devdigest/shared';
import { LocalNoAuthProvider, type IdentityStore } from '../src/adapters/auth/local.js';
import { ConfigError } from '../src/platform/errors.js';

/** In-memory identities that count lookups. */
class InMemoryIdentities implements IdentityStore {
  lookups = 0;
  constructor(
    private users: AuthUser[] = [],
    private workspaces: AuthWorkspace[] = [],
  ) {}
  async userByEmail(email: string) {
    this.lookups++;
    return this.users.find((u) => u.email === email);
  }
  async workspaceByName(name: string) {
    this.lookups++;
    return this.workspaces.find((w) => w.name === name);
  }
}

const identity = { email: 'you@local', workspaceName: 'default' };

describe('LocalNoAuthProvider', () => {
  it('acts as the seeded user and workspace, looking each up once', async () => {
    const store = new InMemoryIdentities(
      [{ id: 'u1', email: 'you@local', name: 'You' }],
      [{ id: 'w1', name: 'default' }],
    );
    const auth = new LocalNoAuthProvider(store, identity);
    expect(await auth.currentUser()).toEqual({ id: 'u1', email: 'you@local', name: 'You' });
    expect(await auth.currentWorkspace()).toEqual({ id: 'w1', name: 'default' });
    await auth.currentUser();
    await auth.currentWorkspace();
    expect(store.lookups).toBe(2);
  });

  it('asks for the seed when the identity is missing', async () => {
    const auth = new LocalNoAuthProvider(new InMemoryIdentities(), identity);
    await expect(auth.currentUser()).rejects.toBeInstanceOf(ConfigError);
    await expect(auth.currentWorkspace()).rejects.toThrow(/db:seed/);
  });
});
