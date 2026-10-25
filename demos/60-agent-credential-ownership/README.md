# #60 · S-P0-3: admin-only agent provider config + key bound to provider/endpoint

The demo is **non-UI (API)**, with a terminal before/after, plus UI screenshots of the Agent panel.

- **Stack:** the local Dokploy v0.30.10 on this VM, with a throwaway dashboard container on 127.0.0.1:3002 using a fresh data volume that was deleted afterwards. Real Dokploy accounts were used: the owner `admin@switchyard.local` and a member `b1-member@switchyard.local` created for this demo.
- **Before** = #31 head `6ad123b`. **After** = this PR `82b6d0b`.
- The script is the same for both runs: `b1demo.mjs` logs in through the dashboard /login and calls `/api/agent/config` from the browser session.
- No real provider was contacted. The keys are fake, and the endpoints are loopback or `*.invalid`.

| Step | Before (#31) | After (#60) |
|---|---|---|
| member `POST {key}` (plant a workspace key) | **200, configured=true** | **403** "Only workspace admins…" |
| member `POST {provider, baseUrl:evil}` | 200 | **403** |
| member `GET` | 200 (no role info) | 200, `canConfigure=false` |
| admin sets provider+loopback endpoint+key together | provider only (one field per call) | 200, configured=true, bound |
| admin changes endpoint, no new key | key kept (would be sent to the new host) | key **cleared** (configured=false) |
| admin sets `http://plain.invalid/v1` | 200 | **400** HTTPS required |

- Files: [before.txt](before.txt), [after.txt](after.txt), [screenshots/](screenshots/). The `after-member-agent-panel.png` screenshot shows the disabled fieldset with its notice.
- Caveat: the empty-state copy still tells members to paste a key. This is cosmetic and is a follow-up.
