# #36 — exact container ownership for Logs/Console/Metrics/Data

PR: https://github.com/sbdeals/Switchyard/pull/36 · branch `codex/docker-target-identity` @ 7606f4e · finding S-P1-5

**Stack:** live bridge-mode Dokploy and dashboard on real Docker. App `api` (appName `api-zfptif`) has **never been deployed**, so it has no container. An unrelated container is started:

```
docker run -d --name api-zfptif-shadow -l com.docker.compose.project=api-zfptif-shadow alpine \
  sh -c 'while true; do echo "hello from api-zfptif-shadow (a DIFFERENT service)"; sleep 1; done'
```

The script (`demo-tools/dti.mjs`) opens api → Logs.

- **before (main):** the Logs tab streams `hello from api-zfptif-shadow (a DIFFERENT service)`, which is another service's output. Console and Data would attach to the same container.
- **after:** `— container is not running —`

**Files:**
- `before.mp4`, `after.mp4` (plus .webm)
- `before-logs-tab.png`, `after-logs-tab.png`
- `*-logs.txt`: the captured log panel

Unit-style verification: `fix/verify-docker-target-identity.cjs` in the notes dir (40 checks, mocked dockerode).
