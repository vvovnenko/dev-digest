import { describe, it, expect } from 'vitest';
import { canonicalCloneUrl, parseRepoUrl } from '../src/modules/repos/helpers.js';

describe('parseRepoUrl', () => {
  it.each([
    ['https://github.com/acme/app', 'acme', 'app'],
    ['https://github.com/acme/app.git', 'acme', 'app'],
    ['https://github.com/acme/app/', 'acme', 'app'],
    ['  https://github.com/acme/app  ', 'acme', 'app'],
    ['git@github.com:acme/app.git', 'acme', 'app'],
    ['git@github.com:acme/app', 'acme', 'app'],
    ['https://github.com/vercel/next.js', 'vercel', 'next.js'],
    ['https://github.com/acme/.github', 'acme', '.github'],
    ['https://github.com/my-org/my_repo-2', 'my-org', 'my_repo-2'],
  ])('accepts %s', (url, owner, name) => {
    expect(parseRepoUrl(url)).toEqual({ owner, name });
  });

  it.each([
    // path traversal: the segments become <cloneDir>/<owner>/<name>
    'https://github.com/../src',
    'https://github.com/%2e%2e/src',
    'git@github.com:../src',
    'git@github.com:acme/..',
    'https://github.com/acme/..',
    // another host or protocol (SSRF / host confusion)
    'https://evil.example/github.com/acme/app',
    'http://169.254.169.254/latest/github.com/a/b',
    'file:///tmp/github.com/org/priv',
    'http://github.com/acme/app',
    'ssh://git@github.com/acme/app.git',
    'https://github.com.evil.example/acme/app',
    'https://github.com:8443/acme/app',
    // credentials, queries, fragments, extra segments
    'https://user:pass@github.com/acme/app',
    'https://github.com/acme/app?x=1',
    'https://github.com/acme/app#readme',
    'https://github.com/acme/app/tree/main',
    'https://github.com/acme',
    'https://github.com/acme/a%2Fb',
    'not a url',
  ])('rejects %s', (url) => {
    expect(() => parseRepoUrl(url)).toThrow(/Could not parse owner\/repo/);
  });
});

describe('canonicalCloneUrl', () => {
  it('builds the only URL a repo is cloned from, without credentials', () => {
    expect(canonicalCloneUrl('acme', 'app')).toBe('https://github.com/acme/app.git');
  });
});
