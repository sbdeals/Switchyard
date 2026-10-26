# Deploy notification local proof

Final dashboard image: `switchyard-dash:deploy-notify`, SHA-256 `5449d680f43e3d66a905a2194533ce1f17216bcb02296c6d6682fa0808493405`.

Executed against `http://127.0.0.1:3027` only:

```sh
BASE=http://127.0.0.1:3027 node /workspace/sy-codex-notes/fix/deploy-notify-proof/proof.mjs
```

Result: exit 0. The proof created one temporary project and two `deploy-notify-*` compose services with cached `busybox:1.37`, no domains or published ports, then deleted both services and the project through the local Dokploy API. A final API read verified all created IDs were absent. A read-only Docker listing found no remaining `deploy-notify-worker` containers.

- `00-first-load-no-spam.png`: initial completed deployments produced no notifications.
- `01-success-toast.png`, `02-success-logs-drawer.png`: successful redeploy notification and exact deployment log drawer.
- `03-error-toast.png`, `05-error-logs-drawer.png`: failed redeploy notification and exact deployment logs showing the intentionally missing executable.
- `04-bell-recent-activity.png`: success and failure across two services, with unread count.
- `06-mark-all-read.png`, `07-reload-persistence-no-duplicates.png`: mark-all-read and persisted activity without duplicate toasts after reload.
- `deploy-notify-proof.mp4`: 28-second recording of the final run, H.264 MP4.
- `proof-results.txt`: assertions and cleanup results.
- `observed-events.json`: the three observed browser activity records.
- `created-resources.json`: exact IDs recorded for cleanup auditing; all are deleted.

The final run also asserted that switching away from the project and back did not resurrect the failure toast. Cancellation was not triggered in the live proof; automated transition tests cover that status.

Final checks: `cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run` passed (50 tests across 3 files); `git diff --check` passed. The final Docker build command was `sudo docker build -q -t switchyard-dash:deploy-notify dashboard` and succeeded.

After proof, the session-created `sy-deploy-notify` dashboard container, `sy-deploy-notify-data` volume and `switchyard-dash:deploy-notify` image tag were removed. Port 3027 is no longer listening. No source lockfiles were changed and no commit was made.

## Round 1 review proof

The header's **Current project** selector defaults to **All projects**. It filters both the service view and deploy activity when a project is selected. This default remains unchanged; `r1-all-projects-default.png` records the initial selection in a fresh browser.

Round 1 dashboard image: `switchyard-dash:deploy-notify`, SHA-256 `2ef09a75adf7f923df093b0a7e33ff9828e38081420d0aa628c1e794fd11e05f`. The screenshots and video above remain the original deploy-notification proof. The additional Round 1 proof was run only against `http://127.0.0.1:3027`:

```sh
BASE=http://127.0.0.1:3027 node /workspace/sy-codex-notes/fix/deploy-notify-proof/r1-proof.mjs
```

Result: exit 0. The script created a `deploy-notify-r1-*` project and idle application with an explicit `deploy-notify-*` app-name prefix. No application was deployed and no domains or published ports were added. An application was used because the compose Settings tab has no editable settings field.

- `r1-variables-before.png` and `r1-variables-after.png`: unsaved Variables text survived two completed, unmodified automatic `/api/workspace` refreshes over 20.3 seconds. The idle interval after the preceding response was 10,003 ms.
- `r1-settings-before.png` and `r1-settings-after.png`: unsaved Settings Name text survived two completed, unmodified automatic refreshes over 20.3 seconds. The idle interval was again 10,003 ms.
- `r1-settings-after-failure-recovery.png`: a browser-only intercepted HTTP 503 caused a 19,952 ms delay before the next real refresh. Its success restored the idle interval to 10,010 ms. The unsaved Settings draft stayed intact throughout.
- `r1-proof-results.txt`, `r1-refresh-observations.json`: assertions, observed refresh request/completion timestamps, response statuses and cleanup results.
- `r1-created-resources.json`: exact final-run IDs for cleanup auditing; both are deleted.

API reads confirmed the Variables and Settings drafts were never saved. The browser visibility handler was also exercised with a **synthetic** `document.visibilityState` override and `visibilitychange` event: no refresh started during 12 seconds hidden, and returning to visible started a refresh in 5 ms. This checks the handler; it is not a recording of an actual background OS tab.

The final run deleted its exact application and project through the local Dokploy API, and a final API read verified both IDs absent. An earlier selector-only harness attempt also cleaned its own application/project and verified both absent before this successful run. No editor changes or dirty-state polling suppression were needed: the polling hook retains the successful snapshot, and existing mounted editor state survived every tested periodic refresh, including the failed refresh.

Round 1 checks: `cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run` passed (78 tests across 5 files). `sudo docker build -q -t switchyard-dash:deploy-notify dashboard` succeeded with the image digest above. The 5-second running/queued interval and exponential-backoff cap are covered by the pure-function Vitest suite; this browser proof used an idle service and one injected failed refresh. No commit or lockfile changes were made.

After Round 1 proof, the session-created `sy-deploy-notify` dashboard container, `sy-deploy-notify-data` volume and `switchyard-dash:deploy-notify` image were removed. Port 3027 is no longer listening. `git diff --check` passed.
