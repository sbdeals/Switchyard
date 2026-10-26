# #73 desktop origin boundary (C-P2-3)

Non-UI change, so this is a terminal demo.

- `before.txt`: main's logic, copied verbatim into `policy-demo.cjs`.
  - Prefix matching renders `http://127.0.0.1:30011/` and any `file://` URL in-app.
  - All permissions are granted.
  - Any `file:` frame drives IPC.
- `after.txt`: the branch's `url-policy.ts`, transpiled.
  - Exact origins only.
  - Only clipboard-write is granted.
  - Only the exact status document passes IPC.
- `codex-verifier.txt`: the 1336-assertion throwaway verifier (`switchyard-desktop-origin-boundary.cjs`).

To reproduce: transpile `desktop/src/main/url-policy.ts` to `./url-policy.js`, then run `node policy-demo.cjs before|after`.

The Electron GUI was not run on the VM.
