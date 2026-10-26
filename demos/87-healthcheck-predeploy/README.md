# Healthcheck path + pre-deploy command (RAILWAY-GAP top-10)

Branch `codex/healthcheck-predeploy` (base `main`).

**Before** (`main`, `before.mp4`, `before-1-settings.png`): the Settings tab of a Compose service only shows the app name, the created date and the Danger zone. There is nowhere to set a healthcheck or a pre-deploy step.

**After** (`after.mp4`, `after-1..3`): a new **Deploy checks** card has these fields:
- Compose service name
- Healthcheck path
- Timeout
- Container port
- Pre-deploy command

The walkthrough fills in the fields but does not save them.

**End-to-end proof** (from the session, on a local throwaway stack, raw single-service Compose):
- `pass-*`: the healthcheck returns 2xx and the deploy ends as **done**.
- `fail-*`: the healthcheck fails, the container is **unhealthy** and the deploy ends as **error**.
- `abort-*`: the pre-deploy command exits 17, so the deploy is **error** and the app container never starts.

`container-evidence.json` holds the matching `docker inspect` results.

How the settings map onto the Compose file:
- **Healthcheck:** adds a curl healthcheck that only passes on 2xx.
- **Pre-deploy:** adds a one-shot `sy-predeploy` service, and the app gets `depends_on: service_completed_successfully`.
- **Deploy command:** becomes `up -d --build --remove-orphans --force-recreate --wait --wait-timeout N`.

Limits:
- **Applications:** they get `healthCheckSwarm` only when the host is a verified Swarm manager. Otherwise they show "Not supported on this host", which is what this VM does. A native pre-deploy step for applications is not supported.
- **Compose file rewrite:** saving rewrites the Compose YAML, and comments are lost.
- **Health check image:** the image must include `curl` and `sh`.
- **Traffic:** there is no atomic traffic cutover or rollback.

Checks: lint, tsc and vitest pass (3 files, 86 tests). The js-yaml spec is `^4.3.0`, matching #77 and #80.
