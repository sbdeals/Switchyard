# Accessibility pass proof

Local dashboard only: `http://127.0.0.1:3054`, base `main` at `1fc46d5ef07efbd5b9561c4a24935c78b5f15d3f`. Final proof image: `sha256:b836a807fca0e2809247ba618d2d789640ab51162a011446b269f669642e0402`.

All 39 live surfaces have **zero axe violations after the change**, down from 69 rule occurrences / 1,437 affected node occurrences. The same node can appear in multiple surfaces; these are scan occurrence counts, not unique defects. Critical and serious violations were zero in both runs. Incomplete checks still need the qualifications below.

| Impact | Before rule occurrences | After rule occurrences | Before node occurrences | After node occurrences |
| --- | ---: | ---: | ---: | ---: |
| Critical | 0 | 0 | 0 | 0 |
| Serious | 0 | 0 | 0 | 0 |
| Moderate | 38 | 0 | 1,406 | 0 |
| Minor | 31 | 0 | 31 | 0 |
| Total | 69 | 0 | 1,437 | 0 |

| Rule | Impact | Before surfaces / nodes | After surfaces / nodes |
| --- | --- | ---: | ---: |
| `region` | moderate | 36 / 1,404 | 0 / 0 |
| `landmark-one-main` | moderate | 2 / 2 | 0 / 0 |
| `aria-allowed-role` | minor | 31 / 31 | 0 / 0 |

The fixes add a main landmark, use a valid element for the drawer's dialog role, give canvas nodes one named keyboard target with Enter/Space activation, fix focus wrapping and restoration between overlays, complete nested Data tabs, and expose QuickDeploy relationships/statuses and the busy Console button's name. Existing names, form labels, drawer tabs and other dialog roles passed the baseline; no broad visual changes were made.

## Reports and coverage

- [Before JSON](before.json), [before rule/impact and surface tables](before-summary.md).
- [After JSON](after.json), [after rule/impact and surface tables](after-summary.md).
- [Keyboard walkthrough MP4](keyboard-walkthrough.mp4), [keyboard assertions](keyboard.json).
- [Before token contrast](before-token-contrast.md), [after token contrast](after-token-contrast.md), with matching JSON files.
- [Dialog ID relationship assertions](dialog-relationships.json).
- [Existing service Data availability](data-availability.json).
- [Separate mocked Data browser proof](data-fixture.json).

Pinned axe-core `4.10.2` is loaded by `page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js' })` in the proof script only; no package dependency was added. Reports preserve axe rule metadata, targets and check messages but omit all node HTML/check text payloads that could carry field values. No credentials, variables, logs or connection strings are saved.

The 39 surfaces are login, sign-up, workspace canvas/grid, ProjectsPanel, QuickDeploy's Docker/repository/database controls, expanded template catalog, GitHub dialog, and every drawer tab for these existing local services:

| Representative | Kind | Tabs scanned |
| --- | --- | --- |
| `nginx-g9se` | application | Overview, Variables, Deploy, Build, Networking, Deploys, Schedules, Volumes, Metrics, Logs, Console, Settings |
| `nodejs-getting-started-u7cf` | compose | Overview, Variables, Networking, Deploys, Compose, Volumes, Metrics, Logs, Console, Settings |
| `postgres-d4rm` | Postgres | Overview, Data, Variables, Volumes, Metrics, Logs, Console, Backups, Settings |

Docker, repository, database and template provisioning are inline QuickDeploy controls in this base; separate dialogs/preview dialogs do not exist. Project rename/delete native browser dialogs were opened and dismissed. Axe cannot inspect browser chrome. Only the local authentication form was submitted; no service mutation, deploy, delete, save, SQL or Console action was submitted.

## Keyboard evidence

The 25.6-second MP4 uses only keyboard interactions after navigation. Authentication happens before the recorded context; session state remains in memory. Proof-only CSS hides input/textarea/pre/code text, and an aria-hidden caption identifies the current check. The axe scans use the unmodified page, without this CSS or caption.

Assertions passed for Tab to the nginx canvas node, Enter to open its drawer, initial Shift+Tab containment, Tab wrapping, ArrowLeft/ArrowRight wrapping, Home/End, one tabbable selected tab, and Escape restoring the exact original canvas node. ProjectsPanel and QuickDeploy retain focus and restore their trigger on Escape. QuickDeploy → GitHub keeps focus inside the new dialog after animation; Escape returns to New service.

## Contrast and incomplete checks

Only `--color-idle` changes: `#8888a0` → `#8e8ea6`; its soft background stays unchanged. This raises idle text on the tinted badge over a hovered service card from **4.213:1 to 4.556:1**. The Data NULL badge uses the corrected idle foreground. No other theme tokens change.

