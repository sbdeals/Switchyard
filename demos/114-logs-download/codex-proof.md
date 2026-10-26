# Logs download local proof

Verified only against the throwaway dashboard at `http://127.0.0.1:3046`.

- Fixture: `logs-download-proof` project, `logs-download-numbered` Compose service, busybox printing 12,050 numbered ANSI-colored stdout/stderr lines. The container explicitly used the `logs-download-` prefix; Dokploy generated its internal appName independently.
- Copy: filter `line-1204` produced ten visible lines, a success toast, and matching actual clipboard contents without ANSI.
- Six browser downloads: `.log` and `.json`, each at 1k/5k/10k; default selection 5k. The smaller exports exactly match suffixes of the 10k export. Original Docker stream ordering is preserved.
- Default text download: 5,000 lines, head `line-07051`, tail `line-12050`, no ANSI escapes.
- JSON: valid UTC timestamps and correct stdout/stderr fields.
- Server cap: `lines=999999` returned 10,000 lines.
- Unknown app: authenticated request for `logs-download-other-unknown` returned HTTP 403, `unknown app`.
- Fixture service and project deleted through dashboard actions; cleanup recorded in `assertions.json`.
- This session's `sy-logs-download` dashboard container, data volume, and image tag were removed afterward. No matching containers remain; port 3046 is free.

Artifacts: `logs-download-proof.mp4`, screenshots `01-*` through `05-*`, downloaded files in the six count/format directories, `copied-visible.txt`, `hard-cap-999999.log`, and `assertions.json`. Inspection panels shown in the recording display the actual saved file contents and HTTP assertions collected by `proof.mjs`.

Commands and results:

```sh
cd /workspace/wt-logs-download/dashboard && npm run lint && npx tsc --noEmit && npx vitest run
# PASS: lint, TypeScript; 4 test files, 40 tests.

cd /workspace/wt-logs-download && sudo docker build -q -t switchyard-dash:logs-download dashboard
# PASS

/tmp/runsy.sh sy-logs-download 3046 logs-download
# PASS: login HTTP 200

BASE=http://127.0.0.1:3046 node /workspace/sy-codex-notes/fix/logs-download-proof/proof.mjs
# PASS: all live assertions and dashboard cleanup.
```

Limits: this base has no deployment-log path, so the conditional build-log download does not apply. The existing Docker helper buffers its bounded read before the HTTP response streams records. TTY output cannot distinguish stdout/stderr and is labeled `unknown` (unit-tested).

Repository files changed:

- `dashboard/src/components/service/LogsTab.tsx`
- `dashboard/src/app/api/services/logs/download/route.ts`
- `dashboard/src/lib/docker.ts`
- `dashboard/src/lib/log-export.ts`
- `dashboard/src/lib/log-export-client.ts`
- `dashboard/src/lib/log-export.test.ts`
- `dashboard/src/lib/log-export-client.test.ts`
- `dashboard/src/lib/log-download.test.ts`
- `dashboard/src/lib/docker-log-reader.test.ts`
- `dashboard/vitest.config.ts`
- `dashboard/.dockerignore`

No lockfiles changed; no commit was made.
