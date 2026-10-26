# Bridge deploy hooks

Managed Git repo services show the resolved branch head in Deploys, for example
`Deploy a1b2c3d · Fix header`. Settings → Deploy on push provides Enable/Disable,
Regenerate, Payload URL, and Secret. The account that configures a hook needs
current Dokploy service management access to retrieve or change its settings.

In GitHub repository Settings → Webhooks → Add webhook, copy Payload URL and
Secret, choose **Content type: application/json**, **Just the push event**, and
leave **Active** checked. GitHub needs an externally reachable dashboard URL.
Regenerate replaces both Switchyard's URL and secret.

## Authentication and installed Dokploy investigation

The installed local container is `dokploy/dokploy:v0.30.10`. Its actual handler
was read with `sudo -n docker exec dokploy cat` at
`/app/.next/server/pages/api/deploy/compose/[refreshToken].js`, along with the
extraction helpers in `/app/.next/server/chunks/7794.js`.

The handler finds the compose by `refreshToken`, requires `autoDeploy=true`, and
queues a compose deploy. It checks branches/watch paths for Git providers, but
**raw compose skips those checks**. A GitHub-shaped `head_commit.message` becomes
the deployment title and `head_commit.id` becomes `Hash: <sha>` in its description.
The handler does not verify HMAC; its refresh token is a service-only bearer
capability. Switchyard keeps that token server-side and performs its own raw-body
HMAC, exact tracked-branch check, deletion/event filtering, and debounce first.

**Push-only hooks store no user session, cookie, password, or user API key.**
PR previews require a separately opted-in automation key, described below.
Enable/Disable/Regenerate disables native auto-deploy and rotates the native
compose token using the authenticated owner's `compose.refreshToken` mutation.
Enabling then turns native auto-deploy back on. Disable and regeneration revoke
old native URLs. A settings failure leaves the Switchyard hook disabled until
retried. Reading Settings is read-only and cannot undo a concurrent rotation.

The dashboard persists only hook configuration, the native refresh token, Git
source metadata, and recent delivery identities in `/app/data/deploy-hooks.json`
in the container (`./data` when started from the dashboard directory).
`SWITCHYARD_DATA_DIR` overrides the directory. Persist that directory on container
replacement. Files use mode 0600. Do not attach their contents to bug reports.
The hook survives sign-out and session expiry; it has no session renewal flow.

## Local VM proof

The round-2 proof uses only the local Dokploy on `:3000`, this worktree's dashboard
on **`:3015`**, a new isolated test owner/organization, and a new `f-hook-*` app.
The existing dashboards on `:3001`/`:3002` and pre-existing demo apps were not
changed. No production credentials or Railway endpoints were accessed.

Run the dashboard with `npm run dev -- -p 3015 --webpack` when its existing
`node_modules` symlink causes Turbopack to reject the filesystem root.

A new bare `/workspace/rb-git/f-hook.git` fixture was pushed twice and refreshed
with `git update-server-info`. The bounded resolver detected each new SHA via
`http://127.0.0.1:8765/f-hook.git`. That server listens only on host loopback and
was unreachable from Dokploy at the Docker gateways, so the actual successful
build uses the permitted public sample `docker/welcome-to-docker`, branch `main`.
Its SHA at proof time was `68c1b9f87c41fb3fef2667e27149865c2f42d1eb`, with headline
`fix: use lockfile-aware install commands (#134)`.

The transcript is `/workspace/sy-codex-notes/fix/f-hook-proof.txt` (outside the
diff). It records unsigned → 403, wrong ref → 200 ignored, signed push → 202,
duplicate → 200 with exactly one added deployment, and a successful deployment
after the owner signed out. Disable rotated the native token, set native
`autoDeploy=false`, and made both old native and Switchyard URLs return 404.
The new `f-hook-b0716c6c` demo is retained with its hook disabled.

Browser automation did not hydrate the workspace reliably, so UI clicks and
screenshots remain unproven. The transcript contains actual live deployment
records, including SHA/headline and successful statuses. Vitest covers the
rendered deploy rows and Settings instructions. Initial proof harness errors
(a missing `sha256=` prefix and a dev manifest reload) are recorded alongside
the corrected successful retest.

To repeat deliveries from this VM, enable the hook, copy the Payload URL and
secret from Settings, then run the following. The secret is entered at a hidden
prompt, not recorded as a literal in shell history. The `sha256=` prefix is
required. No dashboard cookie is sent.

```bash
read -rp 'Payload URL: ' SY_HOOK_URL
read -rsp 'Webhook secret: ' SY_HOOK_SECRET
printf '\n'
export SY_HOOK_SECRET
payload='{"ref":"refs/heads/main"}'
signature=$(printf '%s' "$payload" | node -e '
  const crypto = require("node:crypto");
  const body = require("node:fs").readFileSync(0);
  process.stdout.write("sha256=" + crypto.createHmac("sha256", process.env.SY_HOOK_SECRET).update(body).digest("hex"));
')
curl -sS -i -X POST "$SY_HOOK_URL" \
  -H 'Content-Type: application/json' \
  -H "X-Hub-Signature-256: $signature" --data-binary "$payload"
unset SY_HOOK_SECRET signature
```

