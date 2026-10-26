# Deployment commit information proof

Local dashboard: `http://127.0.0.1:3029`, built from `/workspace/wt-deploy-commit-info`.

Throwaway Git compose service: `deploy-commit-info-mvoyqi3k`.
Public repository: https://github.com/docker/compose.git, tag `v2.39.4`.
Compose file: `pkg/e2e/fixtures/simple-build-test/compose.yaml`.
The fixture builds nginx locally and publishes no host ports.

Two successful sequential deployments recorded:

- SHA: `a32dc3da722e6b2e4fbfc72e40b1a697c4686460`
- Subject: `test: Set stop_signal to SIGTERM`
- Deployment IDs and original recorded title/description: `deployments.json`

Screenshots: `deploys.png`, `deploys-drawer.png`, `overview.png`.
Browser assertions: `browser-verification.json`.
Resource lifecycle: `resources.json` (cleanup sets `deleted: true`).
Cleanup completed through Dokploy's API; `cleanup.json` confirms no remaining fixture containers. The session's `sy-deploy-commit-info` dashboard container, data volume, and image tag were also removed.

Checks from this worktree:

```sh
cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run
```

Passed: lint, TypeScript, 47 tests (1 test file).

```sh
sudo docker build -q -t switchyard-dash:deploy-commit-info dashboard && /tmp/runsy.sh sy-deploy-commit-info 3029 deploy-commit-info
BASE=http://127.0.0.1:3029 node /workspace/sy-codex-notes/fix/deploy-commit-info-proof/screenshot.mjs
git diff --check
```

Production image excludes unit test files from its Docker context because the provided dependency tree has Vitest but the base package manifest/lockfile do not. No packages were installed and no lockfiles were changed.

Dokploy v0.30.10 does not persist historical deployment branches. The UI renders a branch only if that deployment records one; it never substitutes the service's current branch. Missing commit data is omitted. Manual deploys and webhook records use `Commit:` and `Hash:` respectively; the normalizer handles both. Public HTTPS github.com repository URLs receive commit links; SSH, enterprise, other hosts, and credential-bearing URLs remain plain text. No GitHub API was called.

Live proof covers Git compose deployments. Application and compose paths share the same mapper; normalization and long-subject truncation/tooltip are covered by unit/render tests. A separate live application deployment was not exercised.
