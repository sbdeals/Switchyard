# #44: auto-generated public URL routes to the app's real port

PR: https://github.com/sbdeals/Switchyard/pull/44 · branch `codex/auto-domain-port` · finding S-P2-20

**Stack:** live bridge-mode Dokploy and the dashboard. Script: `demo-tools/adp.mjs`. Steps: New service → Docker image `nginx:alpine` → Enter, then open Networking.

- **before (main):** the auto domain is created with container port **3000**, so the public URL can never reach nginx, which listens on 80.
- **after:** the port is **80**. The precedence is explicit Port → env `PORT` → lowest EXPOSEd TCP port (if the image is already local) → known nginx/httpd default → 3000.
- **after-explicit:** the new optional **Port** field in the quick-deploy menu, set to 8081, creates the domain with port 8081.

**Files:**
- `before.mp4`, `after.mp4`, `after-explicit.mp4`
- `*-1-menu.png`, `*-2-deployed.png`, `*-3-networking.png`
- `domain-records.txt`: Dokploy's own records
- `verify-auto-domain-port.cjs` (96 assertions) and `verify-auto-domain-integration.cjs` (53 assertions)

Note: the native swarm deploy of the app fails on this bridge stack (no overlay networking; #32 fixes that). So this demo shows the domain record and the Networking tab, not an end-to-end HTTP 200.
