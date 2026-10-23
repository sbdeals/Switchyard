# #35 — MCP rejects ambiguous service names

PR: https://github.com/sbdeals/Switchyard/pull/35 · branch `codex/mcp-unambiguous-targets` @ 03c664d · finding MCP-P1-1

**Stack:** live bridge-mode Dokploy. Project `demo` has app `api` in **production** (`ENV_MARKER=production`) and an app also named `api` in **staging** (`ENV_MARKER=staging`). (The staging app was renamed to `api-stg` afterwards for the #36 demo.)

The MCP server is driven over stdio by `demo.mjs`, through `run.sh`. Before uses the main build (1fc46d5); after uses this branch's build.

- **before:** `manage_env {"service":"api"}` silently returns `ENV_MARKER=production`. A write would hit production.
- **after:** `"api" matches multiple services` lists both candidates with project, env, id and appName. `api-7dcbbh` (appName) still resolves.

**Files:**
- `demo.cast`: asciinema terminal recording. Play it with `asciinema play demo.cast`.
- `before-after.txt`: full transcript
- `npm-test.txt`: `npm test` output (13/13)
