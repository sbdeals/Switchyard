# Desktop/CLI stop and reset: honest control-plane scope, confirmed fresh start

Non-UI (Electron and CLI): terminal before/after.

- before.txt: on main, the tray says "Stop stack" and "Reset everything…". The dialog claims every deployment and database is deleted, but teardown only removes the control plane, so workloads keep running, orphaned. The stale-data "Fresh start (deletes it)" button called resetAll() **without any confirmation**.
- after.txt: wording says "control plane" and the orphaning risk is stated. Fresh start goes through the same cancel-by-default dialog. A shared, pure planner removes only the exact reserved control-plane names. The CLI suite passes 49/49, including 12 new planner tests, and the desktop verifier passes 9/9 with fake Docker and Electron. No real Docker or GUI was touched.
- verify-desktop-stop-reset.cjs: the throwaway desktop verifier.
