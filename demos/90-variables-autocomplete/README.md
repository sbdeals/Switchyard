# Variables table + `${{` reference autocomplete (RAILWAY-GAP #7)

Branch `codex/variables-autocomplete` (base `codex/railway-staged-changes`, #85).

**Before** (`before.mp4`, `before-1`): on #85, Variables is a single raw textarea.

**After** (`after.mp4`, `after-1..3`): Variables is a **table**.
- Each key/value row has a per-row reveal, copy and delete. Values are masked by default.
- **Add variable** adds a row, and a **Raw editor** toggle switches back to the text view.
- Typing `${{` in a value opens **autocomplete**. Suggestions are names only and never show the referenced value. They are ranked: other services' variables first, then self, then built-ins, with prefix matches ahead. The list is capped at 8 with a "N more, keep typing" hint, and the row being edited is excluded.
- Selecting a suggestion with Enter inserts `${{compose-5f72.SWITCHYARD_HOST}}`.
- Edits go through #85's staged-changes bar. Nothing was saved in this walkthrough.

**Session proof** (`proof-full.mp4`, `proof-regressions.mp4`, `proof-*.png`, `r1-*.png`), run on throwaway va-autocomplete-* fixtures that are now deleted:
- masking and reveal
- inline validation for duplicate keys, invalid keys, unclosed quotes and unfinished `${{`
- a reference cycle is flagged
- the staged details
- **one** Deploy: the deployment count went from 1 to 2
- the env persisted after reload

Notes:
- Comments, quotes and blank lines are preserved when switching between table and raw.
- Quoted multiline values are parsed as one row.

Checks: lint, tsc and vitest pass (18 files, 552 tests).
