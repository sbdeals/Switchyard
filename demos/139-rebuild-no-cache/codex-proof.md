# Rebuild / deploy options proof

Local proof only: Switchyard on http://127.0.0.1:3070 against Dokploy v0.30.10 on this VM. No production deployment or paid API was used.

## Result

The application overview has a split-button disclosure with Redeploy, persistent **Clean cache on build**, and **Deploy with message**. Cache enabling requires confirmation explaining slower builds and persistence; saving the setting does not deploy. Initial deploy uses application.deploy; rebuild/message use application.redeploy and rebuild the existing checkout. Idle applications must deploy once before those options become available. New server requests validate the payload, check the signed-in user's project tree and application state, and return generic errors.

Dokploy 0.30.10 has no per-deploy clean-cache field. See its [application schema](https://github.com/Dokploy/dokploy/blob/v0.30.10/packages/server/src/db/schema/application.ts), [rebuild implementation](https://github.com/Dokploy/dokploy/blob/v0.30.10/packages/server/src/services/application.ts), and [Dockerfile builder](https://github.com/Dokploy/dokploy/blob/v0.30.10/packages/server/src/utils/builders/docker-file.ts). A temporary toggle/restore would race the queued worker. Normal deploy replaces custom messages with commit metadata; redeploy preserves them.

## Evidence

- [MP4 recording](rebuild-no-cache-proof.mp4) (13.32 seconds): options, cache confirmation flow, saved setting, explicit message deployment, history, disabling cache.
- [Menu](02-deploy-options.png)
- [Saved cache setting, no deployment](03-cache-setting-saved-no-deploy.png)
- [Message before explicit deploy](04-message-before-explicit-deploy.png)
- [Custom title and description in history](05-custom-title-history.png)
- [Cache setting disabled again](06-cache-disabled.png)
- [First-deploy guard](01-first-deploy-guard.png)
- [Build log comparison](07-build-log-comparison.png) / [standalone HTML](build-log-comparison.html)
- Unmodified API build logs: [normal](normal-redeploy.log), [no-cache](no-cache-redeploy.log), [initial](initial-build.log).
- [Browser assertions](assertions.json), [normal summary](normal-redeploy.json), [no-cache summary](no-cache-redeploy.json).

Repository built: https://github.com/nginxinc/NGINX-Demos.git, branch master, directory nginx-hello (public; no GitHub credentials or webhook configuration).

Normal redeploy reused all three Dockerfile layers (`RUN` and both `ADD`s: CACHED). With cleanCache=true, all three executed again (`RUN`: DONE 0.2s). Docker still reports the FROM base image as CACHED; the evidence does not claim base-image eviction. Both build phases completed successfully. Deployment then failed because the VM is not a Swarm manager; Swarm was not initialized.

Browser assertions confirmed opening options / editing a message / saving cache does not deploy, dismissing confirmation does not change cache, and the custom title is stored in history. Ownership failures, expired sessions, generic errors, source/status guards, payload validation, and data mapping are unit tested; no live second-account isolation test was performed.

## Cleanup

The throwaway application and its isolated project/environment were deleted through Dokploy's application.delete and project.remove APIs. [Cleanup verification](cleanup.json) confirms the project is absent. The assigned dashboard container sy-rebuild-no-cache remains on :3070 for code review. No pre-existing app/container was stopped or deleted.

## Checks

From /workspace/wt-rebuild-no-cache:

- `cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run` — passed; 62 tests in 2 files.
- `sudo docker build -q -t switchyard-dash:rebuild-no-cache dashboard` — passed (final image sha256:ee1550cd5d15b2c626829cd302351ab88181678de8598747ecd736dd8f60d9e4).
- `/tmp/runsy.sh sy-rebuild-no-cache 3070 rebuild-no-cache` — login HTTP 200.
- `BASE=http://127.0.0.1:3070 node /workspace/sy-codex-notes/fix/rebuild-no-cache-proof/proof.mjs` — all browser assertions passed.
- `BASE=http://127.0.0.1:3070 node /workspace/sy-codex-notes/fix/rebuild-no-cache-proof/cleanup.mjs` — deleted and verified absent.
- `git diff --check` — passed.

Vitest is present in the pre-provisioned dashboard/node_modules but absent from this base's package manifest. Tests are excluded from the Docker build context so production TypeScript compilation does not require the test-only dependency. No install command, lockfile, or package manifest change was made.
