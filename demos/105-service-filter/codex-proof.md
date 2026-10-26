# Service filter local proof

Local dashboard: `http://127.0.0.1:3036`, image `switchyard-dash:service-filter`.
Uses the 13 existing local services without changing them. No app, project,
environment, deployment, or webhook was created or modified.

The proof launcher is the supplied `/tmp/runsy.sh` with only
`SWITCHYARD_ALERTS=off` added to the throwaway dashboard environment, so its
background collector cannot send notifications. Browser requests outside the
assigned local origin and requests to the agent APIs are blocked during proof.

## Checks

From `/workspace/wt-service-filter`:

```sh
cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run
```

All passed; 48 Vitest tests cover matching fields/tokens, runtime/deploy status
precedence, counts, URL encoding/preservation, shortcut guards, and node/edge
opacity rules.

```sh
sudo docker build -q -t switchyard-dash:service-filter dashboard
BASE=http://127.0.0.1:3036 node /workspace/sy-codex-notes/fix/service-filter-proof/proof.mjs
```

Build passed. See `results.json` for browser assertions and the exact URL for
each screenshot. The script checks real typing and mid-string insertion,
shortcuts, grid filtering, status selection, reload persistence, unrelated URL
parameters/hash, back navigation, empty results, clearing, and canvas positions.

## Evidence

- `01-search-grid.png`: search hides non-matching grid cards.
- `02-status-running.png`: Running chip with the query still active.
- `03-url-persistence-after-reload.png`: query and status restored after reload.
- `04-canvas-dimming.png`: non-matching nodes dim while matching nodes remain bright.
- `05-empty-canvas.png`: empty-results overlay retains all dimmed canvas nodes.
- `06-empty-grid.png`: empty grid with Clear filters.
- `07-status-stopped.png`: stopped services and matching runtime badges.
- `service-filter.mp4`: browser recording of the complete successful proof.
- `index.html`: evidence viewer, including recorded URLs.

## Limits and semantics

The existing local workspace has no inferred edges and no Deploying/Error
services. Edge dimming and those buckets are covered by Vitest, not live proof.
Stopped includes idle/not-running; Error includes degraded runtime; in-progress
deployments take precedence over runtime. Counts reflect the search before the
status selection. Escape clears search text while preserving the selected status.

Vitest is supplied by the pre-existing local node_modules but is absent from
this checkout's package manifest. Tests are excluded from the Docker context so
the production build does not require that undeclared test dependency. No
dependency manifests or lockfiles were changed.

The session-created dashboard container `sy-service-filter`, its data volume,
and its image tag were removed after capture. Port 3036 is no longer served.
Existing local services and their containers were left unchanged.
