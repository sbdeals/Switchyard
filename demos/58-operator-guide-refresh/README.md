# #58: operator guide refresh (DOC-P2-2)

PR: https://github.com/sbdeals/Switchyard/pull/58. Docs-only and non-UI, so the proof is a terminal before/after. Captured 07:20 EDT, 2026-10-23.

- **before-terminal.txt**: the stale claims on `origin/main`:
  - Compose shows only "Overview · Compose · Logs · Settings".
  - Variables is listed for "applications and databases" only, and Domains/Deploys for "applications only".
  - "must be public" and "Public sources only".
  - All of these sit next to main's real `COMPOSE_TABS` array.
- **after-terminal.txt / proof.sh**: run from the branch root. Prints each before/after claim beside the `grep -n` code evidence (ServiceDrawer tab arrays, GithubDeployModal, `quickDeployGithubAction`, `saveComposeEnvAction`, local-ingress). It ends with `PASS: all targeted stale DOC-P2-2 phrases are gone` and exits 0.

Caveat: the screenshots in docs/images were not re-shot, and several are now stale (the list is in the PR body).
