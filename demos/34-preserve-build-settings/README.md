# #34 — preserve build settings on env save

PR: https://github.com/sbdeals/Switchyard/pull/34 · branch `codex/preserve-build-settings` @ af8ef0a · finding MCP-P1-2

**Stack:** live bridge-mode Dokploy (:3000) and the Switchyard dashboard container (:3001). The same scripted run is applied to `switchyard-dash:main` (before) and `switchyard-dash:preserve-build-settings` (after).

**Script** (`demo-tools/pbs.mjs`, driven by `pbs-run.sh`):
1. Via the Dokploy API, set app `web` to buildArgs `NODE_ENV=production`, buildSecrets `NPM_TOKEN=demo-build-secret`, createEnvFile `true`.
2. In the dashboard, open web → Variables, add `LOG_LEVEL=debug`, then click **Save variables**.
3. Read the app back from Dokploy.

| | buildArgs | buildSecrets | createEnvFile |
|---|---|---|---|
| before (main) | `""` | `""` | `false` (wiped) |
| after | `NODE_ENV=production` | `NPM_TOKEN=demo-build-secret` | `true` |

**Files:**
- `before.mp4`, `after.mp4` (plus .webm): Playwright recordings
- `*-1-editing.png`, `*-2-saved.png`, `*-3-dokploy-state.png`: screenshots
- `*-state.json`: Dokploy state before and after the save
