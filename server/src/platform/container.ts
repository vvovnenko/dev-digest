import type {
  AuthProvider,
  SecretsProvider,
  GitHubClient,
  GitClient,
  CodeIndex,
  Embedder,
  LLMProvider,
  ConnTestProvider,
  FeatureModelChoice,
  FeatureModelId,
} from '@devdigest/shared';
import type { AppConfig } from './config.js';
import type { Db } from '../db/client.js';
import PQueue from 'p-queue';
import { JobRunner } from './jobs.js';
import { RunBus } from './sse.js';
import { LocalSecretsProvider } from '../adapters/secrets/local.js';
import { LocalNoAuthProvider } from '../adapters/auth/local.js';
import { OctokitGitHubClient, type AdapterLog } from '../adapters/github/octokit.js';
import { SimpleGitClient } from '../adapters/git/simple-git.js';
import { PrDiffSource } from '../adapters/git/pr-diff.js';
import { RipgrepCodeIndex } from '../adapters/codeindex/ripgrep.js';
import { OpenAIProvider } from '../adapters/llm/openai.js';
import { AnthropicProvider } from '../adapters/llm/anthropic.js';
import { FakeReviewLlm } from '../adapters/llm/fake.js';
import { OpenAIEmbedder } from '../adapters/embedder/openai.js';
import { OpenRouterProvider } from '@devdigest/reviewer-core/llm/openrouter.js';
import { estimateCost } from '../adapters/llm/pricing.js';
import { PriceBook } from './price-book.js';
import { ConfigError } from './errors.js';
import { AgentsRepository } from '../modules/agents/repository.js';
import { SkillsRepository } from '../modules/skills/repository.js';
import { ReviewRepository } from '../modules/reviews/repository.js';
import { PullsRepository } from '../modules/pulls/repository.js';
import { SettingsRepository } from '../modules/settings/repository.js';
import { resolveFeatureModel } from '../modules/settings/feature-models.js';
import { ConventionsRepository } from '../modules/conventions/repository.js';
import { WorkspaceRepository } from '../modules/workspace/repository.js';
import { RepoRepository } from '../modules/repos/repository.js';
import type { RepoIndexing } from '../modules/repos/ports.js';
import { INDEX_JOB_KIND, REFRESH_JOB_KIND } from '../modules/repo-intel/constants.js';
import { DEFAULT_WORKSPACE_NAME, SYSTEM_USER_EMAIL } from '../db/seed.js';
import type { RepoIntel } from '../modules/repo-intel/types.js';
import { RepoIntelService } from '../modules/repo-intel/service.js';
import { type DepGraph, DepCruiseGraph } from '../adapters/depgraph/index.js';
import { type Tokenizer, TiktokenTokenizer } from '../adapters/tokenizer/index.js';
import { SafeHttpsFetcher, type UrlFetcher } from '../adapters/http/safe-fetch.js';

/**
 * DI container. One per app instance. Holds config, db, the JobRunner,
 * the SSE bus, and lazily-constructed adapters resolved through SecretsProvider.
 *
 * Tests construct a container with `overrides` to inject mock adapters; the
 * Services depend on these interfaces, not the concrete classes.
 */
export interface ContainerOverrides {
  secrets?: SecretsProvider;
  auth?: AuthProvider;
  github?: GitHubClient;
  git?: GitClient;
  codeIndex?: CodeIndex;
  embedder?: Embedder;
  /** Pre-built providers by id (skip key lookup). */
  llm?: Partial<Record<'openai' | 'anthropic' | 'openrouter', LLMProvider>>;
  /** repo-intel facade (T1.1+) — tests inject mock RepoIntel implementations. */
  repoIntel?: RepoIntel;
  /** repo-intel T3 adapters — only the indexer pipeline reads these. */
  depgraph?: DepGraph;
  tokenizer?: Tokenizer;
  /** Tests pass a bus with a short buffer TTL. */
  runBus?: RunBus;
  /** Skill URL import — tests pass a `MockUrlFetcher` (no network). */
  urlFetcher?: UrlFetcher;
}

export class Container {
  readonly config: AppConfig;
  readonly db: Db;
  readonly secrets: SecretsProvider;
  readonly auth: AuthProvider;
  readonly jobs: JobRunner;
  readonly runBus: RunBus;
  /** Review requests wait here for one of `REVIEW_CONCURRENCY` slots. */
  readonly reviewQueue: PQueue;

  private _git?: GitClient;
  private _github: GitHubClient | undefined;
  private _codeIndex?: CodeIndex;
  private _embedder: Embedder | undefined;
  private llmCache = new Map<string, LLMProvider>();

