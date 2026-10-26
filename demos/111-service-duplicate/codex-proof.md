# Service duplication proof

Local dashboard: http://127.0.0.1:3041, built from /workspace/wt-service-duplicate.

Implemented drawer and canvas Duplicate service, validated name/current-project environment selection, owned source/target checks, allowlisted v0.30.10 create/update payloads, fresh volumes, no automatic deployment, explicit Deploy now, and partial-create cleanup.

Verification:
- `cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run`: passed, 44 tests across 2 files.
- `sudo docker build -q -t switchyard-dash:service-duplicate dashboard && /tmp/runsy.sh sy-service-duplicate 3041 service-duplicate`: passed, login HTTP 200.
- `BASE=http://127.0.0.1:3041 node /workspace/sy-codex-notes/fix/service-duplicate-proof/proof.mjs`: passed. Result details are in result.json; screenshots 01–12 and service-duplicate-proof.mp4 capture the flow.
- `git diff --check`: passed.

The live compose proof showed the same DUPLICATE_PROOF=hello environment, different explicit named volumes, no domain, an idle copy before Deploy now, both services running, and drawer/context-menu entry points. The MP4 is 22.44 seconds. Applications and database engines were covered by unit tests, not live deployment.

Cleanup: The dashboard removed the proof projects/service records. Dokploy v0.30.10 project deletion leaves containers/volumes, and its compose.delete runtime cleanup silently failed locally. cleanup.mjs therefore uses the dedicated docker.stopContainer, docker.removeContainer, and dockerVolume.removeVolume APIs for only the exact containers/volumes identified from this session's fixtures. No pre-existing service was stopped/deleted. See cleanup-verification.json for final runtime verification. The session dashboard and its data volume were also removed after recording.

Limitations: Compose copies are raw snapshots (repository files/build contexts are not cloned); includes/extends/volumes_from and uploaded application artifacts are rejected. Published ports are copied verbatim and may need reassignment before deployment. Bind/file mounts become empty named volumes, so file-based configuration may need restoring. js-yaml comes from the existing locked ESLint dependency and was successfully bundled by the Docker build. Tests use the supplied Vitest installation and are excluded from the production TypeScript build; this checkout's manifest does not declare Vitest. No lockfile changes.

Pinned sources:
- https://github.com/Dokploy/dokploy/tree/v0.30.10/packages/server/src/db/schema
- https://github.com/Dokploy/dokploy/tree/v0.30.10/apps/dokploy/server/api/routers
