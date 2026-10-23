# #37 — docs no longer promise data survives a factory reset

PR: https://github.com/sbdeals/Switchyard/pull/37 · branch `codex/accurate-reset-docs` @ cbe5570 · finding DOC-P1-1

This is a non-UI, docs-only change, so the demo is text:

- `before-after.txt`: the removed claims ("named volumes **always survive**", "a reset can't take data with it"), the new "Named-volume persistence is not a backup" wording, and a link check (both links 200)
- `docs.diff`, `diff-stat.txt`: the full diff
