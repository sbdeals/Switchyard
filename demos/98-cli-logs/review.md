Implemented service logs over an authenticated, bounded dashboard API. Logs shares deploy authentication and project/environment/service lookup. Supports service/project names or IDs, line counts, since windows, NDJSON, polling with backoff and de-duplication, and clean Ctrl+C. Updated CLI help and documentation.

Files touched:
- README.md
- cli/README.md
- cli/src/cli.ts
- cli/src/commands/deploy.ts
- cli/src/commands/logs.ts
- cli/src/core/dokploy-api.ts
- cli/src/core/platform-client.ts
- cli/src/core/service-selection.ts
- cli/src/lib.ts
- cli/test/deploy.test.mjs
- cli/test/logs.test.mjs
- cli/test/service-selection.test.mjs
- dashboard/src/app/api/services/logs/recent/route.ts
- dashboard/src/lib/recent-logs.test.ts
- dashboard/src/lib/recent-logs.ts
- dashboard/src/proxy.ts
- dashboard/tsconfig.json
- docs/cli.md

Exact verification commands and final results:
- `cd cli && npm run typecheck && npm test` — exit 0; TypeScript passed, build passed, all 135 node:test tests passed.
- `cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run` — exit 0; lint and TypeScript passed, all 30 Vitest tests passed.
- `sudo docker build -q -t switchyard-dash:cli-logs dashboard` — exit 0; clean dashboard image built.
- `/tmp/runsy.sh sy-cli-logs 3026 cli-logs` — exit 0; HTTP 200 on :3026.
- `BASE=http://127.0.0.1:3000 node /workspace/sy-codex-notes/fix/cli-logs-proof/run-proof.mjs --run` — exit 0; required log transcripts captured, follow SIGINT exit 0, service/project deleted through Dokploy APIs.
- `node cli/dist/cli.js logs --help` — exit 0; help saved in logs-help.txt.
- `git diff --check` — exit 0.

Cleanup:
- Throwaway compose/project removed via API; project absent from project.all and no fixture containers remain.
- Removed session-created sy-cli-logs dashboard container, sy-cli-logs-data volume, and switchyard-dash:cli-logs image tag.

Risks and limitations:
- Live proof injected the authorized demo browser session into the real built parser/action/HTTP client; saved-credential binary login is covered by tests, not by live proof.
- Polling snapshots can miss bursts beyond --lines/256 KiB/20 containers. Identical messages at the same exact Docker timestamp can be indistinguishable across moving tail windows.
- Remote-server logs return an explicit unsupported error. Application/database support is tested with mocks; the live fixture was compose.
- Old infrastructure logs targets are replaced with service selection, documented with Docker diagnostic alternatives.
- The supplied dashboard node_modules contains Vitest although the base package manifest does not declare it. App TypeScript excludes colocated test files so clean Docker builds work without changing manifests or lockfiles.

No commits or pushes. No lockfiles changed. Local proof only.
