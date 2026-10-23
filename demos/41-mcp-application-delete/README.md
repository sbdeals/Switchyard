# #41: MCP `service_action remove` deletes applications

PR: https://github.com/sbdeals/Switchyard/pull/41 · branch `codex/mcp-application-delete` · finding MCP-P2-1

**Stack:** live bridge-mode Dokploy. The real MCP server (`mcp/dist/index.js`) runs over stdio, driven by an MCP SDK client (`mcp-remove.mjs`). The "before" build is the same tree with `origin/main`'s `src/dokploy.ts`.

For each label: create a throwaway app via the Dokploy API → call `service_action {service, action:"remove"}` → list the apps.

- **before (main):** `isError=true` with `Dokploy application.remove failed (404): Not found`, and the app is still listed. Dokploy has no `application.remove` procedure; it is `application.delete`.
- **after:** `{"ok":true,...,"action":"remove"}`, and the app is gone from the listing.

**Files:** `before.txt` and `after.txt` (the captured terminal sessions), plus `mcp-remove.mjs`.
`mcp/test/service-lifecycle.test.mjs` in the PR covers the endpoint, method, and body for all 28 kind×action combinations.
