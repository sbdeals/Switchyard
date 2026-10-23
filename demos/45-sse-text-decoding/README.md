# #45 — runtime log stream: streaming UTF-8 decode, EOF flush, no duplicate replay on reconnect

PR: https://github.com/sbdeals/Switchyard/pull/45 · branch `codex/sse-text-decoding` · finding S-P2-22

**Stack:** live bridge Dokploy + dashboard. A fresh container that looks like a swarm task of `registry-app` (`demo-tools/logdemo-container.sh`) prints `=== container started ===` and `tick 1..5 ✅ café 日本語`. Script `demo-tools/sse.mjs`: open registry-app → Logs, `docker restart` the container (EventSource drops and reconnects), wait, then count lines in the panel.

`docker logs` itself holds **2** copies (one per container run).

| | "container started" in panel | "tick 1" in panel |
|---|---|---|
| before (main) | **3** (the reconnect re-tails 300 lines and the client appends them) | 3 |
| after | **2** (the server sends `event: reset` first and the client clears its buffer) | 2 |

Files: `before.mp4`, `after.mp4`, `*-1-initial.png`, `*-2-after-restart.png`, `*-logs.txt` (panel text dump), `verify-sse-text-decoding.cjs` + `harness-output.txt` (15/15).

The UTF-8 mid-character split and the final line without a newline can't be forced through a real Docker log stream: Docker splits only at 16KB on character boundaries and newline-terminates. So the harness covers those by feeding the production `sseFromLines` split multibyte chunks, a trailing unterminated line, >64K lines (bounded fragments, surrogate pairs kept), and abort/close.
