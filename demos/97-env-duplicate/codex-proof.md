# Environment duplication proof

Implemented on `codex/env-duplicate`, based on `main`. No commit or push.

## Behavior

Projects has a Duplicate action per environment. Copy variables defaults on; deploy defaults off. Preflight validates target names and the source snapshot, lists services and excluded domains, then streams each service result. Partial copies remain available; no automatic deletion. Named API volume mounts receive fresh names while preserving sharing within the duplicate. Canvas connections stay within their environment.

## Local proof

Executed against the local Dokploy v0.30.10 stack through dashboard `http://127.0.0.1:3028`.

Created only `env-duplicate-proof` and two Compose services, `env-duplicate-api` and `env-duplicate-peer`. Source shared and service variables were copied into `staging`, including `PEER_URL=http://env-duplicate-peer:8080`. Compared both saved Compose files and all variable blocks through Dokploy's API. Verified no domains, deploy history, or automatic deploys appeared. A second duplicate with copy variables disabled had empty shared/service variables. Existing `staging` was rejected before mutation.

Deleted the project through the dashboard and verified its absence with Dokploy `project.all`. Removed this session's `sy-env-duplicate` dashboard container and data volume after recording. No pre-existing apps or containers were modified.

Artifacts: `01-preflight.png`, `02-results.png`, `03-environments.png`, `04-canvas.png`, `05-staging-variables.png`, `06-name-collision.png`, `07-cleanup.png`, `proof.mp4` (14 seconds), `results.json`.

## Exact checks

- `cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run` — passed; 4 test files, 60 tests.
- `git diff --check` — passed.
- `sudo docker build -q -t switchyard-dash:env-duplicate dashboard` — passed.
- `bash /tmp/runsy.sh sy-env-duplicate 3028 env-duplicate` — HTTP 200.
- `BASE=http://127.0.0.1:3028 node /workspace/sy-codex-notes/fix/env-duplicate-proof/proof.mjs` — passed; fixture removed through dashboard.
- `node /workspace/sy-codex-notes/fix/env-duplicate-proof/verify-cleanup.mjs` — passed; project absent.

The proof setup uses the supplied demo-tools helper for local test authentication. No dependency installation, lockfile changes, paid API calls, or production access.

## Files touched

- `dashboard/.dockerignore` — exclude tests from the production image context (Vitest is preinstalled locally but absent from the production dependency manifest).
- `dashboard/src/components/ProjectsPanel.tsx`
- `dashboard/src/components/DuplicateEnvironmentForm.tsx`
- `dashboard/src/app/environment-duplicate-actions.ts`
- `dashboard/src/app/api/environments/duplicate/route.ts`
- `dashboard/src/lib/environment-duplicate.ts`
- `dashboard/src/lib/environment-duplicate.test.ts`
- `dashboard/src/lib/environment-duplicate-server.ts`
- `dashboard/src/lib/environment-duplicate-server.test.ts`
- `dashboard/src/lib/environment-duplicate-route.test.ts`
- `dashboard/src/lib/dokploy.ts`
- `dashboard/src/lib/dokploy.test.ts`

## Limits

- Live proof covers Compose configuration duplication, not deployment/runtime connectivity. Application/database creation, deploy requests, and partial failures have mocked Vitest coverage only.
- Existing variable references are preserved, not rewritten to generated runtime hostnames.
- Copy variables controls saved variable blocks and build arguments/secrets. Inline Compose values remain in the copied file; database login settings remain necessary configuration.
- Embedded proxy routes and uploaded sources are rejected. libSQL is explicitly unsupported. Repository Compose, custom commands, randomized names, shared storage and fixed container/project names require manual review before deployment.
- Existing host bind/external volume references may still share data; preflight warns and blocks deploy-after for detected cases. No volume data is copied.
- Concurrent duplicate protection is per dashboard process, not a distributed lock. Progress is not persisted across reloads/disconnects; created resources remain inspectable.
