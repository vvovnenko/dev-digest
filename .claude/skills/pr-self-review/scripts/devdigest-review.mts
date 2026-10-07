// DevDigest reviews itself: runs the product's own engine (reviewer-core) with
// its three built-in agents over a self-review run's diff, and records the
// grounded findings next to the skill reviewers'. Optional (`--with-devdigest`).
//
//   server/node_modules/.bin/tsx --tsconfig server/tsconfig.json \
//     .claude/skills/pr-self-review/scripts/devdigest-review.mts --run <id> [--agents general,security,performance]
//
// Prompts are the seeded ones (server/src/db/seed-prompts.ts, mirrored in
// docs/agent-prompts/); the model is the seed's default. The skills the plan
// routed are passed through the engine's `skills` slot. The key comes only from
// OPENROUTER_API_KEY in the environment — server/.env is never read; without it
// the run is skipped, not failed. Its findings are generic, so like third-party
// skills they block only as a bug or a vulnerability, after the same verifier.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseUnifiedDiff } from '../../../../server/src/adapters/git/diff-parser.ts';
import {
  GENERAL_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
} from '../../../../server/src/db/seed-prompts.ts';
import { reviewPullRequest, usageOf } from '../../../../reviewer-core/src/index.ts';
import { OpenRouterProvider } from '../../../../reviewer-core/src/llm/openrouter.ts';
// @ts-expect-error — plain .mjs helpers without type declarations
import { parseArgs, readJson, repoRoot, runDir, writeJsonAtomic } from './lib.mjs';
// @ts-expect-error — plain .mjs helpers without type declarations
import { normalizeFindings } from './verdict.mjs';

const AGENTS: Record<string, string> = {
  general: GENERAL_REVIEWER_PROMPT,
  security: SECURITY_REVIEWER_PROMPT,
  performance: PERFORMANCE_REVIEWER_PROMPT,
};
const SKILL_CHARS = 12_000;
const SKILLS_TOTAL = 40_000;

const args = parseArgs(process.argv.slice(2));
const root: string = repoRoot();
if (!args.run) {
  console.error('usage: devdigest-review.mts --run <run-id> [--agents general,security,performance]');
  process.exit(2);
}
const key = process.env.OPENROUTER_API_KEY;
if (!key) {
  console.log('devdigest: skipped — OPENROUTER_API_KEY is not set in the environment (server/.env is not read)');
  process.exit(0);
}

const dir: string = runDir(root, args.run);
const plan = readJson(join(dir, 'plan.json'));
const diffJson = readJson(join(dir, 'diff.json'));
const files = diffJson.files.filter((f: any) => !f.excluded && !f.binary && !f.generated && f.status !== 'D');
const diff = parseUnifiedDiff(files.map((f: any) => f.patch).join('\n'));

const seed = readFileSync(join(root, 'server/src/db/seed.ts'), 'utf8');
const model = /DEFAULT_MODEL\s*=\s*'([^']+)'/.exec(seed)?.[1] ?? 'deepseek/deepseek-v4-flash';

let budget = SKILLS_TOTAL;
const skills: string[] = [];
for (const s of plan.skills.filter((x: any) => x.kind === 'skill')) {
  const p = join(root, '.claude/skills', s.skill, 'SKILL.md');
  if (!existsSync(p) || budget <= 0) continue;
  const body = readFileSync(p, 'utf8').slice(0, Math.min(SKILL_CHARS, budget));
  budget -= body.length;
  skills.push(body);
}

const wanted = String(args.agents ?? 'general,security,performance').split(',').filter((a) => a in AGENTS);
const llm = new OpenRouterProvider(key, { timeoutMs: 120_000 });
const pseudoTask = (agent: string) => ({
  id: `devdigest-${agent}`,
  skill: `devdigest/${agent}`,
  origin: 'third-party',
  files: files.map((f: any) => ({ path: f.path })),
});

let cost = 0;
for (const agent of wanted) {
  try {
    const out = await reviewPullRequest({
      systemPrompt: AGENTS[agent]!,
      model,
      diff,
      llm,
      skills,
      task: `Self-review of branch ${plan.branch ?? plan.head_sha.slice(0, 12)} before opening a pull request`,
      sessionId: `pr-self-review-${plan.run_id}`,
    });
    cost += out.costUsd ?? 0;
    const findings = normalizeFindings(
      pseudoTask(agent),
      out.review.findings.map((f) => ({
        severity: f.severity,
        category: f.category,
        rule_id: `devdigest/${agent}-${f.category}`,
        title: f.title,
        file: f.file,
        start_line: f.start_line,
        end_line: f.end_line,
        rationale: f.rationale,
        suggestion: f.suggestion ?? null,
        confidence: f.confidence,
        introduced: true,
      })),
    );
    writeJsonAtomic(join(dir, 'findings', `devdigest-${agent}.json`), {
      task: `devdigest-${agent}`,
      skill: `devdigest/${agent}`,
      recorded_at: new Date().toISOString(),
      notes: `engine ${out.mode}, grounding ${out.grounding}, ${out.tokensIn}→${out.tokensOut} tokens`,
      findings,
    });
    console.log(`devdigest/${agent}: ${findings.length} grounded finding(s) · ${out.grounding} · $${(out.costUsd ?? 0).toFixed(4)}`);
  } catch (err: any) {
    const billed = usageOf(err)?.costUsd ?? 0;
    cost += billed;
    console.log(`devdigest/${agent}: skipped — ${err?.message ?? err}`);
  }
}

const metricsPath = join(dir, 'metrics.json');
const metrics = readJson(metricsPath, {});
metrics.devdigest_cost_usd = (metrics.devdigest_cost_usd ?? 0) + cost;
writeJsonAtomic(metricsPath, metrics);
console.log(`devdigest: total $${cost.toFixed(4)} (model ${model})`);
