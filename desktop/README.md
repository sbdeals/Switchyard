# Switchyard Desktop

The one-click app: double-click, and the window becomes your Switchyard
dashboard with the whole Dokploy stack running underneath. This package is a
GUI shell around the CLI's converge logic — it imports `cli/src/core/*` and
`cli/src/platform/docker-desktop.ts` directly, so the CLI stays the single
source of truth for HOW the stack is provisioned.

## What it does on launch

1. **Prereq wizard** (first run only): if Docker Desktop is missing, it
   downloads the official installer and runs it — elevated on Windows
   (`install --accept-license` after the user accepts in our UI), silent
   attach+copy on macOS with a Finder fallback. Handles the reboot-required
   (3010) case.
2. **Engine**: starts Docker Desktop if installed but not running, and polls
   `docker info` until the daemon answers.
3. **Converge**: the same flow as `switchyard up` headless — port
   adoption/auto-bump, generated admin credentials, `ensureDokploy`,
   `ensureSwitchyard`, deep health check. Progress streams into the status
   view; failures become friendly error cards (including the stale-volume trap,
   which offers "keep data" (`--force`) vs "fresh start" (purge)).
4. **Auto-login**: mints the dashboard's `switchyard_session` cookie itself
   (it knows the admin credentials and the session secret from config.json)
   and injects it into Electron's cookie jar — the window opens straight into
   the workspace. Mirror of `dashboard/src/lib/session.ts`; keep in sync.
5. **Tray**: open dashboard/Dokploy, start/stop/restart the stack, reset
   everything (purge + reinstall), start-at-login toggle, update check, quit
   (the stack keeps running — containers are `restart unless-stopped`).

Auto-update: `electron-updater` against GitHub Releases (`latest.yml` is
published by the release workflow). Windows works unsigned; macOS auto-update
works on release builds, which are signed and notarized in CI (see
[Releasing](#releasing) — unsigned mac builds, e.g. local `npm run dist`, are
rejected by Squirrel.Mac and fall back to the tray's manual update check).

## Dev

```bash
cd desktop
npm install
npm run typecheck
npm start          # build + launch the app
npm run smoke      # headless end-to-end: converge + auto-login proof (exit 0 = pass)
npm run dist       # build the installer locally (no publish)
```

Useful env vars: `SWITCHYARD_DESKTOP_SMOKE=1` (windowless smoke mode),
`SWITCHYARD_DISABLE_GPU=1` / `--gpu-safe` (software rendering — applied
automatically after repeated GPU-process crashes),
`SWITCHYARD_CONFIG` (alternate config path, honored by the cli core).

`scripts/gen-icon.mjs` generates all icons at build time (pure Node, no image
deps). `scripts/ui-shot-main.cjs` renders each status-view state offscreen to
PNGs for docs/design review: `npx electron scripts/ui-shot-main.cjs`.

## Releasing

Tag `vX.Y.Z` (must equal `cli/package.json` AND `desktop/package.json`
versions — CI enforces both). The release workflow builds NSIS + DMG/zip on
Windows/macOS runners and uploads them with the auto-update feed to the
GitHub release.

### macOS signing & notarization

The macOS leg signs (Developer ID + hardened runtime, entitlements in
`build/entitlements.mac.plist`) and notarizes when the repo secrets below are
set. **All five are optional as a group**: if they're absent (forks, or before
the certs exist), electron-builder logs a warning, skips signing and
notarization, and still produces a working unsigned build — but macOS
auto-update only works on signed builds.

| Repo secret | What it is |
| --- | --- |
| `CSC_LINK` | Base64 of the Developer ID Application cert as a `.p12` |
| `CSC_KEY_PASSWORD` | Password chosen when exporting that `.p12` |
| `APPLE_ID` | Apple ID email of the developer account |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for that Apple ID |
| `APPLE_TEAM_ID` | 10-character Team ID |

One-time setup (needs a paid Apple Developer Program membership):

1. **Certificate**: in [developer.apple.com](https://developer.apple.com) →
   Certificates, create a **Developer ID Application** certificate (generate a
   CSR via Keychain Access → Certificate Assistant). Download it, import it
   into Keychain Access, then export the certificate **with its private key**
   as a `.p12` (choose an export password → `CSC_KEY_PASSWORD`). Encode it:
   `base64 -i cert.p12 | pbcopy` → `CSC_LINK`.
2. **App-specific password**: at [account.apple.com](https://account.apple.com)
   → Sign-In and Security → App-Specific Passwords, generate one
   → `APPLE_APP_SPECIFIC_PASSWORD` (with the account email as `APPLE_ID`).
3. **Team ID**: developer.apple.com → Membership details
   → `APPLE_TEAM_ID`.
4. Add all five as GitHub **repository secrets** (Settings → Secrets and
   variables → Actions). The next `vX.Y.Z` tag produces a signed, notarized
   DMG/zip, and mac auto-update starts working from that release onward.
