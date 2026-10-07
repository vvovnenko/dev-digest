import {
  Provider,
  type ConventionCandidate,
  type ConventionSkillCreate,
  type ConventionSkillDraft,
  type ConventionsState,
  type ConventionUpdate,
  type GitClient,
  type RepoRef,
  type Skill,
  type StructuredResult,
} from '@devdigest/shared';
import { usageOf } from '@devdigest/reviewer-core';
import {
  AppError,
  ConflictError,
  ExternalServiceError,
  NotFoundError,
  ValidationError,
} from '../../platform/errors.js';
import {
  buildSkillDraft,
  configCandidatePaths,
  conventionPatch,
  ConventionExtraction,
  ConventionScanJob,
  createdFromNote,
  evidenceFilesOf,
  finalizeCandidates,
  normalizeEvidencePath,
  verifyCandidates,
  type ConventionRecord,
  type ConventionRepo,
  type ConventionScanRecord,
} from './domain.js';
import { toCandidateDto, toSkillDto, toStateDto } from './helpers.js';
import { buildExtractionPrompt, type SampleFile } from './prompt.js';
import type { ConventionsDeps } from './ports.js';
import {
  CONVENTIONS_SCAN_JOB_KIND,
  EXTRACTION_MAX_RETRIES,
  EXTRACTION_MAX_TOKENS,
  EXTRACTION_SCHEMA_NAME,
  EXTRACTION_TIMEOUT_MS,
  INTERRUPTED_SCAN_ERROR,
  MAX_CONFIG_FILES,
  TOP_FILES,
} from './constants.js';

/**
 * Conventions Extractor — a cheap model proposes a repo's house conventions from
 * sampled files, code checks each citation against the real file, the user
 * accepts, rejects or edits the candidates, and the accepted ones become one
 * skill. A scan runs as a background job; its `convention_scans` row carries the
 * status the UI polls. One active scan per repo, held by a partial unique index.
 */
export class ConventionsService {
  constructor(private deps: ConventionsDeps) {}

  async state(workspaceId: string, repoId: string): Promise<ConventionsState> {
    await this.loadRepo(workspaceId, repoId);
    return this.stateOf(workspaceId, repoId);
  }

  /**
   * Run scan / Re-scan: queue a scan and the job that runs it, unless the repo
   * already has an active scan — then nothing changes. The guards answer at
   * once; the model call happens in `runScan`.
   */
  async startScan(workspaceId: string, repoId: string): Promise<ConventionsState> {
    const repo = await this.loadRepo(workspaceId, repoId);
    await this.scannableFiles(repo);
    if (await this.deps.store.activeScan(workspaceId, repo.id)) return this.stateOf(workspaceId, repo.id);

    const choice = await this.deps.model(workspaceId);
    const scan = await this.deps.store.insertQueuedScan({
      workspaceId,
      repoId: repo.id,
      provider: choice.provider,
      model: choice.model,
    });
    // A concurrent request queued one between the check and the insert.
    if (scan === 'active_exists') return this.stateOf(workspaceId, repo.id);

    const payload: ConventionScanJob = { scanId: scan.id, repoId: repo.id, workspaceId };
    let job: { id: string };
    try {
      job = await this.deps.jobs.enqueue(workspaceId, CONVENTIONS_SCAN_JOB_KIND, payload);
    } catch (err) {
      // E.g. 503 shutting_down: no job will ever run this scan.
      await this.deps.store.failScan(workspaceId, scan.id, { error: messageOf(err) });
      throw err;
    }
    await this.deps.store.setJobId(workspaceId, scan.id, job.id);
    return this.stateOf(workspaceId, repo.id);
  }

  /** Register the `conventions-scan` job handler once (at plugin registration). */
  registerScanJobHandler(): void {
    this.deps.jobs.register(CONVENTIONS_SCAN_JOB_KIND, (payload) => this.runScan(payload));
  }

