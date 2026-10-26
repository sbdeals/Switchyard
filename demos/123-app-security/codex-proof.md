# Application HTTP settings proof

Local proof ran on http://127.0.0.1:3056 against Dokploy v0.30.10. No Swarm initialization, production deployment, external credentials, or paid APIs were used.

## Implemented and checked

Application Settings contains redirect create/edit/delete (regex, replacement, permanent) and basic-auth create/replace/delete. Password inputs clear after save/cancel, stored rows show four bullets, and dashboard action responses did not contain either generated password. Invalid regex is rejected before mutation; the URL preview expands Go-style capture references. Settings saves did not create deployments.

Server actions verify the application appears in the current user's project.all tree; edits/deletes additionally verify the row in application.one. Upstream bodies are allowlisted and security responses/errors cannot echo passwords.

## Files in the repo

- dashboard/src/components/service/networking.tsx
- dashboard/src/components/service/ServiceDrawer.tsx
- dashboard/src/app/actions.ts
- dashboard/src/lib/dokploy.ts
- dashboard/src/lib/app-security.ts
- dashboard/src/lib/app-security.test.ts
- dashboard/src/lib/app-security-actions.test.ts
- dashboard/src/lib/app-security-dokploy.test.ts
- dashboard/vitest.config.mts
- dashboard/.dockerignore (exclude test sources from production build context)

## Exact checks and results

- `cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run` — passed: no lint warnings, TypeScript passed, 3 test files / 84 tests passed.
- `git diff --check` — passed.
- `sudo docker build -q -t switchyard-dash:app-security dashboard && /tmp/runsy.sh sy-app-security 3056 app-security` — build passed and local login returned HTTP 200.
- `BASE=http://127.0.0.1:3056 node /workspace/sy-codex-notes/fix/app-security-proof/proof.mjs` — UI CRUD, preview, password replacement/cancellation, action-response secrecy, no automatic deployment, and API readback checks passed (checks.json).
- `ffprobe -v error -show_entries format=duration,size -of json /workspace/sy-codex-notes/fix/app-security-proof/app-security.mp4` — valid MP4, duration 38.8 seconds.

## Deployment limitation

Throwaway application `app-security-mvp31fny` used public `traefik/whoami:v1.10` with `app-security-mvp31fny.172.30.0.2.sslip.io` pointing at the VM's IP. Dokploy pulled the image but native deployment failed with HTTP 503: “This node is not a swarm manager.” See deploy.log and deploy-readback.json. Docker reports Swarm inactive / ControlAvailable false. No swarm init was attempted.

Curl with and without generated credentials timed out (exit 28 / HTTP 000). Therefore ingress redirect behavior and the requested HTTP 401/200 authentication pair remain unproven. api-readback.json proves the saved redirect and replacement credential configuration without retaining passwords.

## Evidence

- 01-invalid-regex.png: validation error
- 02-preview.png: this URL → that URL
- 03-saved-settings.png / 04-password-replaced.png: saved redirect and masked credentials
- 05-deploy-attempt.png: failed native deployment
- 06-settings-deleted.png: UI delete actions
- app-security.mp4: recorded browser flow
- api-readback.json, deploy-readback.json, deploy.log, curl-results.json, checks.json, cleanup.json

## Cleanup and remaining limitations

Application and project were deleted via application.delete/project.remove, and their absence from project.all was verified. Their domain and HTTP settings were removed. The only dashboard container, volume, and image tag created in this session were removed afterward. Existing demo services were left intact.

The regex editor intentionally accepts a shared JavaScript/Go subset; named groups and inline flags are outside it. Preview accepts ASCII URLs up to 512 characters and refuses complex backtracking patterns while allowing valid rules to be saved. Vitest is present in the provisioned node_modules but absent from the base package manifest/lockfile; no dependency or lockfile was changed. Test sources are excluded from the Docker build context, so the existing locked production build still succeeds.

Dokploy contract references: https://github.com/Dokploy/dokploy/tree/v0.30.10/apps/dokploy/server/api/routers and https://github.com/Dokploy/dokploy/tree/v0.30.10/packages/server/src/db/schema (redirects.ts, security.ts; application.one includes both arrays).
