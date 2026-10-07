import type { AgentSkillLink, AgentSkillLinkInput, Skill } from "@devdigest/shared";

/** One row of the agent's Skills tab: a workspace skill and whether this agent uses it. */
export interface SkillRow {
  skill: Skill;
  /** Linked AND enabled for this agent (the toggle). */
  enabled: boolean;
}

/**
 * The live rows (`isRowLive`) as one block on top, in their current order, then every
 * other row by name. A drop only lands on a live row, so a live row below rows that
 * are off could never reach the top; their relative order is the prompt order, so
 * regrouping never changes the prompt.
 */
function liveFirst(rows: readonly SkillRow[]): SkillRow[] {
  const live = rows.filter(isRowLive);
  const rest = rows.filter((r) => !isRowLive(r)).sort((a, b) => a.skill.name.localeCompare(b.skill.name));
  return [...live, ...rest];
}

/**
 * Every workspace skill as one ordered list: the agent's live links in their saved
 * order first (a link whose skill was deleted is dropped), then every other skill —
 * linked but off, blocked, or never linked — by name (`liveFirst`).
 */
export function mergeAgentSkills(skills: readonly Skill[], links: readonly AgentSkillLink[]): SkillRow[] {
  const byId = new Map(skills.map((sk) => [sk.id, sk]));
  const linked: SkillRow[] = [...links]
    .sort((a, b) => a.order - b.order)
    .flatMap((l) => {
      const skill = byId.get(l.skill_id);
      return skill ? [{ skill, enabled: l.enabled }] : [];
    });
  const linkedIds = new Set(linked.map((r) => r.skill.id));
  const rest = skills.filter((sk) => !linkedIds.has(sk.id)).map((skill) => ({ skill, enabled: false }));
  return liveFirst([...linked, ...rest]);
}

/** The full ordered body of `POST /agents/:id/skills` — array order is prompt order. */
export function toLinks(rows: readonly SkillRow[]): AgentSkillLinkInput[] {
  return rows.map((r) => ({ skill_id: r.skill.id, enabled: r.enabled }));
}

/** Move the item at `from` to `to` (both indexes in `items`); out of range → unchanged copy. */
export function moveRow<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}

/**
 * Flip one skill's toggle: a row turned on joins the end of the live block on top, a row
 * turned off goes back among the rest by name (`liveFirst`); a blocked row (`isRowLive`)
 * stays as it is.
 */
export function toggleRow(rows: readonly SkillRow[], skillId: string): SkillRow[] {
  return liveFirst(
    rows.map((r) => (r.skill.id === skillId && !r.skill.injection_detected ? { ...r, enabled: !r.enabled } : r)),
  );
}

/** Rows whose name, description or type contains the query (case-insensitive). */
export function filterRows(rows: readonly SkillRow[], query: string): SkillRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
  return rows.filter(({ skill }) =>
    [skill.name, skill.description, skill.type].some((field) => field.toLowerCase().includes(q)),
  );
}

/**
 * Whether the row's toggle shows on: enabled for this agent AND its skill not blocked for prompt
 * injection. A blocked row shows off but keeps its stored flag, which `toLinks` sends.
 * Only live rows can be dragged or keyboard-moved — the others never reach the prompt.
 */
export function isRowLive(row: SkillRow): boolean {
  return row.enabled && !row.skill.injection_detected;
}

/**
 * Index of the nearest live row before (`step` -1) or after (`step` 1) `from`, or `from`
 * when there is none — a keyboard move steps over rows that never reach the prompt.
 */
export function nextLiveIndex(rows: readonly SkillRow[], from: number, step: -1 | 1): number {
  for (let i = from + step; i >= 0 && i < rows.length; i += step) {
    if (isRowLive(rows[i]!)) return i;
  }
  return from;
}

/** How many rows are live (`isRowLive`) — the "N of M enabled" pill. */
export function countEnabled(rows: readonly SkillRow[]): number {
  return rows.filter(isRowLive).length;
}

/** True when two row lists have the same skills in the same order with the same flags. */
export function sameRows(a: readonly SkillRow[], b: readonly SkillRow[]): boolean {
  return a.length === b.length && a.every((r, i) => r.skill.id === b[i]?.skill.id && r.enabled === b[i]?.enabled);
}
