# ANSI logs local proof

Recorded 2026-10-26 using only local dashboard `http://127.0.0.1:3059` and local Dokploy `:3000`.

- [Before runtime](before-runtime.png) / [After runtime](after-runtime.png)
- [Before filter](before-filter.png) / [After filter](after-filter.png)
- [Before console](before-console.png) / [After console](after-console.png)
- [Before/after MP4](ansi-logs-before-after.mp4): 16.92 seconds, actual Playwright browser recordings with stage labels.
- Machine-readable assertions: [before-evidence.json](before-evidence.json), [after-evidence.json](after-evidence.json).
- Resource/image IDs and cleanup: [resources.json](resources.json).

## Results

Baseline image was built from clean main `1fc46d5ef07efbd5b9561c4a24935c78b5f15d3f`. It displayed raw ESC/OSC text in runtime and console logs. Native DOM selection retained escape bytes. Searching `searchable` failed when ANSI styling split `sea` + `rch` + `able`.

After image `sha256:4dc1bf7758de616eb1e892e94a93db16687f52df9eccd8d6a61523eb4617dc15` rendered green/red, bold blue (weight 700), indexed orange (`rgb(255, 135, 0)`), and truecolor sky (`rgb(125, 211, 252)`). Search across ANSI boundaries matched. Native DOM selection contained no escape bytes. OSC 8 produced plain label text with zero links. The fake `<script>` stayed text with zero script elements and no script execution. CR progress retained only the 100% segment. Console output passed the same escape, HTML, OSC, bold, and CR checks.

Both capture commands completed with `assertions: passed` and exit 0. A first after-run assertion incorrectly measured an outer muted wrapper; the harness was corrected to measure the leaf span and the final run passed. Evidence and screenshots are from the final runs.

## Exact proof commands

```sh
/tmp/runsy.sh sy-ansi-logs 3059 ansi-logs-before
BASE=http://127.0.0.1:3059 node /workspace/sy-codex-notes/fix/ansi-logs-proof/fixture.mjs create
BASE=http://127.0.0.1:3059 node /workspace/sy-codex-notes/fix/ansi-logs-proof/capture.mjs before
/tmp/runsy.sh sy-ansi-logs 3059 ansi-logs
BASE=http://127.0.0.1:3059 node /workspace/sy-codex-notes/fix/ansi-logs-proof/capture.mjs after
BASE=http://127.0.0.1:3059 node /workspace/sy-codex-notes/fix/ansi-logs-proof/fixture.mjs delete
sudo docker rm -f sy-ansi-logs
sudo docker volume rm sy-ansi-logs-data
sudo docker ps -a --filter name=ansi-logs --format '{{.Names}} {{.Status}}'
sudo docker ps -a --filter name=compose-navigate-optical-circuit-47nm8j --format '{{.Names}} {{.Status}}'
```

All resource deletion used Dokploy `compose.delete` (`deleteVolumes: true`) and `project.remove`; `project.all` verified the created project disappeared. Both Docker checks returned no rows. Only the dashboard container/volume created by this session were removed directly with Docker. The first compose's auto-generated appName lacked the slug; that own compose was immediately API-deleted and recreated with explicit `appName: ansi-logs-fixture` before the final baseline capture. Its ID/cleanup are recorded.

The fixture is [compose.yaml](compose.yaml): public alpine image, no published ports/domains, printf loop only. Playwright used the authorized demo-tools `open`/`login` functions. No credentials appear in artifacts.

## Limits

No deployment/build-log viewer, log explorer, or dedicated copy/download controls exist at supplied main `1fc46d5`; proof covers all existing runtime and console output surfaces plus native selection. Runtime retains the existing roughly 2,000-line cap. The parent agent's 10,000-line parser benchmark passed; no 5,000-line browser benchmark was performed. Runtime ANSI style resets per received line; multiline console output preserves style within one response. No production/live deployment, paid API, external webhook, or pre-existing app/container was accessed or modified.

## Repository validation (reported by implementation agent)

```sh
cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run
```

Passed: lint, TypeScript, and all 63 Vitest tests, including the 10,000-line performance test. The final Docker image build also succeeded.

This base's preinstalled `node_modules` contains Vitest 3.2.7, but `package.json` does not declare it. No dependencies or lockfiles changed. `.dockerignore` excludes `*.test.ts` from the production image context so the production build does not need to resolve this local test tooling.
