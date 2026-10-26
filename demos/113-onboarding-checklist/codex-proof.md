# Onboarding checklist proof

Final local proof ran on port 3044 with a new Dokploy API-created user, `onboarding-870316ea@example.invalid`, in an empty throwaway organization.

- `proof.json`: 23 of 24 assertions passed. It records safe resource IDs, API statuses, runtime evidence, and cleanup results.
- `onboarding-checklist.mp4`: 19-second recording of the final run.
- `01-empty-workspace.png`, `02-empty-mobile.png`, `02b-empty-768x600.png`: responsive empty state.
- `07-compose-fallback-progress.png`: real first-deployment progress.
- `08-dismissed-after-reload.png`: persisted dismissal.
- `12-selected-empty-project.png`, `12b-selected-empty-project-grid.png`: selected empty project in both views.
- `15-final-checklist-state.png`: all milestones completed and checklist automatically hidden.
- `first-run/`: initial run evidence, retained separately; its proof-script assertion problems were corrected for the final run.

## Validation

From `/workspace/wt-onboarding-checklist`:

```sh
cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run
```

Passed: lint, TypeScript, and 40 tests in 3 files.

```sh
sudo docker build -q -t switchyard-dash:onboarding-checklist dashboard
/tmp/runsy.sh sy-onboarding-checklist 3044 onboarding-checklist
BASE=http://127.0.0.1:3000 node /workspace/sy-codex-notes/fix/onboarding-checklist-proof/proof.mjs
git diff --check
```

Build, dashboard startup, proof script, and diff check passed. The proof script's JSON explicitly records the one unsuccessful deployment assertion. Final image: `sha256:6c9a8f99fda4eb78fb2228fde74bb40565e3f2e3f2b4a7f1e0efbf624f41b2e4`.

## Limitation

The empty-state Docker image action created a native Dokploy application, but deployment failed because this host is not a Swarm manager. Swarm was not initialized and no deployment backend was changed. Successful image deployment through that action remains unproven here. A separate throwaway `traefik/whoami:v1.10` Compose stack deployed through Dokploy's existing API, reached `done`, and had a running container; this verified that the checklist reflects genuine successful deployment state.

GitHub and database deployment success were not exercised; they reuse the existing create actions. UI render tests cover their entry points.

## Cleanup

Both proof runs deleted their application, Compose stack, projects, user, and organization through Dokploy APIs, with successful responses. No session-created application containers remain. The final dashboard container, its data volume, and its image tag were also removed after proof. No pre-existing applications or production deployments were modified.
