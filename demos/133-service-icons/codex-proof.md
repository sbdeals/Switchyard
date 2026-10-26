# Service icons proof — review r1

Local dashboard: http://127.0.0.1:3064 (container sy-service-icons).

Catalog matching and useTemplateLogos/listTemplatesAction are restored with main's exact candidate rules and cache. Precedence is exact catalog logo, then local SVG badge, then generic icon. Database devicon CDN URLs are removed. Canvas and card call sites match main; drawer headers use the same shared path.

## Current evidence

- `canvas.png`: existing NGINX catalog logo with local PostgreSQL, whoami and Compose badges.
- `drawer-catalog.png`: existing nginx-g9se drawer with the catalog logo.
- `drawer-local.png`: existing whoami-9yx3 drawer with its local SVG badge.
- `service-icons.mp4`: refreshed r1 recording.
- `report-r1.json` / `report.json`: current checks and measurements.
- `proof-r1.mjs`: repeatable read-only browser capture and fallback assertions.

NGINX catalog asset returned HTTP 200 and loaded at 60x60 intrinsic pixels. Node width remained 240px, node badge 36px and drawer badge 44px. A separate page deliberately aborted the catalog image request and verified a local NGINX SVG fallback with the same width.

## Checks

- `cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run` — passed, 157 tests.
- `sudo docker build -q -t switchyard-dash:service-icons dashboard` — passed.
- `/tmp/runsy.sh sy-service-icons 3064 service-icons` — HTTP 200.
- `BASE=http://127.0.0.1:3064 node /workspace/sy-codex-notes/fix/service-icons-proof/proof-r1.mjs` — passed.
- `git diff --check` — passed.
- MP4 conversion and ffprobe verification — passed.

## Scope and limitations

This revision created zero fixtures and viewed existing local services read-only. No workload lifecycle actions, external service links, or database credential controls were used. Browser network access was restricted to :3064 plus the exact public Dokploy NGINX catalog image. No deployments were tested.

Template logos remain remote by design. Unmatched or unavailable logos use local/generic fallbacks. The base manifest lacks Vitest, but the supplied node_modules has it; dependencies and lockfiles were unchanged and unit tests are excluded from Docker's isolated production build.

Initial proof artifacts and `report-initial.json` document the three earlier throwaway fixtures; all three and their project were deleted through the API. Earlier drawer-nginx/whoami/redis screenshots belong to that initial proof.
