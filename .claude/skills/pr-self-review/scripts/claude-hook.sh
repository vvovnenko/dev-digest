#!/bin/sh
# Claude Code hook for the pr-self-review gate (wired in .claude/settings.json).
#   pre   PreToolUse on Bash: refuse `git push` / `gh pr create` without a PASS verdict
#   post  PostToolUse on Bash: after a successful push, publish the verdict as a
#         GitHub commit status (only when PR_SELF_REVIEW_GITHUB_TOKEN is set)
# A cheap substring filter keeps node out of every other Bash call.
dir=$(dirname "$0")
input=$(cat)
case "$1" in
  post)
    case "$input" in
      *push*) [ -n "$PR_SELF_REVIEW_GITHUB_TOKEN" ] && printf '%s' "$input" | node "$dir/publish-status.mjs" --hook ;;
    esac
    ;;
  *)
    case "$input" in
      *push*|*"pr create"*|*ooksPath*) printf '%s' "$input" | exec node "$dir/gate.mjs" --claude ;;
    esac
    ;;
esac
exit 0
