/**
 * DevDigest web e2e runner — Vercel agent-browser, deterministic, no LLM.
 *
 * agent-browser is a CDP browser-automation CLI (not a test framework), so we
 * define a thin convention: each flow is a `specs/*.flow.json` file listing
 * agent-browser commands. Every flow file is validated before anything runs.
 * Each flow gets its own browser session (`--session <flow id>`, closed when the
 * flow ends), so cookies, storage and the open page never leak into the next
 * flow; within a flow the daemon keeps the page between commands. A command that
 * exits non-zero — including a `wait --text` / `wait --url` whose condition never
 * holds — fails the step and the flow, and its whole output is printed. We add
 * only light substring checks on top.
 *
 * Env:
 *   E2E_BASE_URL       web app origin (default http://localhost:3000)
 *   AGENT_BROWSER_BIN  binary name/path (default "agent-browser")
 *   E2E_STEP_TIMEOUT   per-command timeout in ms (default 60000)
 *
 * Specs target seeded data; the API they run against answers reviews with a
 * fake LLM in the hermetic stack (DEVDIGEST_FAKE_LLM=1), so nothing needs an
 * API key. Run order is the lexical order of the spec filenames.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  resolveArgs,
  stdoutContains,
  summarize,
  type Flow,
  type FlowResult,
  type StepResult,
} from "./lib/assert.js";
import { parseFlow } from "./lib/flow.js";

const exec = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const SPECS_DIR = join(HERE, "specs");
const RESULTS_DIR = join(HERE, "test-results");

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const BIN = process.env.AGENT_BROWSER_BIN ?? "agent-browser";
const STEP_TIMEOUT = Number(process.env.E2E_STEP_TIMEOUT ?? 60_000);

/** Run one agent-browser command in `session`; resolve with its stdout, reject on non-zero exit. */
async function ab(session: string, args: string[]): Promise<string> {
  const { stdout } = await exec(BIN, ["--session", session, ...args], {
    cwd: HERE,
    timeout: STEP_TIMEOUT,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout ?? "";
}

/** Everything a failed command said — the first line alone rarely explains it. */
function failureDetail(e: unknown): string {
  const err = e as Error & { stdout?: string; stderr?: string; killed?: boolean };
  // execFile's message repeats stderr after its first line; print each stream once, labelled.
  const parts = [err.killed ? `timed out after ${STEP_TIMEOUT} ms` : (err.message.split("\n")[0] ?? "")];
  if (err.stderr?.trim()) parts.push(`stderr:\n${err.stderr.trimEnd()}`);
  if (err.stdout?.trim()) parts.push(`stdout:\n${err.stdout.trimEnd()}`);
  return parts.join("\n");
}

const indent = (text: string, pad = "      ") => text.replace(/^/gm, pad);

/** Every flow file, parsed and validated; exits before running anything if one is malformed. */
function loadFlows(): { file: string; flow: Flow }[] {
  const flows: { file: string; flow: Flow }[] = [];
  const invalid: string[] = [];
  for (const file of readdirSync(SPECS_DIR).filter((f) => f.endsWith(".flow.json")).sort()) {
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(join(SPECS_DIR, file), "utf8"));
    } catch (e) {
      invalid.push(`${file}: not valid JSON — ${(e as Error).message}`);
      continue;
    }
    const parsed = parseFlow(data);
    if (parsed.ok) flows.push({ file, flow: parsed.flow });
    else invalid.push(`${file}:\n${parsed.problems.map((p) => `  - ${p}`).join("\n")}`);
  }
  if (invalid.length > 0) {
    console.error(`Invalid flow file(s) in ${SPECS_DIR}:\n${invalid.join("\n")}`);
    process.exit(1);
  }
  return flows;
}

async function runFlow(file: string, flow: Flow): Promise<FlowResult> {
  const id = file.replace(/\.flow\.json$/, "");
  console.log(`\n▶ ${flow.name}  (${file})`);
  const steps: StepResult[] = [];

  try {
    for (const step of flow.steps) {
      const args = resolveArgs(step.cmd, BASE);
      const label = step.label ?? args.join(" ");
      try {
        const stdout = await ab(id, args);
        if (step.assert?.stdoutIncludes && !stdoutContains(stdout, step.assert.stdoutIncludes)) {
          const detail = `stdout missing "${step.assert.stdoutIncludes}"\nstdout:\n${stdout.trimEnd()}`;
          steps.push({ label, ok: false, detail });
          console.log(`   ✗ ${label} — assertion failed\n${indent(detail)}`);
          break;
        }
        steps.push({ label, ok: true });
        console.log(`   ✓ ${label}`);
      } catch (e) {
        const detail = failureDetail(e);
        steps.push({ label, ok: false, detail: detail.split("\n")[0] ?? "" });
        console.log(`   ✗ ${label}\n${indent(detail)}`);
        // Best-effort failure screenshot for the artifact upload.
        mkdirSync(RESULTS_DIR, { recursive: true });
        await ab(id, ["screenshot", join(RESULTS_DIR, `${id}-fail.png`)]).catch(() => {});
        break;
      }
    }
  } finally {
    // One session per flow: tear it down whatever happened.
    await ab(id, ["close"]).catch(() => {});
  }

  const ok = steps.every((s) => s.ok);
  return { name: flow.name, ok, steps };
}

async function main(): Promise<void> {
  console.log(`DevDigest e2e — base=${BASE} bin=${BIN}`);
  const flows = loadFlows();
  if (flows.length === 0) {
    console.error(`No specs found in ${SPECS_DIR}`);
    process.exit(1);
  }

  const results: FlowResult[] = [];
  for (const { file, flow } of flows) {
    results.push(await runFlow(file, flow));
  }

  console.log(`\n${summarize(results)}`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

main().catch((e) => {
  console.error(`e2e runner crashed: ${(e as Error).message}`);
  process.exit(1);
});
