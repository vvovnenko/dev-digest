import type { Agent, AgentUpdate } from "@devdigest/shared";

/**
 * Only the draft fields that differ from the saved agent — what the draft keeps
 * and Save sends. An unset field (`undefined`) is dropped; the empty model left
 * by a provider switch is kept, so Save waits for a new one.
 */
export function changedFields(agent: Agent, draft: AgentUpdate): AgentUpdate {
  const patch: AgentUpdate = {};
  for (const key of Object.keys(draft) as (keyof AgentUpdate)[]) {
    const value = draft[key];
    if (value !== undefined && value !== agent[key]) Object.assign(patch, { [key]: value });
  }
  return patch;
}
