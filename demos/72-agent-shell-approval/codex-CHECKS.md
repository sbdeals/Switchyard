# Shell approval draft checks

- `cd /workspace/wt-agent-shell-approval/dashboard && npm run lint && npx tsc --noEmit && npx vitest run` — PASS; 15 files, 285 tests, including 49 shell approval tests.
- `cd /workspace/wt-agent-shell-approval/dashboard && env -i PATH="$PATH" NEXT_TELEMETRY_DISABLED=1 npm run build -- --webpack` — PASS.
- `sudo -n docker -H unix:///var/run/docker.sock build -t switchyard-dash:shell-approval-proof /tmp/sy-shell-approval-proof-t9yk925p` — PASS; copied the provided dependencies, no installation or lockfile change.
- `curl --fail --silent --show-error http://127.0.0.1:3006/api/health` — PASS: `{"ok":true,"version":"dev"}`.
- `sudo -n docker -H unix:///var/run/docker.sock exec sy-shell-approval-proof node /app/smoke.cjs` — PASS after clearing this session's `/tmp/sy-shell-proof` marker in `sy-shell-approval-demo`. Script assertions prove staging has no effect, approval executes the exact command once, tampered approval gets 400, concurrent/replayed approval gets 409, and rejection does not execute. See `live.log` and `smoke.ts` here. The marker is left in the demo as evidence.
- `node --experimental-websocket /tmp/sy-shell-approval-proof-t9yk925p/browser-check.cjs` — PASS; real Chrome exercises exact review text, explicit approval, frozen reviewed selection, output while another command is pending, and rejection. See `ui-result.json`.
- `cd /workspace/wt-agent-shell-approval && git diff --check` — PASS.

Live proof runs inside the newly built dashboard image on localhost:3006 against a newly created nginx container through the real local Docker socket. The tool-layer harness stubs Dokploy identity/workspace discovery and the model credential loader; it calls the real tools, store, approval route, operations, and Docker exec implementation. It blocks network fetches. No model calls or API keys were used. Real Dokploy login/model integration was not exercised.

Only this session's `sy-shell-approval-proof` and `sy-shell-approval-demo` containers were created/replaced; both are left running for review. Pre-existing apps and production deployments were not modified. The image context is temporary and includes no added application routes or repository changes.

Policy limitations: no optional diagnostics allowlist (all shell syntax requires approval); failed approvals require restaging, including the four existing destructive actions; output timeout does not terminate a command already running; existing container-name resolution (S-P1-5) and the process-local in-memory queue are unchanged.
