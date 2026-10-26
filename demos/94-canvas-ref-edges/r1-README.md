# Review round 1 — reference edges with inferred fallback

This supersedes the initial proof's decision to remove inference. The final canvas keeps existing connection-string hints, rendered as muted dashed edges. Solid labeled reference edges win for the same source/target pair. Tooltips identify the type without displaying env values. Missing references remain node warnings; the legend appears only when edges exist.

## Local proof artifacts

- `r1-canvas.png`: solid reference edge, dashed inferred edge, broken-reference badge, and legend together.
- `r1-reference-tooltip.png`: the explicit edge says “references” and lists HOST and PORT.
- `r1-inferred-tooltip.png`: the unlabeled dashed edge says “inferred: cre-r1-api mentions cre-r1-cache in its env (heuristic)”.
- `r1-fallback.png`: removing explicit DB references reveals a single dashed fallback because the plain DB_NOTE mention remains.
- `r1-canvas-ref-edges.mp4`: 12.96-second recording of both tooltips, fallback on reference removal, and restoration. Recording starts after login.
- `r1-evidence.json`: browser assertions and actual computed edge styles; zero page errors.
- `r1-created-resources.json` and `r1-cleanup-result.json`: exact fixture IDs and verified API cleanup.
- `r1-setup.mjs`, `r1-helpers.mjs`, `r1-capture.mjs`, `r1-cleanup.mjs`: setup, assertions, framing, and cleanup scripts. Framing changes only the three fixture nodes' canvas positions and viewport through existing callbacks; all workspace data remains intact.

## Checks

- `cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run` — PASS, 23 tests. Coverage includes explicit precedence, inferred deduplication, self references, fallback, and unresolved-token exclusion.
- `sudo docker build -q -t switchyard-dash:cre-r1 dashboard` — PASS, image sha256:2d92976cc354515deb569ec40861c2cb8d6f5dc7c383108652343b1fd6060e00.
- `bash /tmp/runsy.sh sy-cre-r1 3023 cre-r1` — PASS, /login HTTP 200.
- `BASE=http://127.0.0.1:3023 node /workspace/sy-codex-notes/fix/canvas-ref-edges-proof/r1-capture.mjs` — PASS. Browser verifies styles, labels, safe tooltip text, legend, badge, no edge for missing target, dedupe, precedence, fallback and restoration.
- `BASE=http://127.0.0.1:3023 node /workspace/sy-codex-notes/fix/canvas-ref-edges-proof/r1-cleanup.mjs` — PASS. All three services and the project removed through dashboard actions; absence verified.
- `git diff --check` — PASS.

## Scope and cleanup

Created only local project cre-r1-proof and nginx:alpine compose services cre-r1-api, cre-r1-db, cre-r1-cache, with no published ports. All three were running before capture. Saved explicit refs after deployment because runtime interpolation is not implemented. Dokploy's default environment name “production” belongs only to this throwaway local fixture. No production deployment, real app/server/domain, or paid API was accessed.

Deleted all fixture services/project through dashboard actions. Removed the session-created sy-cre-r1 dashboard container, sy-cre-r1-data volume, and cre-r1 image tag after recording. Pre-existing resources remain untouched. No commit or push; no dependency or lockfile changes.

Inferred edges retain the heuristic's false-positive risk, including across projects/environments. Explicit references remain scoped to project/environment. This change neither interpolates env references at deployment nor validates target variable existence/runtime connectivity.
