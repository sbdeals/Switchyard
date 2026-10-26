Port conflict proof — local dashboard http://localhost:3072

Implemented advisory host-port conflicts for application mappings, database external ports, and statically readable Compose published ports. Matching uses host port plus TCP/UDP, excludes the edited service, and names each conflicting service once. Reserved ports: 80, 443, 3000, 3001. Conflicts change the applicable save controls to Save anyway; the linked service name opens its drawer.

Final checks (all passed):

- `cd /workspace/wt-port-conflicts/dashboard && npm run lint && npx tsc --noEmit && npx vitest run` — no lint/type errors; 2 test files, 39 tests passed.
- `cd /workspace/wt-port-conflicts && git diff --check` — passed.
- `cd /workspace/wt-port-conflicts && sudo docker build -q -t switchyard-dash:port-conflicts dashboard && /tmp/runsy.sh sy-port-conflicts 3072 port-conflicts` — built successfully; local dashboard HTTP 200. Final image: sha256:80a5c615c377a9a168516acea2c37efce4c50bb092e98ac2392877c3bd7c3696.
- `node /workspace/sy-codex-notes/fix/port-conflicts-proof/proof.mjs` — live local UI/API assertions, screenshots and recording. Uses the permitted demo login helper without printing credentials.

Proof captures:

- 01-conflict-warning.png: second app proposes 3072/tcp; first app is linked and Save anyway is available.
- 02-conflicting-service-drawer.png: the warning link opened the first app.
- 03-saved-anyway.png: 3072/tcp persisted on the second app; verified through application.one.
- 04-non-conflicting-port.png: draft 30720/tcp has no warning and offers Add. This is data only: no listener/deploy uses it.
- 04-non-conflicting-udp.png: 3072/udp does not conflict with 3072/tcp; Add persisted this mapping, verified through the API.
- 05-reserved-port-warning.png: draft 3000/tcp warns; it was not saved.
- port-conflicts-proof.mp4: the browser sequence.
- results.json: assertions and API cleanup results.

All proof applications and their dedicated project were deleted via the local Dokploy API. No applications were deployed. The local review dashboard remains on :3072.

Changed repo files:

- dashboard/src/lib/port-conflicts.ts
- dashboard/src/lib/port-conflicts.test.ts
- dashboard/src/lib/port-conflicts-ui.test.ts
- dashboard/src/components/service/PortConflictWarning.tsx
- dashboard/src/components/service/networking.tsx
- dashboard/src/components/service/ServiceDrawer.tsx
- dashboard/src/components/service/ComposeTabs.tsx
- dashboard/src/components/Workspace.tsx
- dashboard/vitest.config.ts
- dashboard/.dockerignore

Limitations: warnings use loaded workspace configuration, not host socket occupancy or an atomic reservation. Stopped services are included. Static Compose parsing skips interpolation, aliases, whole-service flow syntax and multiline flow collections. Database/Compose controls have Vitest coverage; the live browser proof exercises applications only. The supplied node_modules includes Vitest although this base's package manifest does not declare it; no dependency or lockfile was changed. Tests are excluded from the production Docker build context.