Expected results: missing/bad signature → 403; signed wrong branch → 200 ignored;
signed matching push → 202 and a new commit-labelled deployment; identical retry
within 60 seconds → 200 duplicate with no additional deployment. Disabled and
old regenerated Switchyard URLs return 404. Old native URLs also return 404
following rotation. Open Deploys to see the row and successful build logs.

## Limits

- The persisted store and settings serialization support one dashboard process,
  not multiple concurrent replicas.
- Source edits through Switchyard synchronize the hook's ref/repo snapshot.
  After editing directly in Dokploy, re-enable the hook in Switchyard to refresh
  that snapshot. Native webhook deploys use the already-saved compose/env; they
  do not run Switchyard's session-dependent variable-reference or routing repair
  routines before each push.
- Git metadata is bounded to 2 seconds / 1 MiB for refs (smart or static HTTP),
  plus an optional 1 second / 256 KiB unauthenticated GitHub headline lookup.
  Failure leaves deployment working with a SHA-only or fallback title.
- The label samples branch head before dispatch; builds still follow the branch,
  so another push between lookup and checkout can race the displayed SHA.
- Hook bodies are capped at 1 MiB/five seconds. Debounce survives restarts and
  suppresses identical signed commit identities (or exact generic bodies) for
  60 seconds, up to 128 unique identities per service in that window.

## PR previews (opt-in)

For a local, managed public GitHub repo service, enable **Deploy on push**, then
**PR previews** in the same Settings panel. Both switches default off. The account
that configured the hook must still have service management access to change
preview settings or manually delete a preview. Preview services cannot themselves
be preview parents. Remote-server services are not supported by this bridge path.

Keep the same Payload URL and Secret. In GitHub choose **Let me select individual
events → Pushes and Pull requests**, with `application/json` and Active checked.
No second webhook endpoint is used. `pull_request_target` and other event types
are ignored. PR events go through the same exact-byte HMAC verification, 1 MiB
body cap and five-second body deadline as pushes. Management requests share a
five-second deadline; native deployment dispatch has its existing five-second
timeout. Public replies contain only generic errors.

- `opened`, `reopened`, and `synchronize` create/update `<parent>-pr-<number>` in
  the same project. An existing environment named `preview` (case insensitive)
  is preferred; otherwise the parent's environment is used. No environment is
  created. Each preview has its own generated domain and network alias.
- The source is the signed PR's head `clone_url` and `ref`. The Compose build
  context is pinned to the full head SHA. Only public `https://github.com/owner/repo`
  sources are accepted; URLs with credentials, local hosts, and other providers
  are rejected. The base repo must match the configured parent repo.
- Preview builds inherit the parent's Dockerfile path/subdirectory and current
  env values. Explicit `${{vault.…}}` references (including annotated resolved
  values and their same-service aliases) are omitted. **Ordinary bridge variables
  have no secret/sealed flag: other values, including plain credentials and
  resolved service references, are copied.** Reference annotations are stripped
  so the preview keeps a snapshot. Parent
  mounts, volumes, custom Compose instructions, and domains are not copied.
  Fork previews default off. **Allow fork PR previews** is a separate explicit
  switch because untrusted fork code would receive those same env values.
- Deploy rows read `PR #12 · a1b2c3d · Title`. Preview cards on the canvas and
  project grid show `PR #12 · branch` below their parent-derived name, with their
  own URL. Parent Settings polls its preview list every ten seconds and provides
  **Delete preview**, including retrying a pending cleanup.
- `closed`, merged or unmerged, deletes the owned preview with
  `compose.delete(deleteVolumes: true)`. A missing/deleted head repository does
  not prevent cleanup. Closing a PR without a stored preview is a no-op. Turning
  **PR previews** off stops new preview deployments but permits close cleanup;
  disabling the entire deploy hook returns 404 for all deliveries, so use manual
  deletion for any remaining previews.

### Automation authorization and ownership

The native refresh-token endpoint only queues deployments: it cannot create,
update, or delete services. Enabling previews therefore creates a named
`Switchyard PR previews <service>` Dokploy API key using the current owner's
authenticated session. **Dokploy v0.30.10 keys inherit that user's permissions
within the organization; they do not have a service-level scope.** The toggle
discloses this. Switchyard restricts lifecycle operations to the recorded project,
parent and preview identities. This application-level restriction is not a
backend credential scope. Use a dedicated account with limited access where
appropriate. A compromised dashboard encryption key and data store would expose
the automation account's full backend permissions.

The key is encrypted with AES-256-GCM under a purpose-specific key derived from
`SWITCHYARD_SESSION_SECRET`, bound to its parent service ID. Only ciphertext and
its revocation ID are persisted in the existing mode-0600 hook store. Browser
sessions and passwords are never retained for automation. No automation key,
native refresh token, or ownership marker is returned to Settings. Disabling
previews revokes the key once no previews remain; otherwise it is retained for
close cleanup and revoked when the last preview is deleted. Revocation in
Dokploy also stops unattended lifecycle operations. Manual deletion uses the
current owner's session and still works after key revocation. Preserve both
dashboard data and the encryption secret across container replacement.

