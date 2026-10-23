# #43: changing a private image's tag keeps its registry credentials

PR: https://github.com/sbdeals/Switchyard/pull/43 · branch `codex/preserve-registry-credentials` · finding S-P1-20

**Stack:** live bridge-mode Dokploy and the dashboard. App `registry-app` has image `ghcr.io/acme/private-api:1.0` and credentials `acme-bot` / password / `ghcr.io`, all set via Dokploy `application.saveDockerProvider` before each run.

Script: `demo-tools/prc.mjs`. Steps: registry-app → Build → change **only** the tag to `1.1` → Save → reload and reopen.

The Dokploy `application.one` state before and after each UI save is in `*-dokploy.txt`. The password is shown only as set/unset.
- **before (main):** `username= password= registryUrl=ghcr.io`, so the credentials were wiped and the next pull of the private image would fail.
- **after:** `username=acme-bot password=<set, 14 chars> registryUrl=ghcr.io`. The reopened form shows the username and a "Password saved — leave blank to keep" placeholder, and there is an explicit "Clear credentials" checkbox.

**Files:**
- `before.mp4` and `after.mp4`
- `*-1-form.png`, `*-2-saved.png`, `*-3-reopened.png`
- `*-dokploy.txt`

Unit harness: `fix/verify-registry-credentials.cjs` (19 checks, real modules with a mocked request layer).
