# Host capabilities proof

Implemented in `/workspace/wt-host-capabilities` on `codex/host-capabilities` (base `main`). No commit, dependency installation, or lockfile changes.

The dashboard reads `docker.info().Swarm` through its existing socket client and Dokploy's authenticated `settings.getDokployVersion`. React memoization shares reads within a server render; known engine modes and Dokploy version metadata are cached for 30 seconds. Unknown engine results, including socket failures and timeouts, are cached for at most 5 seconds before the next read retries. An active manager, bridge engine, worker, and unknown engine are distinct states. Version failures do not change the detected Docker mode.

The header pill/popover describes the host and version. Native Application deployment/start/redeploy/rollback, replicas, Swarm healthchecks, application schedules, and native database S3 backup actions remain visible with notices and disabled controls only on confirmed bridge hosts or Swarm workers. Unknown hosts show a warning and neutral inline notes while leaving all actions enabled. Server actions also reject unsupported mutations before calling Dokploy. Docker Compose controls remain available. Reads, disabling schedules, removal, and configuration that does not deploy remain available.

Dokploy v0.30.10 source verification: application schedules and native database backup paths resolve containers via Swarm service labels. Upstream Docker Compose schedules/backups use a separate path; the feature mapping explicitly refers to native application/database features exposed by this dashboard.

- https://github.com/Dokploy/dokploy/blob/v0.30.10/packages/server/src/utils/schedules/utils.ts
- https://github.com/Dokploy/dokploy/blob/v0.30.10/packages/server/src/utils/backups/utils.ts
- https://github.com/Dokploy/dokploy/blob/v0.30.10/packages/server/src/utils/docker/utils.ts

## Files touched

- dashboard/src/app/actions.ts
- dashboard/src/app/page.tsx
- dashboard/src/components/HostCapabilities.tsx
- dashboard/src/components/GithubDeployModal.tsx
- dashboard/src/components/QuickDeployMenu.tsx
- dashboard/src/components/ServiceCard.tsx
- dashboard/src/components/Workspace.tsx
- dashboard/src/components/service/AppTabs.tsx
- dashboard/src/components/service/BackupsTab.tsx
- dashboard/src/components/service/primitives.tsx
- dashboard/src/lib/docker.ts
- dashboard/src/lib/dokploy.ts
- dashboard/src/lib/host-capabilities.ts
- dashboard/src/lib/host-capabilities-server.ts
- dashboard/src/lib/host-capabilities.test.ts
- dashboard/src/lib/host-capabilities-server.test.ts
- dashboard/src/lib/host-capability-actions.test.ts
- dashboard/src/lib/host-capability-ui.test.ts
- dashboard/tsconfig.json
- dashboard/vitest.config.mts

The Vitest config resolves the existing `@/` alias. The production TypeScript config excludes Vitest tests/config because this checkout's package manifest does not declare Vitest, although the provided node_modules contains it. No manifest or lockfile was changed.

## Checks

From `/workspace/wt-host-capabilities`:

```sh
cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run
```

PASS: lint, TypeScript, 4 test files / 152 tests. Tests use mocks/static rendering and do not call paid APIs or deployments.

```sh
git diff --check
sudo docker build -q -t switchyard-dash:host-capabilities dashboard
```

PASS: whitespace check and standalone Docker image build. Final image ID: `sha256:32a1ef3f095842653e71f9938b4099fe93866f83a8a0508be2e47d6763cce0aa`.

```sh
/tmp/runsy.sh sy-host-capabilities 3030 host-capabilities
BASE=http://127.0.0.1:3030 node /workspace/sy-codex-notes/fix/host-capabilities-proof/proof.mjs
```

PASS: login through the authorized demo helper; bridge pill + v0.30.10 popover; Escape closes popover; filled native creation controls remain disabled while Compose is enabled; native Start/Redeploy disabled; replica/healthcheck fieldsets disabled; a fully filled schedule form still cannot submit; build redeploy checkboxes disabled; native database backup notice shown; existing Docker Compose Redeploy enabled. Nine screenshots saved alongside this file. The three existing services were inspected only: `nginx-g9se`, `postgres-d4rm`, and `nodejs-getting-started-u7cf`. Schedule form text was not submitted. No app, schedule, backup, domain, webhook, or service was created, changed, deployed, or removed.