Each create reserves a random marker and a slot in the persistent hook record
before calling Dokploy. The marker is stored in the service description,
`x-switchyard` metadata and `io.switchyard.preview` container label. Updates and
deletes verify the stored service ID, appName, name, environment, project and
description. A matching name alone never grants ownership. A timed-out create
is recovered by its stored marker; it is never blindly repeated. If no created
service can be recovered, manually delete that reservation before retrying.
An edited preview Compose file that no longer matches the generated stack is
also refused: it might mount another service's volumes. Restore its generated
configuration before retrying cleanup.

Dokploy removes its database row before best-effort Docker cleanup. Switchyard
retains a deleting record until local cleanup succeeds, and retries only
containers/volumes matching **both** the stored compose project and random
feature label. Removing an owned container also removes its anonymous volumes.
No volume pruning or name-prefix deletion is performed.

A close during an active build first disables native auto-deploy and clears only
that preview's waiting jobs. Cleanup waits for the active build to finish and
retries after the HTTP response for up to ten minutes; it never invokes Dokploy's
global build-kill command. A restart or a longer/unavailable build leaves a
visible **Cleanup pending** record for a signed retry or manual Delete preview.

Settings changes and preview lifecycle operations serialize per parent in the
single dashboard process. The cap is **five previews per parent**, including
pending creates/deletes; a new PR at capacity receives HTTP 429 with an explicit
reason. Existing previews can still update or close. Delivery IDs and PR
number/action/SHA identities share the persisted 60-second debounce; the last
successful action/SHA of each active preview also suppresses identical retries
beyond that window. Failed operations release their claim for retry. This is
single-process deduplication, not an exactly-once transaction with Dokploy;
a crash between native queue acceptance and saving its result can repeat a
deployment, but cannot create a second preview service.
Closing retires that preview's action identities while retaining delivery IDs,
so reopening/closing the same SHA starts a new lifecycle without treating old
delivery retries as new events.

Port selection uses the copied `PORT` variable or the pinned public Dockerfile's
EXPOSE hint, falling back to 3000. Unlike interactive repo creation, there is no
post-build image-port watcher for unattended previews. An ambiguous Dockerfile
needs an explicit parent `PORT`. Arbitrary Dockerfile builds and copied env are
not a security sandbox: only enable previews for code you trust.

### Local PR preview proof — October 26, 2026

The final run (`8929d02a`, 06:11–06:12 UTC) used a newly built dashboard container
`pr-preview-proof-8929d02a` on **127.0.0.1:3007**, local Dokploy `:3000`, and a
new test owner, organization, project and parent `pr-preview-8929d02a`. No
existing apps, containers, owners, settings or domains were modified. The test
owner was seeded locally without reading existing credentials; hook enablement
and preview settings used the real authenticated dashboard server actions.

The only source was the public `docker/welcome-to-docker` repository. Locally
signed payloads exercised the existing hook; no GitHub webhook was configured.
Domain checks connected to **127.0.0.1:80** using the generated preview Host
header, never to the public IP embedded in the generated hostname.

| Check | Result |
| --- | --- |
| Unsigned `pull_request` | 403, no preview |
| `opened`, head `f974ab3…` | 202; exactly one `pr-preview-8929d02a-pr-12`; build succeeded; URL returned 200 |
| Env snapshot | Plain fixture values copied; nonexistent vault reference omitted without resolving it |
| Same delivery / same action+SHA with new delivery ID | Both 200 duplicate; no extra deploy |
| `synchronize`, head `68c1b9f…` | 202; same service and URL; updated pinned build succeeded; URL returned 200 |
| `closed` | 202; service absent, zero owned containers and volumes (including a newly created labelled test volume) |
| Repeated `closed` | 200, already absent |
| `reopened`, then `closed` during its active build | 202 cleanup queued; background cleanup completed with no late container |
| Final cleanup | Test parent/project, account/organization/session/key, dashboard container, app images and runtime credential directory removed |

The former preview URL timed out after deletion; a clean router 404 was **not**
proven. Backend and Docker absence were checked directly. UI server actions and
rendered-component tests passed; interactive browser clicks/screenshots remain
unproven. Earlier harness attempts caught a password-hash mismatch, missing
container env propagation, Dokploy's 32-character key-name limit (fixed and
tested), and Node fetch discarding a custom Host header (the harness now uses
`node:http`). Each attempt cleaned up its own resources.

Local artifacts (ignored, no credentials):
`dashboard/data/pr-preview-proof/{proof.cjs,build.sh,transcript.txt}`. The run
command was `cd dashboard && bash data/pr-preview-proof/build.sh`, which runs
`npx next build --webpack`, builds the throwaway container from the standalone
bundle and existing dependencies, then runs `node data/pr-preview-proof/proof.cjs`.
No dependencies were installed and no lockfiles changed.
