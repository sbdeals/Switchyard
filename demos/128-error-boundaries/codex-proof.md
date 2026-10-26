# Error boundary proof

Worktree: `/workspace/wt-error-boundaries` (base `main`, branch `codex/error-boundaries`).

## Checks

- `cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run` — passed; 4 test files, 57 tests.
- `git diff --check` — passed.
- `sudo docker build -q -t switchyard-dash:errbound3058 dashboard` — passed. Image ID: `sha256:bba90667ec4aa028ebf644713d205ea2a1a711bc6f0bf21dd398b2ac75683a2d`.
- `/tmp/runsy.sh sy-errbound3058 3058 errbound3058` — started the self-built dashboard on the assigned localhost port.
- `BASE=http://127.0.0.1:3058 node /workspace/sy-codex-notes/fix/error-boundaries-proof/dashboard-proof.mjs` — passed all assertions in `dashboard-results.json`.
- `cd dashboard && npx vitest run --root /workspace/sy-codex-notes/fix/error-boundaries-proof panel-browser.test.ts` — passed; one real browser integration test with 12 assertions in `panel-proof-results.json`.

## Captures

- `dashboard-404.png`: authenticated missing route returns HTTP 404 and dashboard-styled navigation.
- `dashboard-dokploy-unreachable.png`, `dashboard-dokploy-retry.png`: own dashboard container recreated using a copy of the supplied runner with only `DOKPLOY_URL` changed to `http://127.0.0.1:3058`. Nothing listens on that port inside the dashboard container. Dokploy itself was untouched. Retry issued a fresh RSC request; backend details stayed hidden. An invalid session still redirected to `/login`.
- `dashboard-proof.mp4`: live dashboard proof on port 3058.
- `panel-01-healthy.png`, `panel-02-caught-and-isolated.png`, `panel-03-recovered.png`, `panel-04-tab-reset.png`, `panel-proof.mp4`: actual `PanelErrorBoundary` bundled from this worktree into a clearly labeled test-only React render in Chrome. Proves render failure isolation, repeated failure, retry remount, preserved sibling state/interactivity, and tab-key recovery. This fixture makes no network requests and is run by the external Vitest test.

## Scope and limitations

The panel proof uses an isolated render, not a forced crash inside ServiceDrawer or FlowCanvas. No test route/query trigger was added to production code. Timeout, response-body disconnect, HTTP/auth, and route/global fallback behaviors are regression-tested with mocks/static rendering; the live outage proof uses connection refusal. No live root-layout crash was injected. Route/global Retry uses the requested `reset()`, which clears boundary state without refetching in this Next version; Dokploy Retry explicitly refreshes server data.

Only the session-created `sy-errbound3058` container and its volume/image were used and removed after capture. No demo apps were created. No existing apps, Dokploy deployment, production resources, lockfiles, or commits were changed. Proof source and media are outside the repository. Test files are excluded from the production Docker build because Vitest is provided in this worktree's node_modules but is absent from the checked-in dependency manifest.
