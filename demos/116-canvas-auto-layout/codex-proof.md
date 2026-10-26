Canvas auto-layout proof — local :3047

Implemented deterministic name-ordered layout with SCC layers for cycles, a compact disconnected-service grid, and a separate bottom database band. Tidy animates for 350ms, persists destination positions through switchyard:positions:v2, and offers Undo for 10 seconds. Undo restores exact prior saved data, including absence of the key. Initial browser restoration now runs after hydration so saved positions survive full reloads.

Proof files:
- 01-messy-before.png: existing local services with deliberately scattered browser-only positions.
- 02-tidy-after.png: deterministic grid and database band, with Undo toast visible.
- 03-undo.png: original coordinates restored.
- 04-reload-persistence.png: tidy coordinates retained after full reload.
- canvas-auto-layout.mp4: 17.16-second H.264 recording, 1440x1000.
- canvas-auto-layout.webm: original browser recording.
- results.json: browser assertions; 13 existing services, zero inferred edges.
- proof.mjs: reproducible browser assertions/recording; uses authorized open/login helpers.

Final checks (all passed):
1. cd /workspace/wt-canvas-auto-layout/dashboard && npm run lint && npx tsc --noEmit && npx vitest run
   Lint clean, TypeScript clean, 23 tests across 2 files passed. Includes 50-node layout under 50ms, chains, fan-out, cycles, disconnected nodes, measured-size non-overlap, Undo expiry, animation, persistence, hydration restoration, and reduced motion.
2. sudo docker build -q -t switchyard-dash:canvas-auto-layout dashboard
   Built successfully. Final image: sha256:bd0af52ac1455d5025714a0cedb212508d0068ac54e223cbb79405e3b492139d.
3. BASE=http://127.0.0.1:3047 node /workspace/sy-codex-notes/fix/canvas-auto-layout-proof/proof.mjs
   All browser assertions passed; no page errors.
4. git diff --check
   Clean.
5. ffprobe -v error -show_entries format=duration,size -show_entries stream=codec_name,width,height -of json /workspace/sy-codex-notes/fix/canvas-auto-layout-proof/canvas-auto-layout.mp4
   Valid H.264, 1440x1000, 17.16 seconds, 1423556 bytes.

Local runtime: built a proof derivative with SWITCHYARD_ALERTS=off and started it with /tmp/runsy.sh sy-canvas-auto-layout-proof 3047 canvas-auto-layout-proof. Login was completed before recording. Browser network access was restricted to 127.0.0.1:3047, so remote logos may show as unavailable. No service settings, apps, deployments, domains, production credentials, or paid APIs were changed or accessed. Only browser localStorage was changed. No demo application resources were created.

Limitations: the existing local services have no inferred edges; graph-edge layering is covered by Vitest rather than this live dataset. The existing 0.3 minimum zoom can require panning for very large layouts. Vitest is pre-provisioned in node_modules but absent from this checkout's manifest/lockfile; neither was changed. Docker excludes *.test.ts so the production build remains independent of that test runner.

Cleanup completed: removed only this session's sy-canvas-auto-layout-proof container, its named volume, and the two tagged dashboard images. Port 3047 is no longer serving after proof capture. Existing local services and containers were left running.
