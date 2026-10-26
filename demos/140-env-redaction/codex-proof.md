# Environment redaction proof

Implemented in `/workspace/wt-env-redaction`, branch `codex/env-redaction`. No commit or push.

## Result

Workspace page props contain `env: null` for applications, compose, and every database engine. The server retains the original service objects for edge inference and other server consumers. Variables loads automatically on mount through `loadServiceEnvAction`, checks the service against the current session's uncached Dokploy project tree before fetching detail, and returns generic errors. The tab shows a loading skeleton, disables editing until loading succeeds, and makes each successful save the new baseline without overwriting newer edits.

No other client uses of `service.env` were found. Variable counts use the loaded editor value, so no page-level count field was needed.

## Audit

| Field | Finding / scope |
| --- | --- |
| `env` | Previously serialized by all service projections. Redacted at the page/client boundary in this change. |
| `buildArgs`, `buildSecrets` | Not projected into `Service` or workspace props. |
| Registry username/password | Not projected; only `registryUrl` is included. |
| Basic-auth password | Not projected; security entries include only ID and username. |
| S3 access/secret keys | Not in workspace services; destination listing also omits keys. |
| `databasePassword` | Still serialized on this base; intentionally left to separate draft #134. |
| `webhookUrl` | Still carries the application's deploy bearer token in page props; needs a separate lazy-loading change. |
| `gitUrl`, `repository` | Raw custom Git URLs can contain embedded credentials; remain in page props. |
| `composeFile` | Arbitrary YAML can contain inline env/credentials; remains in page props and supports other existing client features. |
| `registryUrl`, commands, health-check commands | User-supplied text could contain credentials; not sanitized by this env-only change. |

Existing save actions use Dokploy's authorization with the current user's session cookie. They do not implement a separate explicit membership guard on this base. The new reader adds that guard and does not use the cross-user `knownAppNames` cache.

`loadWorkspace` remains unchanged. `inferEdges` is tested against original env after redaction. No `${{ref}}` resolver exists on this base, so no reference-resolution implementation was changed or live-tested.

## Local proof

Final run: 2026-10-26 11:17:32–11:17:44 UTC, dashboard `http://127.0.0.1:3071`, local Dokploy `http://localhost:3000`.

- Application: `env-redaction-app-mvp5wxza`.
- Compose: `env-redaction-compose-mvp5wxza`.
- Each fixture used a different random sentinel in its env field.
- Actual page HTML and separate `RSC: 1` responses contained fixture names and neither sentinel before Variables opened.
- Opening each Variables tab returned its own sentinel in the real server-action response and excluded the other fixture's sentinel.
- Loading skeletons and populated editors were captured.
- UI saves round-tripped through Dokploy detail reads and reopening the tab. Save responses that revalidated the page excluded the sentinel. Editing away from and back to the saved value confirmed the updated baseline.
- HTML and RSC still excluded both sentinels after saves and closing the tabs.
- Both fixtures and the containing project were deleted through Dokploy APIs. The project's absence was verified. Earlier failed recorder attempts also deleted their own fixtures; the first empty project was removed with `cleanup-first-project.mjs`.

The fixtures were configuration-only; no app deployment or swarm initialization was needed. No pre-existing apps were changed. The session-created dashboard container `sy-env-redaction` remains running on :3071 for review.

Raw HTML/RSC were inspected in memory and not saved because this base has other unrelated credential-bearing fields. `report.json` records response sizes, SHA-256 hashes, assertions, fixture IDs, and API cleanup results. The recorder delays the load action by one second to capture the skeleton and forwards the actual server response without modifying its contents.

Artifacts:

- [MP4](env-redaction-proof.mp4)
- [Assertion report](report.json)
- [Workspace before Variables](01-workspace-before-variables.png)
- [App loading](21-application-loading.png), [loaded](22-application-loaded.png), [saved](23-application-saved.png), [reopened](24-application-reopened.png)
- [Compose loading](31-compose-loading.png), [loaded](32-compose-loaded.png), [saved](33-compose-saved.png), [reopened](34-compose-reopened.png)
- [Recorder](proof.mjs)

## Checks

All passed on final code:

```sh
cd /workspace/wt-env-redaction/dashboard && npm run lint && npx tsc --noEmit && npx vitest run
```

Exit 0. Three test files, 40 tests passed: redaction/immutability/all engines/server edges (10), real action authorization/session/error paths with mocked network (22), editor loading/error/baseline/concurrent edits and initial rendered skeleton (8).

```sh
cd /workspace/wt-env-redaction && sudo docker build -q -t switchyard-dash:env-redaction dashboard && /tmp/runsy.sh sy-env-redaction 3071 env-redaction
```

Exit 0. Image `sha256:e328a67e5a797481b32256f3977976a62152d39d34b2f59b2030793af7ec98e0`; local login endpoint returned HTTP 200.

```sh
BASE=http://127.0.0.1:3071 node /workspace/sy-codex-notes/fix/env-redaction-proof/proof.mjs
```

Exit 0. Both service types passed every assertion and cleanup completed.

```sh
cd /workspace/wt-env-redaction && git diff --check
```

Exit 0.

## Files touched

- `dashboard/.dockerignore`
- `dashboard/vitest.config.mjs`
- `dashboard/src/app/page.tsx`
- `dashboard/src/app/actions.ts`
- `dashboard/src/components/service/ServiceDrawer.tsx`
- `dashboard/src/components/service/VariablesTab.tsx`
- `dashboard/src/lib/dokploy.ts`
- `dashboard/src/lib/service-redaction.ts`
- `dashboard/src/lib/service-redaction.test.ts`
- `dashboard/src/lib/service-environment.test.ts`
- `dashboard/src/lib/variables-editor.ts`
- `dashboard/src/lib/variables-editor.test.ts`

Vitest is present in the supplied node_modules but is absent from this checkout's package manifest/lockfile. Neither dependencies nor lockfiles were changed. Tests and Vitest config are excluded from the production Docker context so its existing locked install still builds. A fresh test environment will need Vitest provided separately until the repository's test tooling baseline is reconciled.

Database env and cross-account denial were covered in Vitest, not with additional live database/account fixtures. The other credential-bearing page fields listed above remain follow-up work.
