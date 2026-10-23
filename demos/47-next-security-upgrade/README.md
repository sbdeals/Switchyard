# 47 — next-security-upgrade (S-P1-21, Next.js portion)

**Change:** dashboard `next` and `eslint-config-next` go from 16.2.9 to 16.4.2, pinned exact. Lockfile changes are limited to Next's own tree: @next/*, sharp 0.34→0.35 with its @img/* binaries, postcss, @swc/helpers, and fastq.

**Before/after (live bridge stack, Dokploy :3000, dashboard :3001):**
- `before.mp4` / `before-*.png`: the `switchyard-dash:main` image (Next 16.2.9). It logs in (a Server Action), loads the workspace, opens `registry-app`, and goes through Variables → Logs → Metrics → Settings.
- `after.mp4` / `after-*.png`: the same flow on `switchyard-dash:next-security-upgrade` (Next 16.4.2). No page errors, and every tab renders.
- `audit-and-checks.txt`: `npm audit --omit=dev` drops from 7 findings (1 critical, 5 high, 1 moderate) to 4 (3 high, 1 moderate). This clears next (Server Actions DoS GHSA-p3m5-59mp-jv5r and the proxy advisory), postcss, and sharp/libvips. Lint, tsc, `next build`, and `docker build` all exit 0.

**Not run:** no DoS payload. The remaining advisories are listed as follow-ups in the PR: @grpc/grpc-js via dockerode, nanoid, source-map-js, and baseline-browser-mapping.
