# deps-audit-residual: MCP + desktop prod `npm audit` to 0 (commit 70aa3db)

Branch `codex/deps-audit-residual` (off main @ 1fc46d5). PR: [#59](https://github.com/sbdeals/Switchyard/pull/59) (draft, base main). Lockfile-only and non-UI, so the proof is a terminal before/after. Captured 09:07 EDT, 2026-10-23.

- **[before-after-terminal.txt](before-after-terminal.txt)** / **[proof.cast](proof.cast)** (asciinema), produced by **[proof.sh](proof.sh)** run from the branch root. It audits `origin/main`'s lockfiles (`npm audit --omit=dev --package-lock-only`) and then the branch's installed tree (after `npm ci`):
  - mcp: **8 vulnerabilities (3 moderate, 4 high, 1 critical) → 0**. The critical one is proxy-addr IP spoofing (GHSA-jqcg-44mw-7w3h).
  - desktop: **1 high (js-yaml) → 0**.
  - `PASS: package.json files unchanged (lockfile-only)`.
- **[checks.txt](checks.txt)**: mcp `npm ci` + `npm test` 5/5 pass; desktop `npm ci` + `tsc --noEmit` + `tsup` build pass.

Bumps (all within existing ranges):
- mcp: proxy-addr 2.0.7→2.0.8, @modelcontextprotocol/sdk 1.29.0→1.32.1, ip-address 10.2.0→10.7.4, fast-uri 3.1.3→3.1.9, @grpc/grpc-js 1.14.4→1.14.6, hono 4.12.30→4.13.13, qs 6.15.3→6.16.1.
- mcp: @hono/node-server 1.19.14→2.1.5. This is a major bump, but the SDK's own range `^1.19.9 || ^2.0.5` allows it. MCP uses stdio only, not the Hono HTTP server.
- desktop: js-yaml 4.3.0→4.3.2 (via electron-updater).

**Review:** Codex read-only, offline review (thread 01a168b7…, gpt-6-astra, ultra) rated it **SAFE**. Every bump satisfies all dependent and peer ranges.

**Caveat:** no full runtime regression run. The desktop app was built but not launched under Electron, and the MCP check is the unit tests plus an earlier stdio initialize/tools/list smoke (11 tools).
