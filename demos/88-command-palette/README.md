# ⌘K command palette (RAILWAY-GAP #9)

Branch `codex/command-palette` (base `codex/context-menus`, #69).

**Before** (`before.mp4`, `before-1/2`): on #69, pressing Ctrl+K does nothing, and the header has no command entry point.

**After** (`after.mp4`, `after-1..5`):
- The header has a **Commands ⌘K / Ctrl+K** button.
- Ctrl+K opens the palette.
- Typing `5f72` fuzzy-finds the service, and Enter opens its drawer.
- Ctrl+K, then `logs` shows **Actions · compose-5f72 → View logs**, and Enter switches to the Logs tab.

**Session proof** (`proof-full.mp4`, `proof-*.png`): 17 checks on a throwaway project.
- focus trap and restore
- Meta+K and outside click
- Variables command
- Recent section
- Delete keeps its confirmation dialog
- Redeploy runs through the palette, a pending action is disabled, and the redeploy succeeds
- project navigation
- create menu

Notes:
- Context menus and the palette share one action binder (`lib/service-actions.ts`), so capability checks and the confirmation dialog are identical.
- Recent is kept per session only, not persisted.

Checks: lint, tsc and vitest pass (16 files, 479 tests).
