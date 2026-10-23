# #58: operator guide refresh (DOC-P2-2)

PR: https://github.com/sbdeals/Switchyard/pull/58. Docs-only and non-UI, so the proof is a terminal before/after. Captured 07:20 EDT, 2026-10-23.

- **before-terminal.txt**: the stale claims on `origin/main`:
  - Compose shows only "Overview · Compose · Logs · Settings".
  - Variables is listed for "applications and databases" only, and Domains/Deploys for "applications only".
  - "must be public" and "Public sources only".
  - All of these sit next to main's real `COMPOSE_TABS` array.
- **after-terminal.txt / proof.sh**: run from the branch root. Prints each before/after claim beside the `grep -n` code evidence (ServiceDrawer tab arrays, GithubDeployModal, `quickDeployGithubAction`, `saveComposeEnvAction`, local-ingress). It ends with `PASS: all targeted stale DOC-P2-2 phrases are gone` and exits 0.

Caveat: the screenshots in docs/images were not re-shot, and several are now stale (the list is in the PR body).

## Update 07:55 EDT: 3 of the 10 stale screenshots re-taken (commits 01c5c0b, 608d7cb)

Captured at 2× (1440×900) with [`screenshots/docshots.mjs`](screenshots/docshots.mjs). The capture ran against a **main-code** dashboard image (`switchyard-dash:main-docs`, built from this branch, which is docs-only) on a separate port, so the shots match what main ships rather than the integration build.

| Screenshot | Before (stale) | After |
|---|---|---|
| new-service-menu | [before](screenshots/before-new-service-menu.png) | [after](screenshots/after-new-service-menu.png): adds the From GitHub, Templates / App catalog and project selector rows |
| deploy-image-filled | [before](screenshots/before-deploy-image-filled.png) | [after](screenshots/after-deploy-image-filled.png) |
| compose-editor | [before](screenshots/before-compose-editor.png) | [after](screenshots/after-compose-editor.png): adds the Networking/Deploys tabs |

The other 7 (app-overview, app-variables, app-domains, db-overview, db-logs, db-metrics, db-settings) were **not** replaced.
- On this bridge-mode demo host, main's native Dokploy application and database deploys fail ("Not running · Last deploy: Failed"), so those drawers would show failed services and empty logs and metrics.
- The Variables capture would also have shown a plaintext connection password.
- They need a host where native app and db deploys work.