  /**
   * The job: sample → prompt → model → evidence check → store, recorded on the
   * scan row. Pending candidates are replaced; decided ones stay. A scan that is
   * gone or no longer active (reaped by a restart) is left alone.
   *
   * It never throws once the scan is running: every failure — a missing key
   * (ConfigError, 500), a model error (502), an index that vanished (409) — is
   * written to the row as `failed`, with what the call billed. The JobRunner
   * retries a thrown 5xx twice (`platform/resilience.ts`), which would pay for
   * the model call three times. Only a malformed payload throws, as a 422 that
   * is not retried: there is no scan to record it on.
   */
  async runScan(payload: unknown): Promise<void> {
    const parsed = ConventionScanJob.safeParse(payload);
    if (!parsed.success) {
      throw new ValidationError('Malformed conventions-scan job payload', parsed.error.flatten());
    }
    const { workspaceId, scanId } = parsed.data;
    const scan = await this.deps.store.markRunning(workspaceId, scanId);
    if (!scan) return;
    try {
      await this.scan(workspaceId, scan);
    } catch (err) {
      await this.deps.store.failScan(workspaceId, scanId, { error: messageOf(err), usage: usageOf(err) });
    }
  }

  /** On boot: fail the scans a previous process left active — their jobs lived in its memory. */
  reapInterrupted(): Promise<number> {
    return this.deps.store.reapActiveScans(INTERRUPTED_SCAN_ERROR);
  }

  /** Accept / reject / back to pending, or an inline edit of the rule (its fingerprint stays). */
  async update(workspaceId: string, id: string, input: ConventionUpdate): Promise<ConventionCandidate> {
    const row = await this.deps.store.update(workspaceId, id, conventionPatch(input));
    if (!row) throw new NotFoundError('Convention not found');
    return toCandidateDto(row);
  }

  /** Every accepted candidate of the repo back to pending. */
  async deselectAll(workspaceId: string, repoId: string): Promise<{ updated: number }> {
    await this.loadRepo(workspaceId, repoId);
    return { updated: await this.deps.store.resetAccepted(workspaceId, repoId) };
  }

  /** The accepted candidates merged into one editable skill (nothing is written). */
  async skillDraft(workspaceId: string, repoId: string): Promise<ConventionSkillDraft> {
    const repo = await this.loadRepo(workspaceId, repoId);
    const accepted = await this.requireAccepted(workspaceId, repoId);
    const draft = buildSkillDraft({ repoName: repo.name, accepted });
    return {
      ...draft,
      accepted_count: accepted.length,
      name_taken: await this.deps.skills.nameExists(workspaceId, draft.name),
    };
  }

  /** The skill as the user edited the draft: source `extracted`, the accepted candidates' files as evidence. */
  async createSkill(workspaceId: string, repoId: string, input: ConventionSkillCreate): Promise<Skill> {
    const repo = await this.loadRepo(workspaceId, repoId);
    const accepted = await this.requireAccepted(workspaceId, repoId);
    const row = await this.deps.skills.insert(
      {
        workspaceId,
        name: input.name,
        description: input.description ?? '',
        type: input.type ?? 'convention',
        body: input.body,
        source: 'extracted',
        enabled: input.enabled ?? true,
        evidenceFiles: evidenceFilesOf(accepted),
      },
      createdFromNote(accepted.length, repo.name),
    );
    if (row === 'name_taken') {
      throw new ConflictError(`A skill named "${input.name}" already exists`, { field: 'name' });
    }
    return toSkillDto(row);
  }

