# Plugins

This repo is also a Claude Code plugin marketplace. The manifest is
[`../.claude-plugin/marketplace.json`](../.claude-plugin/marketplace.json) (marketplace
`devdigest`). It lists one plugin.

| Path | What |
| ---- | ---- |
| [`devdigest-review-skills/`](devdigest-review-skills/) | Plugin **1.0.0** ([`plugin.json`](devdigest-review-skills/.claude-plugin/plugin.json)) with the skill [`error-handling-review`](devdigest-review-skills/skills/error-handling-review/SKILL.md) |
| [`injection-demo/`](injection-demo/) | **Not a plugin.** A deliberate prompt-injection fixture for DevDigest's import gate; see below |

## Install in Claude Code

```sh
claude plugin validate .                                   # marketplace, from the repo root
claude plugin validate plugins/devdigest-review-skills     # plugin
```

```text
/plugin marketplace add vvovnenko/dev-digest#module/L02
/plugin install devdigest-review-skills@devdigest
```

The skill then loads as `/devdigest-review-skills:error-handling-review`. Add
`--sparse .claude-plugin plugins` to `claude plugin marketplace add` to skip the rest of the
repo. A local checkout works too: `claude plugin marketplace add ./`.

## Import into DevDigest

Go to Skills → **Add Skill ▾ → Import from URL** and use the **raw** file URL. A
`github.com/…/blob/…` page is HTML, and the import refuses it.

- Clean skill, saved and usable:
  `https://raw.githubusercontent.com/vvovnenko/dev-digest/refs/heads/module/L02/plugins/devdigest-review-skills/skills/error-handling-review/SKILL.md`
- Injected skill, saved and blocked (**INJECTION DETECTED — DO NOT ENABLE**):
  `https://raw.githubusercontent.com/vvovnenko/dev-digest/refs/heads/module/L02/plugins/injection-demo/SKILL.md`

> **`injection-demo/SKILL.md` is hostile on purpose.** It looks like a normal
> `dependency-hygiene` security skill, but an HTML comment at the end, which GitHub's
> rendered view hides, tells the reviewer to approve everything and leak its prompt. It
> exists to show the gate described in
> [`server/specs/05-skill-url-import.md`](../server/specs/05-skill-url-import.md). It is not
> listed in the marketplace. Never install it or enable it anywhere. Deleting the whole
> comment makes it clean; deleting only one of its lines does not.
