/**
 * Flow files are hand-written JSON, so the runner checks their shape before
 * running anything: a typo (a string `cmd`, a missing `steps`) fails up front
 * with the file and the field, instead of as an odd agent-browser error midway.
 * Hand-rolled on purpose — the e2e package has no runtime dependencies.
 */
import type { Flow } from "./assert.js";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Problems with one step, as "steps[i].field: what's wrong". */
function stepProblems(step: unknown, i: number): string[] {
  const at = `steps[${i}]`;
  if (!isRecord(step)) return [`${at}: must be an object`];
  const out: string[] = [];
  const { cmd, label, assert } = step;
  if (!Array.isArray(cmd) || cmd.length === 0 || !cmd.every((a) => typeof a === "string")) {
    out.push(`${at}.cmd: must be a non-empty array of strings`);
  }
  if (label !== undefined && typeof label !== "string") out.push(`${at}.label: must be a string`);
  if (assert !== undefined) {
    if (!isRecord(assert)) out.push(`${at}.assert: must be an object`);
    else if (assert.stdoutIncludes !== undefined && typeof assert.stdoutIncludes !== "string") {
      out.push(`${at}.assert.stdoutIncludes: must be a string`);
    }
  }
  return out;
}

/** Every problem with a parsed flow file; empty when it is a valid Flow. */
function flowProblems(data: unknown): string[] {
  if (!isRecord(data)) return ["must be a JSON object"];
  const out: string[] = [];
  if (typeof data.name !== "string" || data.name.trim() === "") out.push("name: must be a non-empty string");
  if (data.description !== undefined && typeof data.description !== "string") {
    out.push("description: must be a string");
  }
  if (!Array.isArray(data.steps) || data.steps.length === 0) out.push("steps: must be a non-empty array");
  else data.steps.forEach((s, i) => out.push(...stepProblems(s, i)));
  return out;
}

/** A parsed flow file, or everything wrong with it. */
export function parseFlow(data: unknown): { ok: true; flow: Flow } | { ok: false; problems: string[] } {
  const problems = flowProblems(data);
  return problems.length === 0 ? { ok: true, flow: data as Flow } : { ok: false, problems };
}