  /** One scan, on the model its row names; throws whatever stops it. */
  private async scan(workspaceId: string, scan: ConventionScanRecord): Promise<void> {
    // Checked again: the clone or the index may have gone since the scan was queued.
    const repo = await this.loadRepo(workspaceId, scan.repoId);
    const top = await this.scannableFiles(repo);
    const git = this.deps.files();
    const ref: RepoRef = { owner: repo.owner, name: repo.name };
    const files = new Map<string, string>();

    const configs: SampleFile[] = [];
    for (const path of configCandidatePaths(top)) {
      if (configs.length >= MAX_CONFIG_FILES) break;
      const content = await readOrNull(git, ref, path);
      if (content !== null) configs.push({ path, content });
    }
    for (const f of configs) files.set(f.path, f.content);
    const sources: SampleFile[] = [];
    for (const raw of top) {
      const path = normalizeEvidencePath(raw);
      if (!path || files.has(path)) continue;
      const content = await readOrNull(git, ref, path);
      if (content === null) continue;
      sources.push({ path, content });
      files.set(path, content);
    }

    const decided = await this.deps.store.listDecided(workspaceId, repo.id);
    const { messages, sampleFiles } = buildExtractionPrompt({
      repoName: repo.name,
      files: [...configs, ...sources],
      decidedRules: decided.map((d) => d.rule),
    });

    const choice = { provider: Provider.parse(scan.provider), model: scan.model };
    let result: StructuredResult<ConventionExtraction>;
    try {
      const llm = await this.deps.llm(choice.provider);
      result = await llm.completeStructured({
        model: choice.model,
        schema: ConventionExtraction,
        schemaName: EXTRACTION_SCHEMA_NAME,
        messages,
        maxTokens: EXTRACTION_MAX_TOKENS,
        maxRetries: EXTRACTION_MAX_RETRIES,
        signal: AbortSignal.timeout(EXTRACTION_TIMEOUT_MS),
      });
    } catch (err) {
      // A missing key (ConfigError) or an adapter's own error already has its message (and its `usage`).
      if (err instanceof AppError) throw err;
      const timedOut = (err as { name?: string } | null)?.name === 'TimeoutError';
      // Keeps what the failed call billed (`LlmCallError.usage`) for the scan row.
      throw Object.assign(
        new ExternalServiceError(
          timedOut
            ? `The conventions model did not answer within ${EXTRACTION_TIMEOUT_MS / 1000} s`
            : `The conventions model call failed: ${messageOf(err)}`,
          { provider: choice.provider, model: choice.model },
        ),
        { usage: usageOf(err) },
      );
    }

    // A citation of a file the scan didn't sample is checked against that file, read once.
    const found = result.data.candidates;
    for (const c of found) {
      const path = normalizeEvidencePath(c.evidence.file);
      if (!path || files.has(path)) continue;
      files.set(path, (await readOrNull(git, ref, path)) ?? '');
    }

    const { kept, dropped } = verifyCandidates(found, files);
    const fingerprints = new Set(decided.map((d) => d.fingerprint).filter((f): f is string => !!f));
    const candidates = finalizeCandidates(kept, fingerprints);
    await this.deps.store.completeScan(
      workspaceId,
      scan.id,
      {
        sampleFiles,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costUsd: result.costUsd,
        candidatesFound: found.length,
        dropped,
      },
      candidates,
    );
  }

  /** The repo's top-ranked files; 409 while it isn't cloned or indexed. */
  private async scannableFiles(repo: ConventionRepo): Promise<string[]> {
    if (!repo.clonePath) {
      throw new ConflictError('The repo is not cloned yet — wait for the clone to finish', { reason: 'not_cloned' });
    }
    const top = await this.deps.samples.getConventionSamples(repo.id, TOP_FILES);
    if (top.length === 0) {
      throw new ConflictError('The repo has no indexed files yet — wait for indexing to finish', {
        reason: 'not_indexed',
      });
    }
    return top;
  }

  private async stateOf(workspaceId: string, repoId: string): Promise<ConventionsState> {
    const [done, latest, candidates] = await Promise.all([
      this.deps.store.latestDoneScan(workspaceId, repoId),
      this.deps.store.latestScan(workspaceId, repoId),
      this.deps.store.listVisible(workspaceId, repoId),
    ]);
    return toStateDto(done, latest, candidates);
  }

  private async loadRepo(workspaceId: string, repoId: string): Promise<ConventionRepo> {
    const repo = await this.deps.repos.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return repo;
  }

  private async requireAccepted(workspaceId: string, repoId: string): Promise<ConventionRecord[]> {
    const accepted = await this.deps.store.listAccepted(workspaceId, repoId);
    if (accepted.length === 0) {
      throw new ValidationError('Accept at least one convention first', { reason: 'no_accepted_conventions' });
    }
    return accepted;
  }
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** A file's text, or null when it is missing, unreadable, outside the clone or empty. */
async function readOrNull(git: GitClient, repo: RepoRef, path: string): Promise<string | null> {
  try {
    const content = await git.readFile(repo, path);
    return content.trim() === '' ? null : content;
  } catch {
    return null;
  }
}
