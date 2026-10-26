# Shared variables — local proof

Implemented in `/workspace/wt-shared-vars`, branch `codex/shared-vars`. No commits, lockfile changes, paid APIs, production access, or external deployments.

## Verified Dokploy contract

Read the local `dokploy` container's v0.30.10 source:

- `project.update({ projectId, env })` and `environment.update({ environmentId, env })` accept raw dotenv text.
- Exact references: `${{project.KEY}}` and `${{environment.KEY}}`. Whitespace inside the key is meaningful. Missing references fail deployment; empty values are defined. Values are referenced explicitly, not inherited automatically.
- `project.all` returns project env but omits environment env. The selected environment uses `environment.one` after membership validation. All new reads/writes check the current user's project tree; environment writes check its membership in that project.
- dotenv 16.4.5: last duplicate wins, quoted multiline values, comments outside quotes, double-quoted newline/carriage-return escapes.
- Source: `/app/node_modules/@dokploy/server/src/utils/docker/utils.ts:459`, `db/schema/project.ts:68`, `db/schema/environment.ts:65`, `services/environment.ts:34`; project/environment router sources embedded in `/app/dist/server.mjs.map`.

## Checks

`cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run`

Passed: lint, TypeScript, 59 tests across 3 files (33 parser/reference, 12 authorization/action, 14 UI render tests). `git diff --check` passed.

`sudo docker build -q -t switchyard-dash:shared-vars dashboard && /tmp/runsy.sh sy-shared-vars 3032 shared-vars`

Passed; HTTP 200 on :3032. First build exposed a base mismatch: Vitest exists in supplied node_modules but is absent from package.json/lockfile. Test files and Vitest config are excluded from Docker context; no dependencies or lockfiles were changed. The build emits an existing tracing warning for agent/key-store.ts.

`BASE=http://127.0.0.1:3032 node /workspace/sy-codex-notes/fix/shared-vars-proof/run.mjs`

Passed. Uses provided demo-tools open/login helpers. Creates uniquely named `shared-vars-proof-*` project and Compose service, adds project/environment shared values through the new UI, confirms masking, reveal/copy, add/delete, multiline editing, save, and unsaved draft preservation across environment selection. Inserts both reference scopes from the service picker, verifies defined/missing status, and deploys public `alpine:3.20` with no published ports or domains.

`container-proof.txt` contains the real output of `sudo docker exec <this-session-container> printenv PROJECT_PROOF ENVIRONMENT_PROOF`. It was asserted to equal:

```
hello-from-shared-project
hello-from-shared-environment
```

The container-output screenshot/video section is explicitly labeled as captured Docker CLI evidence. It is not the dashboard Console: that existing Console could not locate the fixture's explicit container name. Earlier failed proof attempts were cleaned up as well. One screenshot attempt hit transient VM ENOSPC; capacity had recovered on retry, with no unrelated resource cleanup.

## Artifacts and cleanup

- `01`–`04`: shared editor and reference screenshots.
- `05-container-resolved-values.png`: actual asserted Docker CLI output, displayed as a labeled evidence artifact.
- `06-throwaways-deleted.png`: project removed.
- `shared-vars-proof.mp4`: successful browser run; source WebM also retained.
- `result.json`: checks, unique fixture/container name, cleanup results.

The script deletes only its created Compose service/project/environments via dashboard server actions and verifies its container is gone. The temporary `sy-shared-vars` dashboard and the two successful dashboard images created in this session are also removed after recording.

## Limits

Definition badges check direct shared keys, not recursive resolution. Rare strings that dotenv cannot serialize losslessly are rejected rather than changed. Live deployment proof covers Compose; application/database shared-reference support was verified in Dokploy source but not deployed. Whole env blocks are saved using Dokploy's existing last-write behavior. A fresh dependency install still needs the base's Vitest dependency discrepancy resolved by the lead.
