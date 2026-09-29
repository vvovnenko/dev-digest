// @ts-check
/**
 * Onion-architecture import boundaries for server/src and ../reviewer-core/src.
 * Why each rule exists and how to fix a violation: .claude/skills/onion-architecture/
 * (SKILL.md, references/enforcement.md).
 *
 *   pnpm arch           fails on any violation NOT in .dependency-cruiser-known-violations.json
 *   pnpm arch:stale     fails when the baseline still lists a violation that is gone
 *   pnpm arch:baseline  rewrites the baseline — only AFTER fixing; it may only lose entries
 *
 * Paths are relative to server/ (the cwd); reviewer-core files appear as ../reviewer-core/src/….
 * Rule names are baseline keys: renaming a rule re-reports its known violations as new.
 * A rule that uses $1 needs a single-string from.path with exactly ONE capturing group.
 */
const SKILL = 'Skill: onion-architecture';

/** npm package(s), resolved (…/node_modules/<pkg>/…) or unresolved (bare name). */
const npm = (...names) => {
  const alt = names.join('|');
  return `(?:^|/)node_modules/(?:${alt})/|^(?:${alt})(?:/|$)`;
};

const PERSISTENCE = npm('drizzle-orm', 'drizzle-kit', 'postgres');
const FASTIFY = npm('fastify', 'fastify-[^/]+', '@fastify/[^/]+');
const SDKS = npm(
  'openai',
  '@anthropic-ai/sdk',
  'octokit',
  '@octokit/[^/]+',
  'simple-git',
  '@ast-grep/napi',
  '@vscode/ripgrep',
  'dependency-cruiser',
  'js-tiktoken',
);
const DOTENV = npm('dotenv');
const ZOD = npm('zod');
const NODE_IO =
  '^(?:node:)?(?:fs|fs/promises|child_process|net|http|https|http2|dgram|dns|dns/promises|tls|cluster|worker_threads|os|process|readline|repl|vm|v8|inspector)$';

const DB = '^src/db/';
const ADAPTERS = '^src/adapters/';
const ROOT = '^src/(?:app|server)\\.ts$';
/** platform files that do I/O or wire things — application code gets them through ports. */
const PLATFORM_INFRA = '^src/platform/(?:container|jobs|config|sse)\\.ts$';
const KERNEL = ['^src/vendor/shared/', '^src/platform/errors\\.ts$'];

