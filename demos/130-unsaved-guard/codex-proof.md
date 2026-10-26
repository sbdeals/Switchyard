Unsaved-changes guard proof — local dashboard on port 3060, base main `1fc46d5`.

The shared registry protects all 11 forms with existing dirty flags, plus the three explicitly requested Domain form variants. One in-app Discard / Keep editing dialog handles X, Escape, backdrop, mouse/keyboard tabs, service selection, and Projects entry. Keep editing restores field focus; beforeunload is installed only while dirty. Drawer session keys prevent discarded state returning during an interrupted exit animation.

Main inventory inspected before implementation:

| Editable form | Dirty state on main | Result |
| --- | --- | --- |
| Variables, all service types | Environment text differs from service.env | Registered |
| App Deployments / auto-deploy | Branch, auto-deploy, normalized watch paths differ | Registered |
| Build strategy | Build type and applicable Dockerfile/context/stage fields differ | Registered |
| Docker source | Image, registry, or entered credentials differ | Registered |
| Start command | Command differs | Registered |
| Deploy replicas | Nonempty replicas differs | Registered |
| Restart policy | Condition/max attempts differ | Registered |
| Health check | Command/timings/retries differ | Registered |
| App Settings | Name/resources differ | Registered |
| Database Settings | Name/image version/external port/CPU/memory differ | Registered |
| Compose editor | File text differs | Registered |
| App Domains add | None | Shallow draft/default comparison added |
| App Domain row edit | None | Active edit compared with persisted domain |
| Compose Domains add | None | Host/service/port compared with initial or submitted defaults |
| App schedules create/edit | None | Unchanged |
| Networking redirects add | None | Unchanged |
| Networking published ports add | None | Unchanged |
| Networking basic-auth add | None | Unchanged |
| Volumes add/edit | None | Unchanged |
| Backups destination creation | None | Unchanged |
| Backups schedule creation | None | Unchanged |
| Backup restore target/file selection | None | Unchanged |
| SQL query/write toggle/target and Console command | None | Unchanged |
| Projects/environment creation and native rename prompts | None | Unchanged |
| New-service Docker/Git inputs, target/template selector, GitHub repository/branch selectors | None | Unchanged |
| Agent chat, connection URL, key, custom-model drafts | None | Unchanged; agent features were not used |
| Login credentials | None | Unchanged |

Files touched in the worktree:

- dashboard/.dockerignore
- dashboard/src/components/DirtyGuard.tsx
- dashboard/src/components/Workspace.tsx
- dashboard/src/components/service/ServiceDrawer.tsx
- dashboard/src/components/service/VariablesTab.tsx
- dashboard/src/components/service/AppTabs.tsx
- dashboard/src/components/service/ComposeTabs.tsx
- dashboard/src/lib/dirty-guard.ts
- dashboard/src/lib/dirty-guard.test.ts

Checks:

```sh
cd /workspace/wt-unsaved-guard/dashboard && npm run lint && npx tsc --noEmit && npx vitest run
```

Passed: lint and TypeScript exit 0; Vitest 1 file / 22 tests passed. `git diff --check` also passed.

```sh
sudo docker build -q -t switchyard-dash:unsaved-guard dashboard && /tmp/runsy.sh sy-unsaved-guard 3060 unsaved-guard
BASE=http://127.0.0.1:3060 node /workspace/sy-codex-notes/fix/unsaved-guard-proof/proof.mjs
```

Build passed; runner responded HTTP 200. Final browser run exited 0 with 16 checks and no browser runtime errors. See results.json. Earlier harness attempts were cleaned up; final screenshots/video/results come from the successful run.

Artifacts:

- proof.mp4 and proof.webm: complete successful browser run.
- 01-variables-close-confirm.png: Variables discard confirmation.
- 02-keep-editing-preserves-text.png: retained draft and restored field focus.
- 03-discard-closes-drawer.png: drawer closed after Discard.
- 04-tab-switch-confirm.png: guarded tab switch.
- 05-compose-tab-switch-confirm.png and 06-compose-keep-editing.png: Compose confirmation and preserved text.
- 07-domains-kept.png: retained Domain draft.
- api-readback.json: original and post-discard environment are byte-for-byte equal.
- cleanup-verification.json: zero remaining unsaved-guard projects/services after API deletion.

Scope and limitations:

- Main has no project selector. Cross-project service selection and Projects management entry use the guard. The modal drawer backdrop covers those underlying buttons, so the proof dispatches their click handlers directly; ordinary mouse clicks on the backdrop are tested separately.
- Forms without an existing dirty flag remain outside scope, except Domains. Existing dirty semantics are preserved, including replicas treating an empty input as clean.
- Completed saves clear the registry when refreshed props commit. The existing Saved flash can precede that commit; attempting navigation during the pending save can still ask for confirmation.
- Browser unload dialogs use browser-controlled wording. Only local Chromium was exercised.
- Main's package.json omits Vitest although the supplied node_modules includes Vitest 3.2.7. No package/lockfile changes or installs were made. Test files are excluded from the Docker context so the locked image build does not require the absent test dependency.
- The throwaway app and Compose definitions were not deployed; only their local configuration/forms were exercised. Both services and both projects were deleted through Dokploy's API. No pre-existing service was modified or deployed. The temporary dashboard runner and its volume were removed after proof; the built image remains a local build artifact.