  // Shared repositories for cross-cutting entities (agents, reviews/pulls,
  // runs). Constructed here, in the composition root, so consuming modules use
  // `container.agentsRepo` instead of reaching into another module's folder.
  private _agentsRepo?: AgentsRepository;
  private _skillsRepo?: SkillsRepository;
  private _reviewRepo?: ReviewRepository;
  private _pullsRepo?: PullsRepository;
  private _settingsRepo?: SettingsRepository;
  private _workspaceRepo?: WorkspaceRepository;
  private _reposRepo?: RepoRepository;
  private _conventionsRepo?: ConventionsRepository;
  private _prDiffs?: PrDiffSource;
  private _repoIntel?: RepoIntel;
  private _depgraph?: DepGraph;
  private _tokenizer?: Tokenizer;
  private _priceBook?: PriceBook;

  constructor(
    config: AppConfig,
    db: Db,
    private overrides: ContainerOverrides = {},
    /** The app's logger, for adapters that report a degraded path (`app.log`). */
    private log?: AdapterLog,
  ) {
    this.config = config;
    this.db = db;
    this.secrets = overrides.secrets ?? new LocalSecretsProvider(config.secretsPath);
    this.auth =
      overrides.auth ??
      new LocalNoAuthProvider(this.workspaceRepo, { email: SYSTEM_USER_EMAIL, workspaceName: DEFAULT_WORKSPACE_NAME });
    // One bus per app: closing one app must not end another app's streams.
    this.runBus = overrides.runBus ?? new RunBus();
    this.jobs = new JobRunner(db);
    this.reviewQueue = new PQueue({ concurrency: config.reviewConcurrency });
  }

  get git(): GitClient {
    if (this.overrides.git) return this.overrides.git;
    this._git ??= new SimpleGitClient(this.config.cloneDir, () => this.secrets.get('GITHUB_TOKEN'));
    return this._git;
  }

  get agentsRepo(): AgentsRepository {
    return (this._agentsRepo ??= new AgentsRepository(this.db));
  }

  get skillsRepo(): SkillsRepository {
    return (this._skillsRepo ??= new SkillsRepository(this.db));
  }

  get reviewRepo(): ReviewRepository {
    return (this._reviewRepo ??= new ReviewRepository(this.db));
  }

  get pullsRepo(): PullsRepository {
    return (this._pullsRepo ??= new PullsRepository(this.db));
  }

  get settingsRepo(): SettingsRepository {
    return (this._settingsRepo ??= new SettingsRepository(this.db));
  }

  get workspaceRepo(): WorkspaceRepository {
    return (this._workspaceRepo ??= new WorkspaceRepository(this.db));
  }

  /** The diff a review runs on: git when the clone has it, else the stored pr_files patches. */
  get prDiffs(): PrDiffSource {
    return (this._prDiffs ??= new PrDiffSource(
      () => this.git,
      (prId) => this.reviewRepo.getPrFiles(prId),
    ));
  }

  get reposRepo(): RepoRepository {
    return (this._reposRepo ??= new RepoRepository(this.db));
  }

  get conventionsRepo(): ConventionsRepository {
    return (this._conventionsRepo ??= new ConventionsRepository(this.db));
  }

  /** The provider + model a system LLM feature runs on: the workspace's Settings choice, else the registry default. */
  featureModel(workspaceId: string, id: FeatureModelId): Promise<FeatureModelChoice> {
    return resolveFeatureModel(this.settingsRepo, workspaceId, id);
  }

  /** Repos asks repo-intel to index a clone through its own job kinds, which only this root knows. */
  get repoIndexing(): RepoIndexing {
    return {
      index: async (workspaceId, repo) => {
        await this.jobs.enqueue(workspaceId, INDEX_JOB_KIND, repo);
      },
      refresh: async (workspaceId, repo) => {
        await this.jobs.enqueue(workspaceId, REFRESH_JOB_KIND, repo);
      },
    };
  }

  get codeIndex(): CodeIndex {
    if (this.overrides.codeIndex) return this.overrides.codeIndex;
    this._codeIndex ??= new RipgrepCodeIndex(this.git);
    return this._codeIndex;
  }

  /**
   * The repo-intel facade (T1.1). All higher-level features (reviews,
   * blast/onboarding migrations, phantom-gate) code against this interface.
   * Tests inject a mock via `ContainerOverrides.repoIntel`.
   */
  get repoIntel(): RepoIntel {
    if (this.overrides.repoIntel) return this.overrides.repoIntel;
    this._repoIntel ??= new RepoIntelService(this);
    return this._repoIntel;
  }

  /** Import-graph builder (dependency-cruiser). T3 indexer pipeline only. */
  get depgraph(): DepGraph {
    if (this.overrides.depgraph) return this.overrides.depgraph;
    this._depgraph ??= new DepCruiseGraph();
    return this._depgraph;
  }

  /** Token counter (js-tiktoken) for the repo-map budget search. */
  get tokenizer(): Tokenizer {
    if (this.overrides.tokenizer) return this.overrides.tokenizer;
    this._tokenizer ??= new TiktokenTokenizer();
    return this._tokenizer;
  }

