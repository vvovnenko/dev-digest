import type {
  CompletionRequest,
  CompletionResult,
  LLMProvider,
  ModelInfo,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';

/**
 * FakeReviewLlm — a deterministic stand-in for every LLM provider, used by the
 * hermetic e2e stack (`DEVDIGEST_FAKE_LLM=1`, refused under production). No key,
 * no network. A structured review answers with one WARNING on the first added
 * line of the diff it was sent, so the finding survives grounding and the UI
 * has something to accept or reject. A short delay keeps the live log visible.
 */
export const FAKE_FINDING_TITLE = 'Fake finding on the first added line';
const FAKE_LATENCY_MS = 1500;

/** The intent the fake derives for any PR (deterministic; the code still caps its confidence). */
export const FAKE_INTENT = {
  summary: 'Deterministic intent from the fake LLM (DEVDIGEST_FAKE_LLM=1).',
  in_scope: ['The files this pull request changes'],
  out_of_scope: [],
  confidence: 'medium',
  missing_context: [],
};

/** The first added line of the first file in a unified diff embedded in `text`. */
export function firstAddedLine(text: string): { file: string; line: number } | null {
  let file: string | null = null;
  let next = 0; // new-side number of the next line in the current hunk
  let inHunk = false;
  for (const line of text.split('\n')) {
    const header = /^\+\+\+ b\/(.+)$/.exec(line);
    if (header) {
      file = header[1]!.trim();
      inHunk = false;
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      next = Number(hunk[1]);
      inHunk = file !== null;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith('+')) return { file: file!, line: next };
    if (line.startsWith(' ')) next++;
  }
  return null;
}

export class FakeReviewLlm implements LLMProvider {
  constructor(readonly id: LLMProvider['id']) {}

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    await new Promise((resolve) => setTimeout(resolve, FAKE_LATENCY_MS));
    const target = firstAddedLine(req.messages.map((m) => m.content).join('\n'));
    const review = {
      verdict: 'comment',
      summary: 'Deterministic review from the fake LLM (DEVDIGEST_FAKE_LLM=1).',
      score: 90,
      findings: target
        ? [
            {
              id: 'fake-1',
              severity: 'WARNING',
              category: 'bug',
              title: FAKE_FINDING_TITLE,
              file: target.file,
              start_line: target.line,
              end_line: target.line,
              rationale: 'The fake LLM flags the first added line of the diff.',
              confidence: 0.9,
              kind: 'finding',
            },
          ]
        : [],
    };
    // The first fixture the asked-for schema accepts: a review, or the intent of a PR.
    for (const fixture of [review, FAKE_INTENT]) {
      const parsed = req.schema.safeParse(fixture);
      if (parsed.success) {
        return {
          data: parsed.data,
          model: req.model,
          tokensIn: 10,
          tokensOut: 5,
          costUsd: 0,
          raw: JSON.stringify(fixture),
          attempts: 1,
        };
      }
    }
    throw new Error(`FakeReviewLlm: ${req.schemaName} rejected the fake answers`);
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    return { text: 'fake completion', model: req.model, tokensIn: 1, tokensOut: 1, costUsd: 0 };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: 'fake-model', provider: this.id === 'anthropic' ? 'anthropic' : 'openai' }];
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => new Array(1536).fill(0));
  }
}
