# Skills Lab

**Status:** in progress

The feature spans the API, the engine and the UI, so its single spec lives in
[`server/specs/03-skills.md`](../../server/specs/03-skills.md).

UI summary:

- The sidebar gets a **SKILLS LAB** section, Skills (`g s`) then Agents — an approved
  edit of a vendored file, `src/vendor/ui/nav.ts` (HW2 adds Conventions the same way).
- `/skills`: a grid of skill cards (name, type badge, source, description, a global
  enabled toggle, "N agents", delete), local search, and **Add Skill ▾** → Create from
  scratch (a modal) or Import file… (a drawer: pick a `.md` / `.zip`, see the parsed draft,
  the skipped files and the warnings, then Save skill). A card opens `/skills/:id`.
- `/skills/:id`: the cards on the left, and the tabs **Config** (enabled, name, the
  description as the skill's "When to apply" line, type, a line-numbered body editor with
  a token count; Save sends only changed fields), **Preview** (the block exactly as the
  agent receives it, default tab), **Versions** (Diff against the current skill, Restore as
  a new version); **Stats** (which agents use it) is hidden until HW8. `?tab=` holds the tab.
- `/agents/:id?tab=skills`: every workspace skill in the agent's order — drag or keyboard
  to reorder, a checkbox to enable it for this agent, "N of M enabled", a filter. Each
  action saves the whole ordered list once. Agent cards show "N skills".
- Run trace → Prompt assembly: "Skills (dynamic) · N skills · +T tokens", then one block
  per skill with its version and added tokens; older traces keep the single block.

Hooks: `src/lib/hooks/skills.ts` (`skillKeys`), `useAgentSkills` / `useSetAgentSkills`
in `src/lib/hooks/agents.ts` (`agentSkillKeys`). Out of scope, as in the server spec:
Context and Evals tabs, "Run on evals", pull / accept stats, syntax highlighting.
