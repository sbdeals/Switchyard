# Light / Dark / System theme proof

Implemented in `/workspace/wt-light-theme` on `codex/light-theme`, base `main`.
No commit created. No dependency or lockfile changes.

## Validation

- `cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run` — passed, 2 files / 92 tests (21 theme, 71 contrast).
- `git diff --check` — passed.
- `sudo docker build -q -t switchyard-dash:light-theme dashboard && /tmp/runsy.sh sy-light-theme 3055 light-theme` — passed; local HTTP 200.
- `BASE=http://127.0.0.1:3055 node /workspace/sy-codex-notes/fix/light-theme-proof/capture.mjs` — passed, 15 browser checks, no page errors.
- `ffprobe -v error -show_entries format=duration,size -of json /workspace/sy-codex-notes/fix/light-theme-proof/light-theme.mp4` — valid MP4, 27.84 seconds, 2,805,090 bytes.

The final image is `switchyard-dash:light-theme` (`sha256:7db14b756d718858349b157ae199ad280cd8d81ae28895beea4276c1a4375278`).
The temporary `sy-light-theme` dashboard container was removed after proof (`sudo docker rm -f sy-light-theme`).
No demo apps/projects were created, modified, stopped, or deleted. Proof only viewed existing local services; the drawer/log screenshots use the running `beginner-html-site-styled-rys8` demo with an empty Variables editor.

## Artifacts

- `light-theme.mp4`: browser recording.
- `login-{light,dark}.png`
- `grid-{light,dark}.png`
- `canvas-{light,dark}.png`
- `drawer-{overview,logs,variables,settings}-{light,dark}.png`
- `quick-deploy-{light,dark}.png`
- `dialog-{light,dark}.png`: Projects & environments dialog, no form submission.
- `system-{light,dark}.png`: live Playwright `emulateMedia` changes while System remains selected.
- `mobile-light.png`: 375px header spacing check.
- `results.json`: browser assertions and computed canvas/minimap/dot/mask colors.
- `capture.mjs`: repeatable read-only browser proof using the supplied local login helper.
- `files-touched.txt`: complete 29-file change inventory.

Minimum light text contrast across page/elevated/surface/hover/code backgrounds:
body 12.98:1, secondary 6.13:1, subtle 5.10:1. Tests parse the actual CSS token set.
Additional browser checks cover persistence, missing/invalid preferences, prepaint script with hydration bundles blocked, explicit preference overriding system, cross-tab changes, denied storage, placeholder colors, and mobile header overlap.

## Limits

Browser proof used local Chromium only. Contrast helper accepts opaque hex colors; token tests cover listed surfaces rather than every possible alpha composite. Decorative database identity accents stay fixed. Vitest is preinstalled in this workspace but absent from this checkout's package manifest; dependencies/lockfiles were intentionally left unchanged. Tests are excluded from the runtime Docker build context so that build needs only declared dependencies.
