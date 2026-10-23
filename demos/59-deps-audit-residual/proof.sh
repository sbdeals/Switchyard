#!/usr/bin/env bash
# Before/after npm audit (prod deps) for mcp + desktop: origin/main vs codex/deps-audit-residual.
# Run from the branch worktree root (e.g. /workspace/wt-deps-audit-residual).
set -u
tmp=$(mktemp -d)
echo "branch: $(git rev-parse --abbrev-ref HEAD) @ $(git rev-parse --short HEAD); base origin/main @ $(git rev-parse --short origin/main)"
for d in mcp desktop; do
  mkdir -p "$tmp/$d"
  git show origin/main:$d/package.json > "$tmp/$d/package.json"
  git show origin/main:$d/package-lock.json > "$tmp/$d/package-lock.json"
  echo; echo "===== BEFORE (origin/main) $d: npm audit --omit=dev ====="
  (cd "$tmp/$d" && npm audit --omit=dev --package-lock-only 2>&1 | grep -E '^[a-z@].*  |^Severity|vulnerabilit')
  echo; echo "===== AFTER (branch) $d: npm audit --omit=dev ====="
  (cd "$d" && npm audit --omit=dev 2>&1 | tail -1)
done
echo; echo "===== package.json unchanged? ====="
git diff --stat origin/main...HEAD
git diff --quiet origin/main...HEAD -- mcp/package.json desktop/package.json && echo "PASS: package.json files unchanged (lockfile-only)"
rm -rf "$tmp"
