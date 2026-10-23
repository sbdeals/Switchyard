# #48 — MCP `list_services` returns metadata only (no env blocks)

PR: https://github.com/sbdeals/Switchyard/pull/48 · branch `codex/mcp-list-metadata` · finding MCP-P2-2

Non-UI change, so this is before/after terminal output from the **built** MCP `list_services` handler (main `1fc46d5` vs this branch).

- **Live bridge Dokploy** (`live-demo.mjs`, output in `before-live.txt` / `after-live.txt`):
  - **before:** the 15 services include an `env` field, and 3 carry real env blocks (`api`, `api-stg`, `web`; values masked by the demo script, not by the tool).
  - **after:** the same 15 services with only `appName, engine, environmentId, environmentName, id, kind, name, projectId, projectName, status`.
- **Fixture with planted secrets in every engine's env/password fields** (`fixture-demo.mjs`, output in `before-fixture.json` / `after-fixture.json`): 7 secrets leak before, 0 after.
