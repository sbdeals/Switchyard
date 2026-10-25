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

**No user session, cookie, password, or user API key is stored or replayed.**
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
