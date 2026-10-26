# F — Staged changes ("N changes · Deploy" bar)

**Before** (`codex/context-menus`, #69): each settings edit writes and (for compose) redeploys immediately. Variables Save writes right away, and Generate URL creates a domain **and fires a deploy** (deploy rows 3 → 4 with no Deploy click). There is no staged bar. See `before.mp4` and `before.txt`.

**After** (`codex/railway-staged-changes`): edits to Variables, Networking, Volumes, Source/Build and Database settings are drafted in the workspace. A sticky bar shows `2 changes · Details · Discard · Deploy`. **Details** lists Field / Current / New with secret values masked. A single **Deploy** click validates every op server-side, applies them in a fixed order, and triggers **exactly one** deployment (rows 4 → 4 while editing, then 4 → 5). See `after.mp4`, `after-1..5-*.png` and `after.txt`.

Run live on the local test stack (`sy-d` :3005, Dokploy v0.30.10) against the throwaway `nodejs-getting-started-u7cf`. Script: `demo-tools/fs-staged.mjs`.

Checks: lint ✔ · tsc ✔ · vitest 495/495 ✔.

Limits: drafts are in memory only, so they are lost on reload. If a write fails mid-batch, the steps already applied are reported (`appliedSteps`/`failedStep`) and nothing is deployed, but those steps are not rolled back.
