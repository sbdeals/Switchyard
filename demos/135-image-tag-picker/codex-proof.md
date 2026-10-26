Image tag picker proof — local port 3066

- Built with `sudo docker build -q -t switchyard-dash:image-tag-picker dashboard` and started with `/tmp/runsy.sh sy-image-tag-picker 3066 image-tag-picker`.
- Dashboard check: `cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run` — all pass; 5 files, 122 tests. No lockfile/dependency changes; Vitest comes from the provided node_modules. Tests are excluded from the production Docker build context.
- Browser check: `BASE=http://127.0.0.1:3066 node /workspace/sy-codex-notes/fix/image-tag-picker-proof/proof.mjs` — six checks pass, zero browser errors.
- `proof.mp4` and `01-current-tag.png` through `05-mobile.png` show current tag marking, search, keyboard selection, save-only behavior, unavailable/free-text fallback, and mobile layout.
- `verification.json` contains application.one readback: nginx:alpine changed to nginx:stable-alpine3.24-slim; status remained idle; deployment count remained zero. App was never deployed.
- `cleanup.json` confirms application.delete and project.remove succeeded; application.one returned 404 afterward. Only this session's image-tag-picker resources were deleted. The temporary sy-image-tag-picker dashboard container and volume were also removed.
- Scope: anonymous public Docker Hub only, newest 100 tags, 3-second timeout, 60-second/100-repository cache; other/private registries retain manual entry. Actual private registry access was not attempted; generic unauthorized/not-found/rate-limit responses are covered by mocked tests.

Scripts import the user-provided demo-tools helper for local test login; no credentials are recorded in these artifacts.