The supplement evaluates 52 foreground/background combinations using WCAG sRGB luminance and CSS alpha compositing, including a conservative body-gradient upper bound with both radial glows at maximum alpha simultaneously. Applicable text combinations are at least 4.556:1 and control borders at least 3.023:1. The report deliberately retains one hypothetical failing combination: brand text on brand-soft over surface-hover is 4.215:1. No text uses that combination in the audited UI; active Metrics text uses brand-soft over surface, which passes. Icons have a 3:1 threshold.

Axe leaves color contrast incomplete on 438 repeated nodes across all 39 surfaces because it cannot resolve the body gradient. The token calculations supplement this limitation; zero violations is not a claim of complete WCAG conformance or a substitute for rendered visual review. The baseline canvas `aria-prohibited-attr` incomplete is resolved by naming a controls group. Afterward, axe marks the two QuickDeploy `aria-controls` checks incomplete; independent browser assertions confirm both IDs resolve to their visible intended elements, including the named modal dialog.

Both available Data-capable services (`postgres-d4rm`, `compose-5ntm`) lack a running Postgres target. The live Data scan therefore covers the fallback state. All 13 existing service drawers were checked for availability. Nested Browse/SQL live backend behavior remains unproven; no resource was started to manufacture coverage.

A separate, explicitly **mocked API** browser fixture covers Browse, Browse rows including NULL, and SQL: all three have zero confirmed axe violations. Seven runtime state snapshots verify focus, one roving tab stop, selected state, panel linkage, arrow wrapping, Home/End, Tab into the panel and Shift+Tab back. All five Postgres requests (targets/tables/rows) were intercepted with synthetic fixtures; none reached the backend and no SQL was submitted. These three surfaces are **excluded from the 39 live before/after counts**. Each fixture scan retains one incomplete color-contrast rule for gradients/obscured elements, including the SQL textarea; visual review remains necessary.

## Reproduction and checks

Run each audit against its corresponding dashboard build; `before.json` is preserved from the original base image.

```sh
BASE=http://127.0.0.1:3054 node /workspace/sy-codex-notes/fix/a11y-pass-proof/audit.mjs before
BASE=http://127.0.0.1:3054 node /workspace/sy-codex-notes/fix/a11y-pass-proof/audit.mjs after
BASE=http://127.0.0.1:3054 node /workspace/sy-codex-notes/fix/a11y-pass-proof/keyboard.mjs
BASE=http://127.0.0.1:3054 node /workspace/sy-codex-notes/fix/a11y-pass-proof/dialog-relationships.mjs
BASE=http://127.0.0.1:3054 node /workspace/sy-codex-notes/fix/a11y-pass-proof/data-fixture.mjs
node /workspace/sy-codex-notes/fix/a11y-pass-proof/contrast.mjs after
ffmpeg -hide_banner -loglevel error -y -i /workspace/sy-codex-notes/fix/a11y-pass-proof/keyboard.webm -c:v libx264 -pix_fmt yuv420p -movflags +faststart -an /workspace/sy-codex-notes/fix/a11y-pass-proof/keyboard-walkthrough.mp4
```

Repository checks run by the implementation owner ([record](checks.txt)):

```sh
cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run
```

Result: exit 0; ESLint and TypeScript passed; **35 tests passed across 8 files**. Docker dashboard build and final `git diff --check` passed. No install or lockfile changes; no commit or push.

## Repository files touched

- `dashboard/src/app/globals.css`
- `dashboard/src/app/page.tsx`
- `dashboard/src/components/QuickDeployMenu.tsx`
- `dashboard/src/components/canvas/FlowCanvas.tsx`
- `dashboard/src/components/canvas/ServiceNode.tsx`
- `dashboard/src/components/service/ConsoleTab.tsx`
- `dashboard/src/components/service/DataTab.tsx`
- `dashboard/src/components/service/ServiceDrawer.tsx`
- `dashboard/src/components/use-focus-trap.ts`
- `dashboard/src/lib/canvas-accessibility.test.ts`
- `dashboard/src/lib/console-accessibility.test.ts`
- `dashboard/src/lib/data-tab-accessibility.test.ts`
- `dashboard/src/lib/dialog-focus.test.ts`
- `dashboard/src/lib/dialog-focus.ts`
- `dashboard/src/lib/quick-deploy-a11y.test.ts`
- `dashboard/src/lib/tab-navigation.test.ts`
- `dashboard/src/lib/tab-navigation.ts`
- `dashboard/src/lib/theme-contrast.test.ts`
- `dashboard/src/lib/workspace-landmark.test.ts`

Proof artifacts live outside the repository. No pre-existing application, database, project or environment was modified. Cleanup completed after the final capture: session-created container `sy-a11y-pass`, volume `sy-a11y-pass-data`, and image tag `switchyard-dash:a11y-pass` were removed. The saved proof remains reviewable without a live server. No pre-existing services were stopped or deleted.
