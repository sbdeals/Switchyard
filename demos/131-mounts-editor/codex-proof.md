Volumes & mounts editor proof — local only, port 3062

Result: PASS. See proof.json for sanitized application.one readbacks and confirmation text,
01–07 PNGs for screenshots, and mounts-editor.mp4 for the browser recording.

Verified against local Dokploy v0.30.10 with a throwaway mounts-editor-* application using
nginx:alpine. The UI displayed an existing bind mount read-only, added a named volume and
file mount, rejected an equivalent duplicate path, edited file content while preserving its
managed source name, canceled a removal, then confirmed removal of the volume mount.
application.one confirmed the saved mount paths, sources, file content, and removal.
Deployment count stayed zero. App and project were deleted through Dokploy APIs; project
absence was verified. Earlier harness attempts were also cleaned up via the API.
The dashboard container and data volume created for this proof were removed afterward.

Checks from /workspace/wt-mounts-editor:
- cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run
  PASS: lint clean; TypeScript clean; 3 test files, 120 tests passed.
- git diff --check
  PASS.
- sudo docker build -q -t switchyard-dash:mounts-editor dashboard
  PASS. Final image: sha256:0cd52de2f91b0ca0d1804ff475efdfc2e697a5a82440d75a78dee486c97a8a16
- /tmp/runsy.sh sy-mounts-editor 3062 mounts-editor
  PASS: HTTP 200.
- BASE=http://127.0.0.1:3062 node /workspace/sy-codex-notes/fix/mounts-editor-proof/proof.mjs
  PASS. Seven screenshots and MP4 generated.
- sudo docker info --format '{{.Swarm.LocalNodeState}} {{.Swarm.ControlAvailable}}'
  inactive false. No deploy or swarm initialization was attempted.

Limitations: runtime mount attachment and actual named-volume data retention were not
exercised on this non-Swarm host. The UI accurately warns that file-content updates can be
visible immediately, while mount configuration applies on next deploy. Duplicate-path
checks are per request; Dokploy does not provide an atomic uniqueness constraint here.
Tests use the preinstalled Vitest; dependencies and lockfiles were not changed. Test files
are excluded from the Docker build context because the base manifest omits Vitest.

Upstream contract checked at v0.30.10:
- https://github.com/Dokploy/dokploy/blob/v0.30.10/packages/server/src/db/schema/mount.ts
- https://github.com/Dokploy/dokploy/blob/v0.30.10/packages/server/src/services/mount.ts
- https://github.com/Dokploy/dokploy/blob/v0.30.10/packages/server/src/services/application.ts
- https://github.com/Dokploy/dokploy/blob/v0.30.10/packages/server/src/utils/docker/utils.ts
