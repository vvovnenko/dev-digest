# Skill import from URL + injection gate

**Status:** in progress

The feature spans the API and the UI, so its single spec lives in
[`server/specs/05-skill-url-import.md`](../../server/specs/05-skill-url-import.md). A skill's
**effective** state there is `enabled && !injection_detected`, and every control below shows
that state.

UI summary:

- `/skills`: **Add Skill ▾** gets a third item, **Import from URL** (after Create from scratch
  and Import file…), which opens a modal, "Import skill from URL":
  - **Skill name** first, "Optional — derived from the first heading if blank.";
  - **URL (https:// only)** below it, with a raw.githubusercontent.com placeholder;
  - a full-width primary **Import from URL** button, disabled until the URL starts with
    `https://` and the name is blank or a valid slug;
  - no preview: the button saves at once (`POST /skills/import/url`) and reads "Importing…"
    meanwhile. A refusal is toasted by the global mutation handler and keeps the modal open;
    a 409 also marks the name as taken.
  - On success the modal closes and opens `/skills/:id?tab=config` when the skill is flagged,
    else `?tab=preview`.
- `/skills/:id` for a flagged skill:
  - a full-width red banner above the header, `role="alert"`: **INJECTION DETECTED — DO NOT
    ENABLE** · "This skill contains prompt injection patterns. It has been automatically
    blocked.";
  - a red **Injection detected** badge next to the version badge, in place of "disabled";
  - the Config tab's **Enabled** toggle is off and disabled.
  - A save that makes the text clean removes all three at once.
- Skill cards: the global toggle of a flagged skill is off and disabled.
- `/agents/:id?tab=skills`: a flagged row has a red border, the **Injection detected** badge
  in place of "disabled globally" (its tooltip says to edit and save the skill), and a
  disabled, unchecked checkbox. It isn't counted in "N of M enabled", and reordering keeps
  its stored link flag.
- **Vendor exception** (user-approved, like `src/vendor/ui/nav.ts` in 03): the vendored
  `Toggle` and `Checkbox` take an optional `disabled` prop (native `disabled`, dimmed,
  `not-allowed` cursor), shown in the Showcase.

Shared: `src/components/injection-badge/InjectionBadge.tsx` (two routes use it); the banner
is the skill page's `SkillEditorView/_components/InjectionBanner/`. Hook:
`useImportSkillFromUrl()` in `src/lib/hooks/skills.ts`, which caches the new skill and
invalidates `skillKeys.all` like `useCreateSkill`. Copy: new `importUrl` and `injection`
objects at the end of `messages/en/skills.json`. Out of scope, as in the server spec: a
preview for URL imports, community import, and an e2e flow (the hermetic runner has no
network).
