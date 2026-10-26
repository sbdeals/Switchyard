# Resource limits proof

## Review round 1: human units and save-only settings

Implemented the lead's reduced scope in `/workspace/wt-resource-limits` on 2026-10-26. Improved the existing Settings inputs instead of adding a second set. Applications and databases share CPU cores / MiB-or-GiB inputs, four presets (Small, Medium, Large, Custom), and reservation validation. Resource saves check the caller's `project.all` tree, convert on the server, and update Dokploy without calling any deploy/reload endpoint. Existing deployment implementation was not changed.

The pure module uses exact integer arithmetic. Empty means unset; CPU bounds are 0.01–256 cores and memory bounds are 6 MiB–1024 GiB. These are input bounds, not detected host capacity. Legacy malformed stored values remain visible and require explicit correction or clearing. Out-of-bounds integer values decode exactly but cannot be resaved without correction. Presets leave reservations unset. The UI explains the bridge-host limitation and directs Compose users to `deploy.resources` in their Compose file.

### Successful local proof on :3043

Created only the throwaway project `resource-limits-r1-1793005811716` and application `resource-limits-r1-1793005811716-app`. No deployment was requested. In the Settings UI, selected Small, saved, reloaded the entire page, and verified the fields still show **0.5** CPU cores and **512 MiB**. Also entered CPU reservation 1 and verified validation rejected it; returned the unsaved form to Small.

Read back through Dokploy `application.one`:

```json
{
  "applicationStatus": "idle",
  "cpuLimit": "500000000",
  "memoryLimit": "536870912",
  "cpuReservation": null,
  "memoryReservation": null
}
```

`deployment.all` returned zero deployments. Evidence:

- [Saved Small](round1-01-small-saved.png)
- [Full page reload: human units preserved](round1-02-small-reloaded.png)
- [Reservation validation](round1-03-reservation-validation.png)
- [MP4 recording](round1-resource-limits.mp4)
- [Whitelisted API readback and deployment count](round1-stored-resources.json)
- [Cleanup verification](round1-cleanup.txt)
- Reproduction scripts: `round1-api.mjs` and `round1-capture.mjs` (use the authorized local demo helper; no credentials are recorded).

Deleted the throwaway app and project via Dokploy's API and verified their absence from `project.all`. Removed only this round's dashboard container `sy-resource-limits-r1` and its volume. No pre-existing application or container was stopped or deleted.

### Files and checks

Repository files changed:

- `dashboard/src/components/service/ResourceSettings.tsx`, `AppTabs.tsx`, `ServiceDrawer.tsx`, `ComposeTabs.tsx`
- `dashboard/src/lib/resource-limits.ts`, `resource-limits.test.ts`, `resource-settings.ts`, `resource-settings.test.ts`, `dokploy.ts`
- `dashboard/src/app/actions.ts`
- `dashboard/.dockerignore`: exclude Vitest test sources from the production image build. This base's package manifest has no Vitest dependency; tests run using the supplied node_modules. No dependency manifests or lockfiles changed; local TypeScript still checks test sources.

```sh
cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run
```

All passed: 78 tests across 2 files (62 conversion/validation/preset tests; 16 ownership/save-path tests). `git diff --check` passed.

```sh
sudo docker build -q -t switchyard-dash:resource-limits-r1 dashboard
/tmp/runsy.sh sy-resource-limits-r1 3043 resource-limits-r1
BASE=http://127.0.0.1:3043 node /workspace/sy-codex-notes/fix/resource-limits-proof/round1-capture.mjs
node /workspace/sy-codex-notes/fix/resource-limits-proof/round1-api.mjs read
```

Build passed, :3043 login returned HTTP 200, browser assertions and API readback passed. Runtime enforcement remains unproven on Swarm and is unavailable on this bridge host; this round proves settings persistence only. No commit was created.

## Initial blocker evidence (retained)

Tested 2026-10-26 from `/workspace/wt-resource-limits`, base `main`, dashboard on `http://127.0.0.1:3043`.

No repository files changed. Stopped at the task's explicit instruction: if limits cannot be applied on this host, report rather than work around it.

## Findings

Main already has resource fields in service Settings: applications expose limits and reservations; databases expose limits. Their existing hints (`0.5`, `256m`) do not match Dokploy v0.30.10 storage.

Dokploy accepts nullable strings `cpuLimit`, `cpuReservation`, `memoryLimit`, `memoryReservation` for applications and databases. CPU strings contain integer nanocpus; memory strings contain integer bytes. Small therefore means `cpuLimit: "500000000"`, `memoryLimit: "536870912"`.

Upstream version-specific sources:

- [Resource conversion to NanoCPUs/MemoryBytes](https://github.com/Dokploy/dokploy/blob/v0.30.10/packages/server/src/utils/docker/utils.ts#L606-L624)
- [Upstream UI unit conversion](https://github.com/Dokploy/dokploy/blob/v0.30.10/apps/dokploy/components/dashboard/application/advanced/show-resources.tsx#L44-L58)
- [Application deployment uses Docker Swarm services](https://github.com/Dokploy/dokploy/blob/v0.30.10/packages/server/src/utils/builders/index.ts#L81-L198)
- [Redis deployment likewise uses Docker Swarm services](https://github.com/Dokploy/dokploy/blob/v0.30.10/packages/server/src/utils/databases/redis.ts#L54-L141)

Installed application and database deployment code uses `docker.createService`/`docker.getService`, with no bridge fallback. This host reports `Swarm=inactive ControlAvailable=false`.

## Local attempt

Created the session-only project `resource-limits-proof` and application `resource-limits-bridge` through the local Dokploy API, using public image `redis:7-alpine` and no published port/domain. Dokploy generated the internal appName `app-override-auxiliary-driver-99otf7`. Saved the correct Small values and deployed. API readback confirmed both values persisted, but deployment failed:

> (HTTP code 503) unexpected - This node is not a swarm manager.

There was no application container to inspect. Matching `HostConfig.NanoCpus/Memory` cannot be demonstrated on this host through Dokploy's native application/database deployment path. No Swarm initialization, Docker resource overrides, Compose conversion, or deployment patch was attempted.

Evidence:

- `dokploy-stored-resources.json`: whitelisted persisted fields and error status.
- `deployment.log`: throwaway application's deployment log with the Swarm error.
- `docker-state.txt`: Swarm state and no matching application container.
- `01-existing-settings-small-stored.png`: existing Settings with saved Small integer values.
- `02-deployment-error.png`: failed deployment on :3043.
- `resource-limits-blocked.mp4`: recording of the Settings and failure inspection.

## Checks

Executed exactly from the worktree:

```sh
cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run
```

- `npm run lint`: passed.
- `npx tsc --noEmit`: passed.
- `npx vitest run`: exit 1, `No test files found`. This base has Vitest available in the provided node_modules, but no dashboard tests in the checked-out source.

```sh
sudo docker build -q -t switchyard-dash:resource-limits dashboard
/tmp/runsy.sh sy-resource-limits 3043 resource-limits
```

Build passed; :3043 login returned HTTP 200. No dependencies installed in the worktree; no lockfiles changed.

Implementation of presets, conversion/validation, ownership checks, Compose read-only display, and Save & redeploy remains unimplemented because the mandatory host proof is blocked. Existing resource input behavior remains unchanged.

## Cleanup

Deleted the session's application and project using Dokploy's API and verified their absence from `project.all` (`cleanup.txt`). Removed only the session-created dashboard container `sy-resource-limits` and its volume. No pre-existing application/container was stopped or deleted. Git status remains clean.
