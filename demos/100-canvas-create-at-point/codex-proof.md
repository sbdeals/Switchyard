# Canvas create-at-point proof

Final local dashboard: http://127.0.0.1:3031 (container sy-canvas-point, image switchyard-dash:canvas-point).

Implemented in five files:
- dashboard/src/components/canvas/FlowCanvas.tsx
- dashboard/src/components/QuickDeployMenu.tsx
- dashboard/src/components/Workspace.tsx
- dashboard/src/lib/canvas-layout.ts
- dashboard/src/lib/canvas-layout.test.ts

The existing QuickDeployMenu creates services from a canvas anchor. Double-click and right-click accept only empty pane targets; focused-canvas N uses the canvas center. The clicked flow coordinate is captured before opening the menu, retained across async creation, and saved in switchyard:positions:v2 before opening the drawer. The menu is portaled, viewport-clamped, focus-trapped, and dismisses on Escape or outside click. Initial nodes mount client-side so server default positions cannot override persisted positions during hydration.

## Checks

All passed on the final source:

```sh
cd /workspace/wt-canvas-create-at-point/dashboard
npm run lint && npx tsc --noEmit && npx vitest run
```

ESLint and TypeScript: exit 0. Vitest: 1 file, 28 tests passed.

```sh
cd /workspace/wt-canvas-create-at-point
sudo docker build -q -t switchyard-dash:canvas-point dashboard
/tmp/runsy.sh sy-canvas-point 3031 canvas-point
BASE=http://127.0.0.1:3031 node /workspace/sy-codex-notes/fix/canvas-create-at-point-proof/proof.mjs
git diff --check
```

Build passed (image sha256:a647a007586860161f4a044033ccda327b8d97a04a576480001d166811484ce1); local dashboard returned 200. Browser proof and diff check passed.

## Evidence

- 01-menu.png: double-click menu at the first point.
- 02-menu.png: right-click menu at the second point.
- 03-two-positions.png: both nodes at their clicked positions.
- 04-reloaded.png: both retained their saved flow positions after full reload.
- 05-cleanup.png: both removed.
- canvas-create-at-point.mp4: short recording of keyboard/dismissal, creation, reload, and cleanup.
- proof.txt: numeric screen, viewport, saved position, rendered position, and cleanup assertions.
- proof.mjs: reproducible local browser proof.

Final successful run created canvas-point-a-mvoz8n60 and canvas-point-b-mvoz8n60 through the actual Compose menu and server action. The automation supplied their names by replacing only the existing action's optional name argument; no creation response was mocked. Coordinates were (300,320) and (600,550) with viewport pan (755.297,22.3978) and zoom 0.62722. Both rendered within 1px of the clicked points and opened their drawers. Exact saved coordinates and node transforms survived reload.

Both final services were deleted via the dashboard's Compose lifecycle action and confirmed absent after reload. An earlier run exposed the hydration issue; its two canvas-point-* services were also deleted. No pre-existing services were changed.

## Limits

Persistence is local to the browser; fitView may recenter/zoom after reload while preserving node flow coordinates. Compose creation was exercised live; the other creation paths remain shared and were not deployed. Node double-click exclusion used the real node DOM; edge exclusion used a temporary SVG DOM fixture because the local stack had no edges during the final run. The fixture was removed immediately. All browser network requests were restricted to localhost. No production systems, paid model APIs, credentials in output, GitHub authentication, lockfile changes, installs, or git commits were used.
