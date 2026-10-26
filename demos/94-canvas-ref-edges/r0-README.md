# Canvas variable-reference edges — local proof

Historical initial proof. The final implementation retains inferred fallback edges; see [review round 1](r1-README.md) and the `r1-*` artifacts.

Only the local VM stack was used, with the throwaway dashboard on http://127.0.0.1:3023. No production resources or paid APIs were accessed.

## Artifacts

- `before.png`: untouched baseline — unlabeled animated inferred edge, no missing-reference warning.
- `after.png`: explicit directed edge labeled HOST, PORT; cre-api has one broken-reference badge.
- `after-tooltip.png`: hovering the edge shows cre-api → cre-db: cre-db.HOST, cre-db.PORT.
- `after-no-inferred-edge.png`: keeping NOTE=cre-db while removing explicit target references leaves no edge; the missing-target warning remains.
- `canvas-ref-edges.mp4`: 12.8-second browser recording of the updated canvas, tooltip, reference removal, and restoration. Recording begins after login.
- `before-evidence.json` / `after-evidence.json`: assertions captured from the rendered canvas. One deduplicated edge, no edge for the missing service, no browser errors, and the warning node is 100.5px tall within its 104px grid row.
- `created-resources.json` / `cleanup-result.json`: exact fixture IDs and verified API cleanup.
- `setup-before.mjs`, `capture-before.mjs`, `capture-after.mjs`, `canvas-view.mjs`, `cleanup.mjs`: reproducible setup/capture/teardown scripts. The canvas helper moves only the two fixture nodes and viewport through the canvas callbacks; it does not hide data or override rendering.

## Fixture

Created project `cre-proof` with nginx:alpine compose stacks `cre-api` and `cre-db`, with no published ports. Both ran successfully. Saved references after deploying because this change visualizes references and does not implement Dokploy env interpolation.

cre-api env used HOST and PORT references to cre-db, a duplicate HOST reference, one reference to the absent cre-missing service, and a plain `NOTE=cre-db` mention. cre-db supplied HOST and PORT. The project environment is named `production` by Dokploy's default; it belongs exclusively to this throwaway local fixture.

## Checks

- `cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run` — PASS; 16 Vitest tests.
- `sudo docker build -q -t switchyard-dash:cre dashboard` — PASS; final image sha256:d167f0244b177e9e31eb486d44e17765764e46c89a37abc40d3a1018ab7d2f64.
- `bash /tmp/runsy.sh sy-cre 3023 cre` — PASS; /login HTTP 200.
- `BASE=http://127.0.0.1:3023 node /workspace/sy-codex-notes/fix/canvas-ref-edges-proof/capture-after.mjs` — PASS; arrow, labels, tooltip, badge, dedupe, missing-target edge suppression, no substring inference, node spacing, refresh, and no browser errors.
- `BASE=http://127.0.0.1:3023 node /workspace/sy-codex-notes/fix/canvas-ref-edges-proof/cleanup.mjs` — PASS; fixture services and project deleted through dashboard actions and absence verified.
- `git diff --check` — PASS.

## Scope and limits

Removed substring inference rather than keeping dashed inferred edges. Exact service names resolve only within the same project/environment. Self references draw no loops; missing or ambiguous names produce warnings. Parsing supports quoted/multiline values, comments, spaces/dots/hyphens in service names, and multiple references.

This is a graph visualization, not a deployment-time variable resolver. Referenced variable existence and runtime connectivity are not validated. The base's supplied node_modules includes Vitest but its package manifest/lock do not; neither was changed. Tests remain checked locally and are excluded from Docker build context to keep the production build independent of undeclared test tooling.

After artifact capture, both fixture services and the project were removed via dashboard actions. The session-created sy-cre dashboard container, sy-cre-data volume, and cre image tags were removed locally. Pre-existing apps/containers were left intact. No commit or push was made.
