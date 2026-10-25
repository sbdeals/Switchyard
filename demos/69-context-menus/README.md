# #69: Railway-style right-click context menus

A Playwright recording against a throwaway dashboard (`sy-e`, 127.0.0.1:3005) on the local Dokploy, with the real services on the canvas. The same script was run against both images:
- **before:** `e99e763` (#53)
- **after:** `605b897`

- `before.mp4` / `after.mp4`: the full run (right-click node → Config submenu → Esc/Esc → Shift+F10 → right-click canvas → Docker Image flow → grid card → deployment kebab → Delete Service, then cancel).
- `before-result.txt` / `after-result.txt`: what each step found (menu item lists).
- `screenshots/after-1-node-menu.png`, `after-2-config-submenu.png`, `after-3-canvas-add-new-service.png`, `after-4-docker-image-flow.png`, `after-5-grid-card-menu.png`, `after-6-deployment-kebab.png`, and the before shots, which show no menus.

Before: every right-click falls through to the browser menu, and deployment rows have no kebab. After: the menus open, keyboard access works, and Delete shows the existing destroy confirm (dismissed in the run; all 9 services still on the canvas).

Repro: `runsy.sh sy-e 3005 e-after`, then `BASE=http://127.0.0.1:3005 LABEL=after OUT=/tmp/edemo/after node e-menus.mjs`.
