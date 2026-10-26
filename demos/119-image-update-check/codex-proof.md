# Image update check proof

Run after the dedicated dashboard is ready:

```sh
BASE=http://127.0.0.1:3052 node /workspace/sy-codex-notes/fix/image-update-check-proof/proof.mjs
```

The script logs in with the approved local demo helper, creates a new project and a two-service Compose stack through existing dashboard server actions, and deploys only those throwaways. Both services use public nginx images, with no published ports, domains, credentials, or persistent volumes.

- `image-update-check-tag`: `nginx:1.25-alpine`; running `RepoDigests` should equal the current registry digest for exactly this tag.
- `image-update-check-pinned`: `nginx@sha256:…` using that OCI index digest; should display `Unknown` because digest-pinned images cannot track a moving tag.

Screenshots and MP4 capture start after login. The script asserts both real container digests, the public tag status, the pinned status, manual recheck behavior, and no repeated image-check request during a seven-second observation. Cleanup runs in `finally` through the dashboard/Dokploy APIs.

This fixture does not claim that an old version tag is out of date relative to `latest`: checks always compare the same tag. It does not change a public mutable tag or simulate `Update available`; deterministic fake-fetcher tests cover the changed-digest case.

`proof-result.json` records the actual outcome and cleanup status. `resource.json` identifies only resources created by this script if cleanup needs recovery.

Optional application/database proof also passed:

```sh
BASE=http://127.0.0.1:3052 node /workspace/sy-codex-notes/fix/image-update-check-proof/app-db-proof.mjs
```

It creates ordinary Docker-application and Redis records without requesting deployment, captures their Overview image panels, and proves the configured reference and public registry digest appear with `Unknown` / no running container. Screenshots contain only the image panel. Video hides connection-string code elements before service drawers are opened. Its disposable records and project were deleted via Dokploy APIs; see `app-db-result.json`. Earlier unmasked optional captures were deleted and replaced with these clean captures.

Live outcome: both scripts passed on :3052. All application, database, compose, and project fixtures created by these scripts were deleted via APIs. The proof records include cleanup confirmations.
Implemented manual image checks with digest display, status pills, ownership validation, anonymous registry access, 5-second timeout, 10-minute cache, and two concurrent lookups. No polling or automatic redeploys.

Files touched: dashboard `.dockerignore`, `ServiceDrawer.tsx`, new `ImageUpdatePanel.tsx`, image-update API route, `docker.ts`, `image-ref.ts`, `image-registry.ts`, `image-update.ts`, and five test files.

Checks passed:

- `cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run` — 90 tests.
- `git diff --check` — clean.
- Docker build and local :3052 proof — passed; [exact commands/results](/workspace/sy-codex-notes/fix/image-update-check-proof/checks.txt).

[ screenshot](/workspace/sy-codex-notes/fix/image-update-check-proof/02-public-tag-and-pinned.png) · [MP4](/workspace/sy-codex-notes/fix/image-update-check-proof/image-update-check.mp4). All throwaway services/projects deleted via API.

Limitations: live runtime proof used Compose. GHCR and “Update available” use fake-fetcher tests. Docker inspection covers the local daemon only.
