Keyboard shortcuts help proof, local dashboard on http://127.0.0.1:3039.

Implemented a shared registry of 27 shortcut/gesture entries, including the new help binding, grouped as Global, Canvas, and Service drawer. The help overlay uses the existing stacked focus trap and has a header ? button, named dialog, platform-aware labels, and a guard for typing/composition/modifier/repeat events. Escape, SQL execution, and service-card opening handlers now read registry keys.

Source files touched:

- dashboard/src/lib/shortcuts.ts
- dashboard/src/lib/shortcuts.test.ts
- dashboard/src/components/KeyboardShortcuts.tsx
- dashboard/src/components/Workspace.tsx
- dashboard/src/components/use-focus-trap.ts
- dashboard/src/components/canvas/ServiceNode.tsx
- dashboard/src/components/service/DataTab.tsx
- dashboard/tsconfig.json

Checks:

- `cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run` — PASS; 32 tests, one test file.
- `git diff --check` — PASS.
- `sudo docker build -q -t switchyard-dash:shortcuts-help dashboard` — PASS (Next.js production image).
- `/tmp/runsy.sh sy-shortcuts-help 3039 shortcuts-help-proof` — HTTP 200. The proof image derives from the built image with only `ENV SWITCHYARD_ALERTS=off`, so background alerts cannot send notifications.
- `BASE=http://127.0.0.1:3039 node /workspace/sy-codex-notes/fix/shortcuts-help-proof/proof.mjs` — PASS; ? opens, Esc closes, real project input ignores ?, focus stays trapped and restores, help above an existing Projects dialog closes independently, header button opens help. No browser page errors.
- `BASE=http://127.0.0.1:3039 node /workspace/sy-codex-notes/fix/shortcuts-help-proof/extra-checks.mjs` — PASS; browser textarea/contenteditable/plaintext-only guard, modified-key guards, backdrop close/focus return, simulated macOS labels, 390px layout bounds.
- `ffprobe -v error -show_entries stream=codec_name,width,height -show_entries format=duration,size -of json /workspace/sy-codex-notes/fix/shortcuts-help-proof/shortcuts-help.mp4` — valid H.264 MP4, 1440×1000, 15.52 seconds.

Evidence:

- `shortcuts-help.mp4`: captioned recording of the interactions above.
- `01-question-opens.png`, `02-shortcut-groups.png`, `08-drawer-shortcuts.png`: registry groups and key labels.
- `03-escape-closes.png`, `04-typing-question-ignored.png`: dismissal and typing guard.
- `05-stacked-dialog.png`, `06-header-button.png`, `07-dashboard-header.png`: stacked help and discoverable button.
- `09-mac-labels-simulated.png`, `10-small-viewport.png`: simulated macOS formatting and small viewport.
- `steps.json`, `extra-checks.txt`: assertion results; scripts are included for reproduction.

Limitations:

- This base is commit `1fc46d5` and has no command palette or canvas N binding. No palette entry/proof is possible; neither shortcut was invented.
- macOS display was tested with a browser platform override and unit tests, not a native Mac.
- Existing canvas/drawer actions were audited from source; destructive/command/SQL actions were not executed for this UI change. React Flow defaults may need an audit when its dependency is upgraded.
- Vitest is present in the supplied node_modules but absent from this base's package manifest/lockfile. Dependencies and lockfiles remain unchanged. Test files are excluded from the production TypeScript build, which otherwise cannot resolve Vitest in the Docker image; Vitest executes them separately.
- No Dokploy resources were created, modified, or deleted. Project text was entered and cleared without submission. Only the session's throwaway dashboard container, data volume, and image tags were created; all were removed after proof capture. No production deployment was accessed.
