import type {
  FeatureModelChoice,
  GitClient,
  LLMProvider,
  Provider,
  SkillSource,
  SkillType,
} from '@devdigest/shared';
import type {
  ConventionPatch,
  ConventionRecord,
  ConventionRepo,
  ConventionScanFailure,
  ConventionScanRecord,
  ConventionScanResult,
  FinalCandidate,
  NewConventionScan,
} from './domain.js';

/** The conventions repository. Every method but the boot reaper is scoped to the workspace. */
export interface ConventionStore {
  /** The newest scan of the repo, whatever its status. */
  latestScan(workspaceId: string, repoId: string): Promise<ConventionScanRecord | undefined>;
  /** The newest `done` scan: what the visible candidates came from. */
  latestDoneScan(workspaceId: string, repoId: string): Promise<ConventionScanRecord | undefined>;
  /** The repo's `queued` or `running` scan (at most one). */
  activeScan(workspaceId: string, repoId: string): Promise<ConventionScanRecord | undefined>;
  /** A new `queued` scan; `active_exists` when the repo already has an active one (a concurrent request won). */
  insertQueuedScan(scan: NewConventionScan): Promise<ConventionScanRecord | 'active_exists'>;
  /** Records the job that runs the scan. */
  setJobId(workspaceId: string, scanId: string, jobId: string): Promise<void>;
  /** An active scan → `running` (started now); undefined when it is gone or no longer active. */
  markRunning(workspaceId: string, scanId: string): Promise<ConventionScanRecord | undefined>;
  /**
   * One transaction, only while the scan is still `running`: drop the repo's
   * pending candidates, add `candidates` (a fingerprint the repo already has is
   * skipped) and mark the scan `done` with its result and how many were added.
   * Undefined (nothing written) when the scan is no longer running.
   */
  completeScan(
    workspaceId: string,
    scanId: string,
    result: ConventionScanResult,
    candidates: FinalCandidate[],
  ): Promise<ConventionScanRecord | undefined>;
  /** An active scan → `failed` with why and what it billed; a finished scan is left as it is. */
  failScan(workspaceId: string, scanId: string, failure: ConventionScanFailure): Promise<void>;
  /** Every workspace's active scans → `failed` with `error`; how many (boot: their jobs died with the old process). */
  reapActiveScans(error: string): Promise<number>;
  /** Pending and accepted candidates, most confident first. */
  listVisible(workspaceId: string, repoId: string): Promise<ConventionRecord[]>;
  /** Accepted candidates, most confident first. */
  listAccepted(workspaceId: string, repoId: string): Promise<ConventionRecord[]>;
  /** Accepted and rejected candidates: what a re-scan must not propose again. */
  listDecided(workspaceId: string, repoId: string): Promise<ConventionRecord[]>;
  /** Undefined when the candidate isn't in the workspace. */
  update(workspaceId: string, id: string, patch: ConventionPatch): Promise<ConventionRecord | undefined>;
  /** Accepted → pending for the repo; how many changed. */
  resetAccepted(workspaceId: string, repoId: string): Promise<number>;
}

/** The repos a scan addresses (the repos repository). */
export interface RepoLookup {
  getById(workspaceId: string, id: string): Promise<ConventionRepo | undefined>;
}

/** Which files to sample (the repo-intel facade): top-ranked, tests and configs filtered out. */
export interface ConventionSampler {
  getConventionSamples(repoId: string, n: number): Promise<string[]>;
}

/** A skill as the conventions module creates it. */
export interface NewConventionSkill {
  workspaceId: string;
  name: string;
  description: string;
  type: SkillType;
  body: string;
  source: SkillSource;
  enabled: boolean;
  evidenceFiles: string[];
}

/** A stored skill, as much as the reply needs. */
export interface CreatedSkill {
  id: string;
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  enabled: boolean;
  version: number;
  evidenceFiles: string[] | null;
}

/** Writes the skill (the skills repository, structurally): v1 and its snapshot together. */
export interface ConventionSkillWriter {
  nameExists(workspaceId: string, name: string): Promise<boolean>;
  insert(values: NewConventionSkill, note: string): Promise<CreatedSkill | 'name_taken'>;
}

/** Background work, as this module uses the JobRunner (structurally). */
export interface JobQueue {
  register(kind: string, handler: (payload: unknown, ctx: { jobId: string }) => Promise<void>): void;
  /** Resolves once the job row exists; the job runs later, behind the repo's other jobs. */
  enqueue(workspaceId: string, kind: string, payload: unknown): Promise<{ id: string }>;
}

export interface ConventionsDeps {
  store: ConventionStore;
  repos: RepoLookup;
  samples: ConventionSampler;
  /** Reads files of a clone; `readFile` stays inside it and rejects on a missing file. */
  files: () => GitClient;
  /** Resolves a provider's client; throws `ConfigError` when its key isn't configured. */
  llm: (provider: Provider) => Promise<LLMProvider>;
  /** The workspace's model for the `conventions` feature (Settings → Models, else the default). */
  model: (workspaceId: string) => Promise<FeatureModelChoice>;
  skills: ConventionSkillWriter;
  /** Runs a scan as a `conventions-scan` job. */
  jobs: JobQueue;
}
