/**
 * Engine test doubles — self-contained, so reviewer-core's suite never reaches
 * into server/ (it runs on its own in CI with only its own deps).
 */
import type { LLMProvider, StructuredRequest, StructuredResult, UnifiedDiff } from '@devdigest/shared';

/** One file; new-side line 11 is the added one (10 and 12 are context). */
export const CONFIG_DIFF: UnifiedDiff = {
  raw: [
    'diff --git a/src/config.ts b/src/config.ts',
    '--- a/src/config.ts',
    '+++ b/src/config.ts',
    '@@ -10,3 +10,4 @@',
    '   port: 3000,',
    '+  stripeKey: "sk_live_xxx",',
    '   redisUrl: x,',
  ].join('\n'),
  files: [
    {
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      hunks: [{ file: 'src/config.ts', oldStart: 10, oldLines: 3, newStart: 10, newLines: 4, newLineNumbers: [10, 11, 12] }],
    },
  ],
};

/** A provider that answers every structured call with `fixture`, parsed through the request's schema. */
export function fixtureLlm(fixture: unknown, id: LLMProvider['id'] = 'openai'): LLMProvider {
  return {
    id,
    async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
      const parsed = req.schema.safeParse(fixture);
      if (!parsed.success) throw new Error(`fixture failed schema: ${parsed.error.message}`);
      return {
        data: parsed.data as T,
        model: req.model,
        tokensIn: 100,
        tokensOut: 50,
        costUsd: 0.001,
        raw: JSON.stringify(fixture),
        attempts: 1,
      };
    },
    listModels: async () => [],
    complete: async () => {
      throw new Error('unused');
    },
    embed: async () => [],
  };
}