const MODULE = '^src/modules/[^/]+/';
const ROUTES = '^src/modules/[^/]+/routes(?:\\.ts$|/)';
const HTTP_HELPER = '^src/modules/_shared/context\\.ts$';
const SERVICE = '^src/modules/[^/]+/service(?:\\.ts$|/)';
const REPOSITORY = '^src/modules/[^/]+/(?:repository(?:\\.ts$|/)|.+\\.repo\\.ts$)';
const DOMAIN = '^src/modules/[^/]+/domain(?:\\.ts$|/)';
const PORTS = '^src/modules/[^/]+/ports(?:\\.ts$|/)';
const CORE = '^\\.\\./reviewer-core/src/';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'onion-domain-pure',
      severity: 'error',
      comment:
        'Domain (modules/<m>/domain.ts) is pure types + rules: it imports only its own domain, @devdigest/shared, platform/errors.ts and zod. No node:*, db, Drizzle, Fastify, adapters, container, ports or other modules — pass data and effects in as arguments. ' +
        SKILL +
        ' → Domain.',
      from: { path: '^src/modules/([^/]+)/domain(?:\\.ts$|/)' },
      to: { pathNot: ['^src/modules/$1/domain(?:\\.ts$|/)', ...KERNEL, ZOD] },
    },
    {
      name: 'onion-ports-pure',
      severity: 'error',
      comment:
        "Ports (modules/<m>/ports.ts) are the interfaces the service needs, typed only with the module's domain and @devdigest/shared — no Drizzle rows, Db/tx, SDK or Fastify types. " +
        SKILL +
        ' → Ports.',
      from: { path: '^src/modules/([^/]+)/ports(?:\\.ts$|/)' },
      to: { pathNot: ['^src/modules/$1/(?:domain|ports)(?:\\.ts$|/)', '^src/vendor/shared/'] },
    },
    {
      name: 'onion-app-no-infra',
      severity: 'error',
      comment:
        'Application code (service.ts and every other module file that is not routes/repository/domain/ports) depends on ports + domain, @devdigest/shared, pure platform helpers and @devdigest/reviewer-core. DB, repositories, adapters, SDKs, Fastify, fs/process I/O and the Container arrive as ports in the constructor, wired in platform/container.ts and the routes plugin. ' +
        SKILL +
        ' → Services.',
      from: { path: MODULE, pathNot: [ROUTES, HTTP_HELPER, REPOSITORY, DOMAIN, PORTS] },
      to: {
        path: [DB, PERSISTENCE, REPOSITORY, ADAPTERS, SDKS, FASTIFY, NODE_IO, DOTENV, PLATFORM_INFRA, ROOT],
      },
    },
    {
      name: 'onion-routes-http-only',
      severity: 'error',
      comment:
        'HTTP edge (routes.ts, _shared/context.ts): schema → getContext → service → status. No Drizzle/db, repository, adapter/SDK or fs I/O — move queries to repository.ts behind a port and logic to service.ts/domain.ts. ' +
        SKILL +
        ' → Routes.',
      from: { path: [ROUTES, HTTP_HELPER] },
      to: { path: [DB, PERSISTENCE, REPOSITORY, ADAPTERS, SDKS, NODE_IO, DOTENV] },
    },
    {
      name: 'onion-repo-persistence-only',
      severity: 'error',
      comment:
        "Repositories (repository.ts, repository/*.repo.ts) use Drizzle + db + their module's ports/domain. They never call services, routes, Fastify, adapters/SDKs or the Container. " +
        SKILL +
        ' → Persistence.',
      from: { path: REPOSITORY },
      to: { path: [ROUTES, SERVICE, FASTIFY, ADAPTERS, SDKS, PLATFORM_INFRA, ROOT] },
    },
    {
      name: 'onion-no-cross-module',
      severity: 'error',
      comment:
        "A module imports only its own files and modules/_shared/. Another module's data or behaviour comes through a port of yours, satisfied in the composition root; shared contracts live in @devdigest/shared. " +
        SKILL +
        ' → Ports.',
      from: { path: '^src/modules/([^/]+)/' },
      to: { path: '^src/modules/[^/]+/', pathNot: '^src/modules/(?:$1|_shared)/' },
    },
    {
      name: 'onion-adapters-outer-ring',
      severity: 'error',
      comment:
        'Adapters (src/adapters/<tech>/) implement ports for external systems; they must not know modules, db/Drizzle, Fastify or the composition root. A DB-backed port implementation is a repository. ' +
        SKILL +
        ' → Adapters.',
      from: { path: ADAPTERS },
      to: { path: ['^src/modules/', DB, PERSISTENCE, FASTIFY, PLATFORM_INFRA, ROOT] },
    },
    {
      name: 'onion-platform-no-features',
      severity: 'error',
      comment:
        'platform/ is cross-cutting; only platform/container.ts (the composition root) may import modules or adapters. ' +
        SKILL +
        ' → Composition root.',
      from: { path: '^src/platform/', pathNot: '^src/platform/container\\.ts$' },
      to: { path: ['^src/modules/', ADAPTERS, ROOT] },
    },
    {
      name: 'onion-kernel-pure',
      severity: 'error',
      comment:
        'Shared kernel (@devdigest/shared = src/vendor/shared, platform/errors.ts) is imported by every ring, so it imports only itself and zod. ' +
        SKILL +
        ' → In this repo.',
      from: { path: KERNEL },
      to: { pathNot: [...KERNEL, ZOD] },
    },
    {
      name: 'onion-db-no-upward',
      severity: 'error',
      comment:
        'src/db (client, schema, rows, seed, migrate) is a persistence detail: no modules, adapters, platform, Fastify or SDKs. ' +
        SKILL +
        ' → Persistence.',
      from: { path: DB },
      to: { path: ['^src/(?:modules|adapters|platform)/', ROOT, FASTIFY, SDKS] },
    },
    {
      name: 'onion-core-public-api-only',
      severity: 'error',
      comment:
        'server uses reviewer-core only through @devdigest/reviewer-core (reviewer-core/src/index.ts, the ' +
        'pure engine) and its one adapter, @devdigest/reviewer-core/llm/openrouter. ' +
        SKILL +
        ' → reviewer-core.',
      from: { path: '^src/' },
      to: {
        path: '^\\.\\./reviewer-core/',
        pathNot: '^\\.\\./reviewer-core/src/(index|llm/openrouter)\\.ts$',
      },
    },
    {
      name: 'onion-core-provider-in-root-only',
      severity: 'error',
      comment:
        "reviewer-core's network-bound OpenRouterProvider is built only in the composition root " +
        '(platform/container.ts); everything else gets an LLMProvider port. ' +
        SKILL +
        ' → reviewer-core.',
      from: { path: '^src/', pathNot: '^src/platform/container\\.ts$' },
      to: { path: '^\\.\\./reviewer-core/src/llm/openrouter\\.ts$' },
    },
    {
      name: 'core-no-server-src',
      severity: 'error',
      comment:
        'reviewer-core is the pure engine; the only server code it may import is @devdigest/shared. ' +
        SKILL +
        ' → reviewer-core.',
      from: { path: CORE },
      to: { path: '^src/', pathNot: '^src/vendor/shared/' },
    },
    {
      name: 'core-no-infra',
      severity: 'error',
      comment:
        'reviewer-core has no DB, filesystem, process, env or HTTP-framework access; its only I/O is an injected LLMProvider. ' +
        SKILL +
        ' → reviewer-core.',
      from: { path: CORE },
      to: {
        path: [
          PERSISTENCE,
          FASTIFY,
          npm(
            'octokit',
            '@octokit/[^/]+',
            'simple-git',
            '@anthropic-ai/sdk',
            '@ast-grep/napi',
            '@vscode/ripgrep',
            'js-tiktoken',
            'dependency-cruiser',
            'p-queue',
          ),
          DOTENV,
          NODE_IO,
        ],
      },
    },
    {
      name: 'core-llm-sdk-in-provider-only',
      severity: 'error',
      comment:
        'The OpenAI SDK client is network I/O: only the adapter src/llm/openrouter.ts may import it (openai/helpers/* schema helpers are fine). ' +
        SKILL +
        ' → reviewer-core.',
      from: { path: CORE, pathNot: '^\\.\\./reviewer-core/src/llm/openrouter\\.ts$' },
      to: { path: npm('openai'), pathNot: '(?:^|/)node_modules/openai/helpers/|^openai/helpers/' },
    },
    {
      name: 'no-orphans',
      severity: 'error',
      comment: 'A file that imports nothing and that nothing imports is dead code: delete it or wire it in.',
      from: { orphan: true, pathNot: ['\\.d\\.ts$'] },
      to: {},
    },
    {
      name: 'no-unreachable-from-entry',
      severity: 'error',
      comment:
        'Nothing the API or the db scripts run reaches this file, so it is dead code (tests are not ' +
        'cruised). Delete it, or wire it in. Exempt: the entry points themselves, the test doubles in ' +
        'adapters/mocks.ts, and settings/feature-models.ts, pre-staged for later lessons and covered ' +
        'by test/settings-models.it.test.ts.',
      from: { path: '^src/(?:server|db/migrate|db/seed)\\.ts$' },
      to: {
        path: '^(?:src/|\\.\\./reviewer-core/src/)',
        pathNot: [
          '^src/(?:server|db/migrate|db/seed)\\.ts$',
          '^src/adapters/mocks\\.ts$',
          '^src/modules/settings/feature-models\\.ts$',
        ],
        reachable: false,
      },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Import cycle (type-only imports count): two files or rings depend on each other. Invert one edge with a port. ' +
        SKILL +
        ' → Principles.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment:
        'Unresolvable import. For ../reviewer-core run `npm ci` in reviewer-core first. Never baseline this rule — unresolved paths change baseline keys. ' +
        SKILL +
        ' → Enforcement.',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // Anchored on purpose: exclude also matches resolved node_modules paths, so a bare `dist/`
    // would silently drop every import of a package whose entry lives in dist/ (p-queue, simple-git).
    exclude: { path: ['^clones/', '^dist/', '^src/db/migrations/', '\\.test\\.ts$'] },
    // `import type` edges count: a type-only import of Db, Container or a Drizzle row still couples rings.
    tsPreCompilationDeps: true,
    // Resolves the @devdigest/shared and @devdigest/reviewer-core path aliases.
    tsConfig: { fileName: 'tsconfig.json' },
    // pnpm lays node_modules out isolated (symlinks into .pnpm/) or hoisted (server/.npmrc) depending
    // on the pnpm version; without this the baseline keys differ between machines and CI.
    preserveSymlinks: true,
    enhancedResolveOptions: {
      // p-queue and octokit have only an "exports" field, no "main".
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },
    skipAnalysisNotInRules: true,
    progress: { type: 'none' },
  },
};
