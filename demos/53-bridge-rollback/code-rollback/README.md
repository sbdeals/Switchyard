# #53 restacked onto #52+fix: rollback of a REAL code change

Image: `switchyard-dash:bridge-rollback-restack`, built from `codex/bridge-rollback` @ `d9ac68e`. That commit merges `codex/bridge-git-deploys` @ `de1eeec` (the #52 port fix) as a normal merge commit. Lint, tsc and vitest pass: 321/321.
Repo: a local dumb-HTTP git repo, `http://127.0.0.1:8765/rb-demo.git`, built from an nginx Dockerfile that serves `index.html`. Script: `rbcode.mjs`.
Files: `code-after.mp4`, `code-1..4-*.png`, `code-result.txt`.

| Step | Served page (curl via Traefik) | Running image |
|---|---|---|
| Deploy commit A (`74fe9f7`)* | `Version A — commit 1` | `…-app:latest` 92b10049736c |
| Push commit B (`bee2018`, new index.html), then **Redeploy** | `Version B — commit 2 (new code)` | `…-app:latest` 3401e7e5f7a9 |
| **Roll back** (Previous deploys) | `Version A — commit 1` | `…-app:sy-1792752266899` **92b10049736c** (snapshot of A) |
| **Redeploy latest from main** | `Version B — commit 2 (new code)` | `…-app:latest` 3401e7e5f7a9 |

- After the rollback, the compose file has no `build:` section, has `pull_policy: never`, and has `pinnedTag: …:sy-1792752266899`. The old *code* comes back from the local snapshot without a rebuild, even though the branch head is B.
- This replaces the caveat in `../README.md` ("branch head didn't change, so image IDs are identical"). Here the image IDs differ and the served content changes.
- \* Known #52-fix behaviour. A brand-new repo app has no local image when it is created, so its auto-URL starts on fallback port 3000 (502). The first requested Redeploy reconciles it to the image's EXPOSE port (`server.port=3000 → 80`, logged in `code-result.txt`). The rollback path then keeps port 80. Follow-up idea: reconcile once the first build completes.
