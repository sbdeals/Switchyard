# #52 follow-up: new repo apps get the right port on the first deploy (commit 5e66b3e)

**Bug:** a brand-new Git-repo app was given `server.port=3000` and kept returning 502 until someone clicked Redeploy.

**Root cause:** `deployBridgeApp` provisions the public URL *before* the build. The repo image doesn't exist yet, so port detection fell back to 3000, and Dokploy wrote that port into the Traefik labels.

**Fix:** commit [5e66b3e](https://github.com/sbdeals/Switchyard/commit/5e66b3e) on `codex/bridge-git-deploys` (#52). It is a new commit; no history was rewritten. It adds two paths:
- **(a) Public HTTPS repos** (github.com, gitlab.com, bitbucket.org): reads the final-stage `EXPOSE` from the Dockerfile before the build.
  - The fetch is limited to https, 5 s and 128 KiB, with no redirects and no credentials.
  - Anything ambiguous (ARG, heredoc, escape directive, non-numeric port) yields no hint.
- **(b) Everything else** (other hosts, local HTTP Git, unparseable Dockerfiles): one bounded post-build watcher.
  - It polls every 5 s for up to 15 min.
  - It applies the built image's exposed port and makes **at most one** automatic follow-up deploy.
  - It stops if anyone else deploys, and Networking, PORT env, Compose edits, stop and rollback cancel it.

Tests: lint, tsc and vitest pass on the #52 branch (290 tests) and on local integration with #53–#55 (535 tests).

All runs are live on :3001. Each is a **fresh** app created through New service → repo URL, with **no manual Redeploy**. Recorder: [`rp.mjs`](rp.mjs).

| Run | Image | Repo | Result |
|---|---|---|---|
| **before** | `integration-52fix-53-54-55` (old) | github.com/mccutchen/go-httpbin (EXPOSE 8080) | `server.port=3000`, **502 for the full 420 s**, 1 deployment. See [before.mp4](before.mp4), [before-2-first-502.png](before-2-first-502.png) and [before-result.txt](before-result.txt). |
| **after (a)** | `integration-52port` (with 5e66b3e) | same | `server.port=8080` from t+2s, **200 at t+7s**, 1 deployment. See [after.mp4](after.mp4), [after-3-deploys.png](after-3-deploys.png) and [after-result.txt](after-result.txt). |
| **after (b)** | `integration-52port` | local `http://127.0.0.1:8765/repo-port.git` (nginx, EXPOSE 80) | 502 on port 3000 at t+2s, then the watcher's single automatic follow-up gives **200 on port 80 at t+10s**, 2 deployments. See [after-local.mp4](after-local.mp4), [after-local-3-deploys.png](after-local-3-deploys.png) and [after-local-result.txt](after-local-result.txt). |

Notes:
- The "after (a)" build took about 2 s because the go-httpbin layers were already in the BuildKit cache from the "before" run. The port label is set before the build starts, so build time does not affect the result.
- In path (b), Dokploy labels the automatic follow-up "Manual deployment", because it is a normal `compose.deploy`.
- Limitations of path (b): a brief 502 window remains until the follow-up finishes. A dashboard restart or session expiry mid-build drops the watcher; the next deploy still repairs the port (the old behaviour).
- The follow-up deploy calls `compose.deploy` directly. On the #53 stack it therefore doesn't add a rollback-history entry; the first deploy already recorded the same image.
- #53–#55 are stacked on #52. When 5e66b3e reaches them, the conflicts in `actions.ts`, `dokploy.ts` and `bridge-domains.test.ts` need the same resolution used on local integration (commit 3e52166, not pushed).
