#!/usr/bin/env bash
# Launch Claude Code in this repository.
#
# Claude Code is the agent that drives this project (building the Railway-style
# dashboard on top of Dokploy). This wrapper verifies the CLI is installed and
# then starts an interactive session rooted at the repo.
#
#   Usage: scripts/claude-up.sh [extra claude args...]

set -euo pipefail
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v claude >/dev/null 2>&1; then
  echo "Claude Code CLI not found on PATH." >&2
  echo "Install it with: npm install -g @anthropic-ai/claude-code" >&2
  exit 1
fi

echo "[claude] $(claude --version)"
echo "[claude] Starting Claude Code in: $REPO_DIR"
cd "$REPO_DIR"
exec claude "$@"
