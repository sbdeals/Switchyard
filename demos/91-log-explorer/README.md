# #91 Project log explorer

- `before.mp4` / `before-1-header.png`: main (1fc46d5). The workspace header has only Canvas/Grid, and there is no cross-service log view.
- `after.mp4` / `after-1..3-*.png`: this PR. The **Logs** toggle shows a merged, timestamp-ordered stream for a local throwaway project, with filters and live tail (read-only, no changes saved).
- `01..06-*.png`, `proof-codex.mp4`, `browser-checks.json`: Codex's session proof. It uses a throwaway BusyBox Compose fixture with mixed JSON/plain levels and covers: merge, service filter, level+search, expanded JSON, live tail, and environment scope. All nine browser checks passed, and the fixture was removed afterwards.

Local test stack only. No live or production systems were touched.
