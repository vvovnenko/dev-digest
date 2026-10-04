#!/usr/bin/env sh
# find-sleeps.sh — list real sleeps in test files (candidates for fake timers).
# Usage: sh scripts/find-sleeps.sh [dir]
# Read-only: it only greps. DevDigest never runs it — an import skips every script.
dir="${1:-.}"
grep -rnE 'setTimeout\(|sleep\(' "$dir" \
  --include='*.test.ts' --include='*.test.tsx' --include='*.spec.ts' --include='*.spec.tsx'
