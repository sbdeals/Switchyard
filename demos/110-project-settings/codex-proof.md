Project settings proof — local dashboard on http://127.0.0.1:3042

Implementation: General edits project name/description and non-default, non-production environment names. Danger lists the complete service/database inventory, requires the exact project name, and requires acknowledgement for running services in the selected project. This base has no project selector: selection follows the last opened service. The server rechecks project.all access, current name, role, runtime state, and the reviewed inventory before mutations.

Validation (all passed):
- `cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run` — lint clean, TypeScript clean, 100 tests in 2 files.
- `git diff --check` — clean.
- `sudo docker build -q -t switchyard-dash:project-settings dashboard && /tmp/runsy.sh sy-project-settings 3042 project-settings` — build and local startup passed.
- `BASE=http://127.0.0.1:3042 node /workspace/sy-codex-notes/fix/project-settings-proof/proof.mjs` — passed full browser proof (result.json).

Artifacts:
- proof.mp4 — complete successful browser recording.
- 01-general-before.png, 02-general-saved.png, 03-general-after-reload.png — project metadata and environment rename persist.
- 04-danger-blocked.png, 05-danger-confirmed.png — selected running service requires acknowledgement after exact-name confirmation; trailing whitespace was also rejected.
- 06-dashboard-project-gone.png, 07-dashboard-service-gone.png — removed from refreshed dashboard.
- dokploy-project-all.json — actual local API query, HTTP 200, filtered to the session-created project ID; matchingProjects is empty.
- result.json, resources.json, first-resources.json, setup-result.json — sanitized proof identifiers and assertions. Both session-created projects were deleted through Danger; first-project absence was verified before the final recording. Final Docker check found no containers with the session-created project-settings-tiny service label.

Dokploy v0.30.10 source verification:
- https://github.com/Dokploy/dokploy/blob/v0.30.10/packages/server/src/db/schema/project.ts — project.update accepts projectId/name/description; clear description with an empty string.
- https://github.com/Dokploy/dokploy/blob/v0.30.10/apps/dokploy/server/api/routers/environment.ts — environment.update accepts environmentId/name; default environments cannot be renamed.
- https://github.com/Dokploy/dokploy/blob/v0.30.10/packages/server/src/services/project.ts — project.one returns sanitized service summaries; project.remove only cascades database records.
- https://github.com/Dokploy/dokploy/blob/v0.30.10/apps/dokploy/components/dashboard/projects/show.tsx — upstream UI requires services to be removed before project deletion.

Limits: deletion is restricted to organization owners/admins because member inventories can hide resources. Cleanup calls Dokploy's service deletion APIs before project.remove, retains Compose volumes, and is not atomic. Upstream deletion endpoints can suppress Docker cleanup errors. Runtime absence falls back to deployment status for stacks/remote replicas. Native database cleanup is covered by mocked tests; live proof used a tiny Compose service only. The base package manifest does not declare Vitest despite the supplied node_modules containing it; no install or lockfile changes were made, and test files are excluded from the production Docker build context.

No production resources, paid APIs, or other worktrees were used. Only session-created local projects/services and the proof dashboard were mutated. No commits were made.

Cleanup: session-created dashboard sy-project-settings and its data volume were removed after proof; port 3042 is no longer served by this session. The MP4 is 21.52 seconds.
