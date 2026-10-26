# Service notes local proof

Dashboard: http://127.0.0.1:3063 (sy-service-notes; local Dokploy v0.30.10).

- `service-notes-proof.mp4`: final browser recording (H.264).
- `01-saving.png`, `02-app-saved.png`: app note pending and successful save.
- `03-limit-500.png`: long pasted note capped at 500 characters with counter.
- `04-script-text-reloaded.png`: literal script text persisted on compose after reload.
- `05-canvas-subtitles-tooltip.png`: truncated canvas notes; full multiline native title attributes verified by Playwright.
- `06-generic-save-error.png`: stale service ownership rejection preserves draft and reports generic error.
- `results.json`: successful live assertions and API cleanup results.
- `proof.mjs`: repeatable local proof script using the authorized demo-tools login helper.

Final checks: `cd /workspace/wt-service-notes/dashboard && npm run lint && npx tsc --noEmit && npx vitest run` passed, 53 tests across 4 files. `git diff --check` passed. Production Docker build passed. No lockfiles changed.

The app, compose service, and their project were created for this proof and removed through the Dokploy API. Their IDs are in `resources.json`; cleanup verified that the project no longer exists. They were never deployed. No pre-existing services were modified or stopped. The isolated dashboard remains on port 3063 for review.

Live coverage: app/compose persistence after reload, Enter save, Shift+Enter newline, Escape cancel without closing drawer, saving/saved/error states, 500-character input cap, script text escaping/non-execution, canvas first line and full title. Database update/read mappings are unit tested for all five engines and checked against upstream v0.30.10 schemas; database persistence was not exercised live. Interactive behavior is covered by Playwright; Vitest UI checks cover rendered markup.