  /**
   * Live OpenRouter pricing for cost attribution. The lister builds a bare
   * OpenRouter provider just for `/models` (no estimator needed) and degrades to
   * `[]` when no key is configured; the static `estimateCost` table is the
   * fallback for a model the catalog doesn't price and a cold/cold-failed cache.
   * Every LLM adapter gets `estimatorFor(its id)`, OpenAI/Anthropic models priced
   * under their catalog alias.
   */
  get priceBook(): PriceBook {
    this._priceBook ??= new PriceBook(async () => {
      try {
        const key = await this.secrets.get('OPENROUTER_API_KEY');
        if (!key) return [];
        return await new OpenRouterProvider(key).listModels();
      } catch {
        return [];
      }
    }, estimateCost);
    return this._priceBook;
  }

  async github(): Promise<GitHubClient> {
    if (this.overrides.github) return this.overrides.github;
    if (this._github) return this._github;
    const token = await this.secrets.get('GITHUB_TOKEN');
    if (!token) throw new ConfigError('GITHUB_TOKEN is not configured');
    this._github = new OctokitGitHubClient(token, { log: this.log });
    return this._github;
  }

  /** Resolve an LLM provider by id; constructs from the secret key, cached. */
  async llm(id: 'openai' | 'anthropic' | 'openrouter'): Promise<LLMProvider> {
    const injected = this.overrides.llm?.[id];
    if (injected) return injected;
    const cached = this.llmCache.get(id);
    if (cached) return cached;
    const provider = this.config.fakeLlm ? new FakeReviewLlm(id) : await this.buildLlm(id);
    this.llmCache.set(id, provider);
    return provider;
  }

  /** Build an LLM provider from `candidateKey`, or from the stored secret when none is given. */
  private async buildLlm(
    id: 'openai' | 'anthropic' | 'openrouter',
    candidateKey?: string,
  ): Promise<LLMProvider> {
    if (id === 'openai') {
      const key = candidateKey ?? (await this.secrets.get('OPENAI_API_KEY'));
      if (!key) throw new ConfigError('OPENAI_API_KEY is not configured');
      return new OpenAIProvider(key, { estimateCost: this.priceBook.estimatorFor('openai') });
    }
    if (id === 'openrouter') {
      // Single OpenRouter provider lives in reviewer-core (shared with the CI
      // runner); inject the PriceBook so cost attribution uses LIVE OpenRouter
      // prices (with the static table as a fallback) rather than a hardcoded one.
      const key = candidateKey ?? (await this.secrets.get('OPENROUTER_API_KEY'));
      if (!key) throw new ConfigError('OPENROUTER_API_KEY is not configured');
      return new OpenRouterProvider(key, { estimateCost: this.priceBook.estimatorFor('openrouter') });
    }
    const key = candidateKey ?? (await this.secrets.get('ANTHROPIC_API_KEY'));
    if (!key) throw new ConfigError('ANTHROPIC_API_KEY is not configured');
    // The Messages API returns no cost: price its tokens from the PriceBook too.
    return new AnthropicProvider(key, { estimateCost: this.priceBook.estimatorFor('anthropic') });
  }

  /**
   * Test credentials WITHOUT saving them: a candidate `key` is tried on a fresh,
   * uncached client; without one, the stored key is. Returns a short success
   * message and throws whatever the provider throws.
   */
  async checkCredentials(provider: ConnTestProvider, key?: string): Promise<string> {
    if (provider === 'github') {
      const gh = key ? (this.overrides.github ?? new OctokitGitHubClient(key, { log: this.log })) : await this.github();
      return `Connected as @${await gh.currentLogin()}`;
    }
    const llm = key ? (this.overrides.llm?.[provider] ?? (await this.buildLlm(provider, key))) : await this.llm(provider);
    const models = await llm.listModels();
    return `OK — ${models.length} models available`;
  }

  async embedder(): Promise<Embedder> {
    // Injected embedders (tests) always win. Otherwise embeddings are gated by
    // config: when disabled we throw BEFORE constructing the OpenAI client, so
    // the app makes ZERO OpenAI requests. All callers wrap this in try/catch and
    // degrade gracefully (memory/RAG simply returns no hits).
    if (this.overrides.embedder) return this.overrides.embedder;
    if (!this.config.embeddingsEnabled) {
      throw new ConfigError('Embeddings are disabled (set EMBEDDINGS_ENABLED=true to enable memory/RAG)');
    }
    if (this._embedder) return this._embedder;
    const openai = await this.llm('openai');
    this._embedder = new OpenAIEmbedder(openai);
    return this._embedder;
  }

  /**
   * Drop cached provider clients so the next resolve picks up changed secrets.
   * Call after persisting a new API key/PAT via SecretsProvider.set.
   */
  invalidateSecretCaches(): void {
    this.llmCache.clear();
    this._github = undefined;
    this._embedder = undefined;
  }

  private _urlFetcher?: UrlFetcher;

  /** Fetches skill files for URL import: https only, public addresses, size-capped (SSRF guard). */
  get urlFetcher(): UrlFetcher {
    if (this.overrides.urlFetcher) return this.overrides.urlFetcher;
    return (this._urlFetcher ??= new SafeHttpsFetcher());
  }
}
