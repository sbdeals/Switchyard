# Secret-redaction audit

Scope: `loadWorkspace` → `page.tsx` → `Workspace` service props, stacked on #140. Full values remain in server services for inference and server operations. The new readers check the current user's project/environment/service tree with the same helper as Variables, then select only the requested fields. Runtime service types and IDs are validated, and failures retain login redirects or return generic errors.

| Field | Handling |
| --- | --- |
| All services: `env` | Existing #140 null redaction and Variables lazy fetch retained. |
| Application `webhookUrl` (derived from Dokploy `refreshToken`) | Null prop plus `hasWebhook`; masked UI fetches only on Reveal/Copy. Copy keeps display masked. |
| Application `gitUrl` (`customGitUrl`), duplicate `repository` | URL userinfo stripped. Git settings save restores stored URL when the submitted value equals its redacted form. |
| All services `dockerImage`; application `registryUrl` | URL userinfo stripped; saves preserve stored URL on unchanged redacted resubmission. |
| Application `redirects[].replacement` | URL userinfo stripped. UI creates/removes redirects; it does not round-trip existing replacements. |
| Application `command`, `healthCheckSwarm.Test` | Entire command/health-check props null; Build/Deploy editor fetches current commands on mount, then enables editing. |
| Database `command` | Null; no client consumer or editor exists. |
| Compose `composeFile` | Null; Compose editor loads raw YAML only when opened, and saves exact text. |
| Application `description` | Null; unused client field, potentially secret-bearing free text. |
| Backend workspace-load errors | Restored diagnostic panel; URL userinfo and deploy-token paths scrubbed before rendering. Potentially truncated errors use a generic fallback. |
| Database `databasePassword` | Explicitly out of scope: #134. |

Every client use of `composeFile` on this base:

1. `ComposeEditorTab` initial value/dirty baseline: replaced with lazy fetch and local saved baseline. No editable field or save button before successful load.
2. `ComposeDomainsTab` target service suggestions: `serviceNames` computed on server, preserving existing best-effort key extraction.
3. `ServiceDrawer` Postgres Data-tab detection: `hasPostgres` computed on server, preserving existing image-pattern detection.

Volumes use separate mount fetches; there is no client YAML-based declared-volume or port parser on this base. Compose networking ports come from domain metadata. Schedule commands and mount file contents already load on demand. Docker registry passwords, SSH/Git-provider credentials, build secret records, and basic-auth passwords are not mapped into workspace service props (`security` includes username only). Runtime data is health/count metadata only.

Remaining display/config metadata includes names, project/environment names, deployment titles, redirect regex, domain/path, branch/build path/watch paths, Dockerfile filename/context/stage, and database name/user. These are not general secret containers, but arbitrary user-pasted tokens in them cannot be identified semantically. URL redaction targets userinfo, not arbitrary query/path tokens. SCP-style `git@host:path` is intentionally retained. No claim of universal secret scanning is made. Compose metadata keeps the pre-existing regex behavior; this change does not add full YAML parsing.

Validation: full dashboard lint, TypeScript and Vitest commands, plus local Docker build and undeployed API fixtures. See report.json and screenshots/video for the interaction proof. No external deployment, Git clone, paid model API, or real webhook configuration is involved.

## Files touched

- `dashboard/src/app/actions.ts`
- `dashboard/src/app/page.tsx`
- `dashboard/src/components/service/AppTabs.tsx`
- `dashboard/src/components/service/ComposeTabs.tsx`
- `dashboard/src/components/service/ServiceDrawer.tsx`
- `dashboard/src/lib/dokploy.ts`
- `dashboard/src/lib/service-redaction.test.ts`
- `dashboard/src/lib/service-redaction.ts`
- `dashboard/src/lib/app-secret-editors.test.ts`
- `dashboard/src/lib/client-secret-loader.test.ts`
- `dashboard/src/lib/client-secret-loader.ts`
- `dashboard/src/lib/service-secrets.test.ts`
- `dashboard/src/lib/url-credentials.test.ts`
- `dashboard/src/lib/url-credentials.ts`
- `dashboard/src/lib/workspace-page.test.ts`

## Final checks

- `cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run`: passed; 9 files, 244 tests.
- `sudo docker build -q -t switchyard-dash:secret-redaction dashboard`: passed.
- `/tmp/runsy.sh sy-secret-redaction 3073 secret-redaction`: HTTP 200.
- `BASE=http://127.0.0.1:3073 node /workspace/sy-codex-notes/fix/secret-redaction-proof/proof.mjs`: passed all 9 recorded checks; application, compose and project deleted through API and absence verified.
- `git diff --check`: passed. No lockfile changes or commits.

Proof limitations: fixtures were never deployed or cloned. Ownership denial is covered by Vitest with mocked per-user trees; live proof uses the local demo account. Existing arbitrary metadata and databasePassword are intentionally outside the redaction guarantees. The test dashboard remains available on :3073.

## Lead review r1

Restored the workspace error `<pre>` with the original styling. A shared error scrubber preserves ECONNREFUSED and validation details, removes userinfo from every error URL, masks `/api/deploy/<token>`, and replaces known submitted/restored URLs and registry credentials (including escaped forms). Scrubbing occurs before value replacement so a submitted value such as `https` or `deploy` cannot disguise a credential-bearing path.

Application/DB scalar settings now return sanitized backend validation details. Compose YAML, command/health-check/description text, unusable errors, and potentially truncated Dokploy backend bodies retain generic messages because partial inline secrets cannot safely be matched. Lazy secret reads still use their existing generic errors.

R1 source files: `src/app/actions.ts`, `src/app/page.tsx`, `src/lib/error-redaction.ts`, `src/lib/error-redaction.test.ts`, `src/lib/service-secrets.test.ts`, `src/lib/workspace-page.test.ts`. Other implementation files were left unchanged by r1.

Rebuilt and reran the full :3073 proof: all 9 checks passed, initial/final HTML and RSC remained clean, editor/reveal/save paths worked, and new throwaways were deleted through the API. Screenshots, MP4 and report.json are refreshed. No fixtures were deployed or cloned.
