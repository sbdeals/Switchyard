# Build arguments proof

Local dashboard: `http://127.0.0.1:3057`; Dokploy v0.30.10 on `:3000`.

## UI and API

- `01-editor-warning.png`: dirty editor and nonblocking DEMO_TOKEN warning (fixture value only).
- `02-masked-review.png`: added argument names with all values masked.
- `03-saved.png`: successful save and disabled review button after dirty state clears.
- `04-runtime-save-preserves-build-args.png`: persisted build arguments after saving runtime variables.
- `build-args-ui.mp4`: successful Playwright recording, slowed to one-third speed for readability; login excluded.
- `api-proof.json`: GREETING and CUSTOM_ARG read back from application.one, no automatic deployment, preservation assertions.

The proof used a public repository, https://github.com/testcontainers/testcontainers-java.git,
branch `main`, Dockerfile `core/src/test/resources/dockerfile-build-test/Dockerfile-buildarg`.
The exact public Dockerfile is saved here as `Dockerfile`. Its CUSTOM_ARG is written into `/test.txt`.
GREETING and CUSTOM_ARG were both set through the UI to `Hello from build-args UI`.
No real secret values were used; the secret-like key and build-secret preservation checks used fixture strings.

## Deployment and fallback

`native-deploy.log` shows Dokploy built the image successfully, including:

```
RUN echo "Hello from build-args UI" > /test.txt
Docker build completed.
(HTTP code 503) unexpected - This node is not a swarm manager.
```

Swarm state was `inactive false`; no Swarm initialization was attempted. A native service and HTTP curl were not possible.

The fallback ran:

```sh
sudo docker build --build-arg 'CUSTOM_ARG=Hello from build-args UI' -t build-args-fixture:proof -f /workspace/sy-codex-notes/fix/build-args-proof/Dockerfile /workspace/sy-codex-notes/fix/build-args-proof
sudo docker run --rm --name build-args-fixture-proof build-args-fixture:proof cat /test.txt
```

Result: `Hello from build-args UI`; the script asserted exact equality with CUSTOM_ARG read from the API.
See `fixture-proof.json` and `fixture-build.log`.

## Checks

From `/workspace/wt-build-args`:

```sh
cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run
```

All passed: 2 test files, 30 tests (20 parser/review/ownership helpers, 10 server mutations/actions).

```sh
sudo docker build -q -t switchyard-dash:build-args dashboard
/tmp/runsy.sh sy-build-args 3057 build-args
BASE=http://127.0.0.1:3057 node /workspace/sy-codex-notes/fix/build-args-proof/proof.mjs
```

Image build, HTTP readiness, UI assertions, and API readback passed. Browser automation selector mistakes were corrected before the successful recording.

Vitest is available in the supplied node_modules but is absent from the checked-in package manifest on this worktree. No dependency manifest or lockfile was changed. Tests are excluded from the production Docker context so its existing npm-ci dependency set can build the dashboard.

## Cleanup and limits

The session's application and project were deleted through `application.delete` and `project.remove`, then verified absent from the user's project tree (`cleanup.json`). The owned dashboard container/volume and fixture/native-build images were removed with Docker; no pre-existing applications were changed.

The editor requires one assignment per line; double-quoted escaped newlines are supported. It does not edit build secrets. No native service HTTP response was proven on this non-Swarm host.

The proof scripts reuse the supplied login helper without inspecting credential files or writing authentication state to disk. `resources.json` records deleted resource IDs for audit; remove it before re-running the creation script.