## Limits

- Live proof was only on the local bridge host. Manager/worker behavior was tested with mocks; Swarm was never initialized.
- The local database has no S3 destination, so live proof covers its notice; actual backup/restore execution was not attempted. Server guards are covered by tests.
- Known host changes may take up to 30 seconds to appear, plus a page refresh. Unknown engine results expire after 5 seconds, including missing socket and timeout failures; Dokploy version metadata retains its separate 30-second cache.
- This change covers the listed dashboard controls/server actions. Embedded agent tools and pre-existing Docker Swarm Stack (`composeType=stack`) operations are unchanged.

## Cleanup

Removed only the throwaway dashboard created in this session:

```sh
sudo docker rm -f sy-host-capabilities && sudo docker volume rm sy-host-capabilities-data && sudo docker image rm switchyard-dash:host-capabilities
```

PASS. Port 3030 is no longer served by this proof container. Existing applications/containers were not changed. Screenshots, the proof script, and results remain in this directory.

## Round 1: unknown hosts leave actions enabled

Unknown detection now returns no blocker for every feature. The warning pill and
neutral inline notes explain that Swarm support is unverified; controls and
server actions stay enabled. Only a definite bridge host or Swarm worker blocks
Swarm features. All 20 guarded-action cases now have unknown-mode success tests.
The cache boundary test verifies a failed read is reused at 4,999 ms and retried
at 5,000 ms, while the version cache retains its independent 30-second lifetime.

Cache durations: **known engine modes: 30 seconds; unknown engine results: 5
seconds; Dokploy version metadata: 30 seconds.** The dashboard README also
includes these durations and describes the behavior without a Docker socket.

Round 1 files changed:

- dashboard/README.md
- dashboard/src/components/HostCapabilities.tsx
- dashboard/src/lib/host-capabilities.ts
- dashboard/src/lib/host-capabilities-server.ts
- dashboard/src/lib/host-capabilities.test.ts
- dashboard/src/lib/host-capabilities-server.test.ts
- dashboard/src/lib/host-capability-actions.test.ts
- dashboard/src/lib/host-capability-ui.test.ts

Checks:

```sh
cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run
```

PASS: lint, TypeScript, 4 files / **159 tests**.

```sh
git diff --check
sudo docker build -q -t switchyard-dash:host-capabilities-r1 dashboard
```

PASS. The first build attempt hit the shared VM's inode limit. After capacity
became available, the same command succeeded without deleting shared caches or
other resources. Base image:
`sha256:0e515d6c911a163cfc88f8064983d2c9ab4f444db05a77e4184583a074ccb307`.

```sh
sudo docker build -q -t switchyard-dash:host-capabilities-r1-unknown - < /workspace/sy-codex-notes/fix/host-capabilities-proof/r1-unknown.Dockerfile
/tmp/runsy.sh sy-host-capabilities-r1-unknown 3030 host-capabilities-r1-unknown
BASE=http://127.0.0.1:3030 node /workspace/sy-codex-notes/fix/host-capabilities-proof/r1-unknown.mjs
```

PASS. The derived throwaway image sets
`DOCKER_SOCKET=/tmp/host-capabilities-r1-missing.sock` and disables alert delivery.
Screenshot: [r1-unknown.png](r1-unknown.png). The screenshot shows the unknown
warning/popover, neutral note, and enabled deployment controls. Browser assertions
also verify enabled native Start/Redeploy, replica/healthcheck fields, a completed
schedule form's Create button, build redeploy controls, and Compose controls.
No deploy, schedule creation, or other app mutation was submitted. Action
execution is verified only with mocks; unknown status intentionally does not
promise that the underlying host supports the requested operation.

Round 1 cleanup:

```sh
sudo docker rm -f sy-host-capabilities-r1-unknown && sudo docker volume rm sy-host-capabilities-r1-unknown-data && sudo docker image rm switchyard-dash:host-capabilities-r1-unknown switchyard-dash:host-capabilities-r1
```

PASS: removed only this round's throwaway dashboard container, volume and images.
Existing demo apps and containers remain unchanged. No commit was made.
