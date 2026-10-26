# Mobile dashboard polish — local proof

Scope: `codex/mobile-polish` against `main`, local disposable dashboard `sy-mobile-polish` at `http://127.0.0.1:3053`. Existing local Dokploy services were inspected read-only. No services, domains, deployments, environments, variables, credentials, GitHub installations, or webhooks were created/edited/stopped. No paid model calls. Browser routes block external origins, agent model/chat requests, and GitHub repository/branch actions.

## Baseline audit

Playwright Chromium at 375×812, 414×896, 768×1024, and 1280×800. Live app: nginx-g9se; compose: nodejs-getting-started-u7cf; database: postgres-d4rm. 29 live states per viewport (116 screenshots per phase). `before/` contains the original image; `after/` contains the rebuilt image.

Each screenshot is named for its state. Networking is the UI's Domains tab; Deploys is deployment history. The audit additionally covers Build, Deploy, Schedules, Volumes, Metrics, Console, Compose editor, and signup. No configuration forms were submitted. Variables and password fields are masked in screenshots. Native destructive confirmation dialogs were not opened.

### Issues found

1. **Workspace header (375/414):** one unwrapped actions row makes document width 473px, clipping New service and part of Refresh. Every signed-in live state inherits the horizontal overflow (27/29 states at each phone size). Fixed by wrapping actions, giving view toggles their own phone row, and collapsing Refresh text on phones.
2. **ServiceDrawer (375/414):** max-width 90vw leaves an unnecessary side strip. Fixed with full viewport width below 640px while keeping persisted/resizable desktop width.
3. **Drawer header (phones):** identity/status flex items compete for width; long titles wrap awkwardly and can push the 24px close control out. Fixed shrinking/truncation, wrapping identity/status, and protected close controls.
4. **Overlay stacking (all sizes):** fixed Sign out and Agent tab can overlap drawer/dialog content. They now sit below overlays; the expanded agent stays above.
5. **Tap targets (375/414/768):** login controls, header/view controls, project actions, menu inputs, drawer tabs/lifecycle/copy/save controls, agent toggle/close/send, and modal actions commonly measure 16–38px. Buttons and form controls now have 40px minimum targets below 1024px; checkbox labels provide the larger hit area. Desktop control sizes are retained. Exact raw measured controls are in JSON.
6. **Canvas (phones):** desktop height calculation ignores the taller wrapped header and places controls below the initial fold; minimap occupies excessive phone space. Phone/tablet viewport height follows the header, controls are 40px, phone minimap is hidden. Zoomed canvas nodes remain spatial content; users can pan/zoom or use Grid.
7. **ProjectsPanel (phones):** new-project input's intrinsic minimum width squeezes/clips the Project action; small edit/delete targets and indentation consume usable width. Fixed min-width, spacing, stable header/footer, and scrollable list.
8. **QuickDeployMenu (phones):** anchored fixed320px panel extends past the right viewport edge; expanded catalog can run below the screen, with no close control. Fixed viewport-relative phone positioning, bounded scrolling, safe-area margins, and explicit phone close button.
9. **GitHub dialog (phones/small height):** no height cap/scrolling, tightly packed action rows,24px close. Fixed bounded scrolling and wrapping actions. No GitHub install or credentialed repository request was made.
10. **Overview / long values:** image/info cards lack minimum-width constraints; long internal names/URLs compress siblings or overflow. Fixed min-width and truncation/wrapping. Public URLs were never followed.
11. **Networking / compose domains (phones):** fixed horizontal field widths leave unusable host/port inputs. Forms now wrap or use two-column phone layouts; domain/service names truncate within their rows.
12. **Variables / Build / Settings (phones):** save rows and labels can compete for the same narrow line. Fixed wrapping; long destructive action labels can wrap. No edits were saved.
13. **Logs (phones):** filter input can force its adjacent connection status out; long log text needs a shrinkable flex child. Fixed minimum-width constraints and stable status width.
14. **Data (phones, synthetic read responses):** fixed 176px sidebar leaves only 109/144px for the table. Sidebar now stacks above the results, with bounded independent scrolling; paging/SQL toolbar wraps. The live Postgres service has no running container, so populated table geometry uses clearly named browser-only fixtures.
15. **Agent panel (phones):**92vw cap wastes width, toggle only32px wide, no safe-area handling, small close/send controls, textarea cannot shrink. Full phone width,40px controls, bounded content, and safe-area padding.
16. **Pending-changes dialog (synthetic browser-only state):** long list extends below screen without scroll support; long descriptions and top action bar can overflow. Added viewport caps, scrolling, wrapping. No changes were staged, applied, or discarded on the server.
17. **Safe areas (source inspection):** no viewport-fit cover or inset spacing on edge-fixed UI. Added viewport metadata and safe-area padding/margins. Real notched-device/browser-keyboard behavior is not proven by desktop Chromium emulation.

## Measurement

`overflow-check.mjs` evaluates `document.scrollingElement.scrollWidth > innerWidth` and records every rendered element whose right edge exceeds the viewport. It distinguishes descendants of horizontal clipping/scroll containers from uncontained overflow. Raw right-edge counts intentionally include horizontally scrollable tab bars, canvas nodes, and wide tables; these are not document overflow. The JSON also records raw controls under 40px (excluding canvas-scaled nodes and stretched card buttons); native checkbox boxes may remain small while their labels are 40px. Desktop small controls are intentionally preserved.

`audit.mjs` reproduces live screenshots/counts. `data-fixture.mjs` intercepts all Postgres requests with synthetic targets/tables/rows and never runs SQL. `changes-fixture.mjs` supplies synthetic staged-change GET responses and blocks all agent writes/model/chat requests. Fixture filenames contain `fixture`; they are layout proof, not evidence of actual service state.

## Checks and limitations

- `cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run`: lint and TypeScript pass; Vitest 3.2.7 exits 1 with “No test files found”. This checkout contains no colocated test files. No pure logic was extracted, so no artificial CSS unit test was added.
- Production-mode local Docker build passes. Dependencies/lockfiles unchanged; no npm install was run.
- Populated Data and pending-change states use browser-only fixtures. Real SQL queries, configuration saves, deployment/stop/delete actions, external domains, connected GitHub repository flows, and paid agent operations are outside this read-only proof.

Final before/after counts, verification, and video follow below.

## Final results
116/116 live page/viewport states have zero document overflow and zero uncontained right-edge elements. The two phone viewports previously overflowed in 27/29 live states each (473px document width). All 24 after fixture states also have zero document overflow/uncontained edges.
Phone drawer widths: 375px and 414px. Tablet/desktop default drawer: 576px. Close-button hit testing, tab scrolling,40px canvas controls, and desktop keyboard resize/reset pass in `verification.json`. Zoomed canvas nodes are intentionally scaled;40px zoom controls and Grid provide navigation.
Populated table viewport widths:375:109→343px;414:144→382px;768/1280:347→347px. Pending-change bars move to the phone bottom safe area, their menus open upward, and canvas controls move above them. Dialog footer/menu bounds pass at all four sizes.
[Phone walkthrough MP4, 55 seconds, 414×896 H.264](phone-walkthrough.mp4) · [Before JSON](before.json) · [After JSON](after.json) · [Verification](verification.json) · [Check results](checks.txt)
The walkthrough is 414×896; Variables text is hidden. Existing local service inventories/statuses can change between captures due to parallel local work, so card counts are not pixel-stable regression evidence.
### Per-page counts
Columns use before→after. `Doc` is the document-overflow count (0/1); `Edges` is all right-edge detections; `Exposed` excludes descendants of horizontal clipping/scroll containers; `Small` is raw visible control boxes under 40px. `—` means an additional after-only menu check. Remaining small phone/tablet boxes are native checkboxes with 40px labels. Remaining right edges belong to scrollable tabs/tables/canvas.

#### 375×812
| State/screenshots | Scroll width | Doc | Edges | Exposed | Small |
|---|---:|---:|---:|---:|---:|
| login ([before](before/375x812/login.png) / [after](after/375x812/login.png)) | 375→375 | 0→0 | 0→0 | 0→0 | 4→0 |
| signup ([before](before/375x812/signup.png) / [after](after/375x812/signup.png)) | 375→375 | 0→0 | 0→0 | 0→0 | 5→0 |
| canvas ([before](before/375x812/canvas.png) / [after](after/375x812/canvas.png)) | 473→375 | 1→0 | 4→0 | 4→0 | 10→0 |
| grid ([before](before/375x812/grid.png) / [after](after/375x812/grid.png)) | 473→375 | 1→0 | 4→0 | 4→0 | 7→0 |
| projects ([before](before/375x812/projects.png) / [after](after/375x812/projects.png)) | 473→375 | 1→0 | 4→0 | 4→0 | 9→0 |
| quick-deploy ([before](before/375x812/quick-deploy.png) / [after](after/375x812/quick-deploy.png)) | 473→375 | 1→0 | 39→0 | 5→0 | 2→0 |
| quick-deploy-templates ([before](before/375x812/quick-deploy-templates.png) / [after](after/375x812/quick-deploy-templates.png)) | 473→375 | 1→0 | 2387→0 | 5→0 | 3→0 |
| github-dialog ([before](before/375x812/github-dialog.png) / [after](after/375x812/github-dialog.png)) | 473→375 | 1→0 | 4→0 | 4→0 | 3→0 |
| agent ([before](before/375x812/agent.png) / [after](after/375x812/agent.png)) | 473→375 | 1→0 | 4→0 | 4→0 | 5→0 |
| app-overview ([before](before/375x812/app-overview.png) / [after](after/375x812/app-overview.png)) | 473→375 | 1→0 | 39→34 | 4→0 | 9→0 |
| app-variables ([before](before/375x812/app-variables.png) / [after](after/375x812/app-variables.png)) | 473→375 | 1→0 | 39→34 | 4→0 | 6→0 |
| app-deploy ([before](before/375x812/app-deploy.png) / [after](after/375x812/app-deploy.png)) | 473→375 | 1→0 | 39→34 | 4→0 | 12→2 |
| app-build ([before](before/375x812/app-build.png) / [after](after/375x812/app-build.png)) | 473→375 | 1→0 | 37→33 | 4→0 | 15→2 |
| app-networking ([before](before/375x812/app-networking.png) / [after](after/375x812/app-networking.png)) | 473→375 | 1→0 | 27→20 | 4→0 | 18→1 |
| app-deploys ([before](before/375x812/app-deploys.png) / [after](after/375x812/app-deploys.png)) | 473→375 | 1→0 | 27→20 | 4→0 | 6→0 |
| app-schedules ([before](before/375x812/app-schedules.png) / [after](after/375x812/app-schedules.png)) | 473→375 | 1→0 | 23→19 | 4→0 | 10→0 |
| app-volumes ([before](before/375x812/app-volumes.png) / [after](after/375x812/app-volumes.png)) | 473→375 | 1→0 | 15→9 | 4→0 | 7→0 |
| app-metrics ([before](before/375x812/app-metrics.png) / [after](after/375x812/app-metrics.png)) | 473→375 | 1→0 | 15→9 | 4→0 | 15→0 |
| app-logs ([before](before/375x812/app-logs.png) / [after](after/375x812/app-logs.png)) | 473→375 | 1→0 | 12→8 | 4→0 | 6→0 |
| app-console ([before](before/375x812/app-console.png) / [after](after/375x812/app-console.png)) | 473→375 | 1→0 | 4→0 | 4→0 | 7→0 |
| app-settings ([before](before/375x812/app-settings.png) / [after](after/375x812/app-settings.png)) | 473→375 | 1→0 | 4→0 | 4→0 | 12→0 |
| compose-overview ([before](before/375x812/compose-overview.png) / [after](after/375x812/compose-overview.png)) | 473→375 | 1→0 | 35→26 | 4→0 | 8→0 |
| compose-networking ([before](before/375x812/compose-networking.png) / [after](after/375x812/compose-networking.png)) | 473→375 | 1→0 | 36→26 | 4→0 | 12→0 |
| compose-deploys ([before](before/375x812/compose-deploys.png) / [after](after/375x812/compose-deploys.png)) | 473→375 | 1→0 | 29→25 | 4→0 | 5→0 |
| compose-compose ([before](before/375x812/compose-compose.png) / [after](after/375x812/compose-compose.png)) | 473→375 | 1→0 | 20→13 | 4→0 | 8→0 |
| compose-settings ([before](before/375x812/compose-settings.png) / [after](after/375x812/compose-settings.png)) | 473→375 | 1→0 | 4→0 | 4→0 | 6→0 |
| database-overview ([before](before/375x812/database-overview.png) / [after](after/375x812/database-overview.png)) | 473→375 | 1→0 | 25→21 | 4→0 | 8→0 |
| database-data ([before](before/375x812/database-data.png) / [after](after/375x812/database-data.png)) | 473→375 | 1→0 | 25→21 | 4→0 | 6→0 |
| database-settings ([before](before/375x812/database-settings.png) / [after](after/375x812/database-settings.png)) | 473→375 | 1→0 | 4→0 | 4→0 | 14→0 |
| database-data-synthetic-browse ([before](before/375x812/database-data-synthetic-browse.png) / [after](after/375x812/database-data-synthetic-browse.png)) | 473→375 | 1→0 | 64→50 | 4→0 | 14→0 |
| database-data-synthetic-sql ([before](before/375x812/database-data-synthetic-sql.png) / [after](after/375x812/database-data-synthetic-sql.png)) | 473→375 | 1→0 | 25→21 | 4→0 | 9→0 |
| changes-bar-fixture ([before](before/375x812/changes-bar-fixture.png) / [after](after/375x812/changes-bar-fixture.png)) | 473→375 | 1→0 | 201→211 | 4→0 | 12→0 |
| changes-menu-fixture ([after](after/375x812/changes-menu-fixture.png)) | —→375 | —→0 | —→211 | —→0 | —→0 |
| changes-dialog-fixture ([before](before/375x812/changes-dialog-fixture.png) / [after](after/375x812/changes-dialog-fixture.png)) | 473→375 | 1→0 | 201→211 | 4→0 | 8→0 |
| changes-dialog-bottom-fixture ([before](before/375x812/changes-dialog-bottom-fixture.png) / [after](after/375x812/changes-dialog-bottom-fixture.png)) | 473→375 | 1→0 | 201→211 | 4→0 | 8→0 |

#### 414×896
| State/screenshots | Scroll width | Doc | Edges | Exposed | Small |
|---|---:|---:|---:|---:|---:|
| login ([before](before/414x896/login.png) / [after](after/414x896/login.png)) | 414→414 | 0→0 | 0→0 | 0→0 | 4→0 |
| signup ([before](before/414x896/signup.png) / [after](after/414x896/signup.png)) | 414→414 | 0→0 | 0→0 | 0→0 | 5→0 |
| canvas ([before](before/414x896/canvas.png) / [after](after/414x896/canvas.png)) | 473→414 | 1→0 | 3→0 | 3→0 | 10→0 |
| grid ([before](before/414x896/grid.png) / [after](after/414x896/grid.png)) | 473→414 | 1→0 | 3→0 | 3→0 | 7→0 |
| projects ([before](before/414x896/projects.png) / [after](after/414x896/projects.png)) | 473→414 | 1→0 | 3→0 | 3→0 | 15→0 |
| quick-deploy ([before](before/414x896/quick-deploy.png) / [after](after/414x896/quick-deploy.png)) | 473→414 | 1→0 | 31→0 | 4→0 | 5→0 |
| quick-deploy-templates ([before](before/414x896/quick-deploy-templates.png) / [after](after/414x896/quick-deploy-templates.png)) | 473→414 | 1→0 | 2379→0 | 4→0 | 6→0 |
| github-dialog ([before](before/414x896/github-dialog.png) / [after](after/414x896/github-dialog.png)) | 473→414 | 1→0 | 3→0 | 3→0 | 3→0 |
| agent ([before](before/414x896/agent.png) / [after](after/414x896/agent.png)) | 473→414 | 1→0 | 3→0 | 3→0 | 5→0 |
| app-overview ([before](before/414x896/app-overview.png) / [after](after/414x896/app-overview.png)) | 473→414 | 1→0 | 37→32 | 3→0 | 9→0 |
| app-variables ([before](before/414x896/app-variables.png) / [after](after/414x896/app-variables.png)) | 473→414 | 1→0 | 37→32 | 3→0 | 6→0 |
| app-deploy ([before](before/414x896/app-deploy.png) / [after](after/414x896/app-deploy.png)) | 473→414 | 1→0 | 37→32 | 3→0 | 15→2 |
| app-build ([before](before/414x896/app-build.png) / [after](after/414x896/app-build.png)) | 473→414 | 1→0 | 36→32 | 3→0 | 15→2 |
| app-networking ([before](before/414x896/app-networking.png) / [after](after/414x896/app-networking.png)) | 473→414 | 1→0 | 23→29 | 3→0 | 20→2 |
| app-deploys ([before](before/414x896/app-deploys.png) / [after](after/414x896/app-deploys.png)) | 473→414 | 1→0 | 23→17 | 3→0 | 7→0 |
| app-schedules ([before](before/414x896/app-schedules.png) / [after](after/414x896/app-schedules.png)) | 473→414 | 1→0 | 22→17 | 3→0 | 11→0 |
| app-volumes ([before](before/414x896/app-volumes.png) / [after](after/414x896/app-volumes.png)) | 473→414 | 1→0 | 12→16 | 3→0 | 7→0 |
| app-metrics ([before](before/414x896/app-metrics.png) / [after](after/414x896/app-metrics.png)) | 473→414 | 1→0 | 12→5 | 3→0 | 15→0 |
| app-logs ([before](before/414x896/app-logs.png) / [after](after/414x896/app-logs.png)) | 473→414 | 1→0 | 11→5 | 3→0 | 7→0 |
| app-console ([before](before/414x896/app-console.png) / [after](after/414x896/app-console.png)) | 473→414 | 1→0 | 3→4 | 3→0 | 8→0 |
| app-settings ([before](before/414x896/app-settings.png) / [after](after/414x896/app-settings.png)) | 473→414 | 1→0 | 3→0 | 3→0 | 13→0 |
| compose-overview ([before](before/414x896/compose-overview.png) / [after](after/414x896/compose-overview.png)) | 473→414 | 1→0 | 29→26 | 3→0 | 8→0 |
| compose-networking ([before](before/414x896/compose-networking.png) / [after](after/414x896/compose-networking.png)) | 473→414 | 1→0 | 29→26 | 3→0 | 12→0 |
| compose-deploys ([before](before/414x896/compose-deploys.png) / [after](after/414x896/compose-deploys.png)) | 473→414 | 1→0 | 28→25 | 3→0 | 5→0 |
| compose-compose ([before](before/414x896/compose-compose.png) / [after](after/414x896/compose-compose.png)) | 473→414 | 1→0 | 16→13 | 3→0 | 8→0 |
| compose-settings ([before](before/414x896/compose-settings.png) / [after](after/414x896/compose-settings.png)) | 473→414 | 1→0 | 3→0 | 3→0 | 7→0 |
| database-overview ([before](before/414x896/database-overview.png) / [after](after/414x896/database-overview.png)) | 473→414 | 1→0 | 24→20 | 3→0 | 8→0 |
| database-data ([before](before/414x896/database-data.png) / [after](after/414x896/database-data.png)) | 473→414 | 1→0 | 24→20 | 3→0 | 6→0 |
| database-settings ([before](before/414x896/database-settings.png) / [after](after/414x896/database-settings.png)) | 473→414 | 1→0 | 3→0 | 3→0 | 15→0 |
| database-data-synthetic-browse ([before](before/414x896/database-data-synthetic-browse.png) / [after](after/414x896/database-data-synthetic-browse.png)) | 473→414 | 1→0 | 62→49 | 3→0 | 14→0 |
| database-data-synthetic-sql ([before](before/414x896/database-data-synthetic-sql.png) / [after](after/414x896/database-data-synthetic-sql.png)) | 473→414 | 1→0 | 24→20 | 3→0 | 9→0 |
| changes-bar-fixture ([before](before/414x896/changes-bar-fixture.png) / [after](after/414x896/changes-bar-fixture.png)) | 473→414 | 1→0 | 200→211 | 3→0 | 12→0 |
| changes-menu-fixture ([after](after/414x896/changes-menu-fixture.png)) | —→414 | —→0 | —→211 | —→0 | —→0 |
| changes-dialog-fixture ([before](before/414x896/changes-dialog-fixture.png) / [after](after/414x896/changes-dialog-fixture.png)) | 473→414 | 1→0 | 200→211 | 3→0 | 8→0 |
| changes-dialog-bottom-fixture ([before](before/414x896/changes-dialog-bottom-fixture.png) / [after](after/414x896/changes-dialog-bottom-fixture.png)) | 473→414 | 1→0 | 200→211 | 3→0 | 8→0 |

#### 768×1024
| State/screenshots | Scroll width | Doc | Edges | Exposed | Small |
|---|---:|---:|---:|---:|---:|
| login ([before](before/768x1024/login.png) / [after](after/768x1024/login.png)) | 768→768 | 0→0 | 0→0 | 0→0 | 4→0 |
| signup ([before](before/768x1024/signup.png) / [after](after/768x1024/signup.png)) | 768→768 | 0→0 | 0→0 | 0→0 | 5→0 |
| canvas ([before](before/768x1024/canvas.png) / [after](after/768x1024/canvas.png)) | 768→768 | 0→0 | 0→0 | 0→0 | 11→0 |
| grid ([before](before/768x1024/grid.png) / [after](after/768x1024/grid.png)) | 768→768 | 0→0 | 0→0 | 0→0 | 8→0 |
| projects ([before](before/768x1024/projects.png) / [after](after/768x1024/projects.png)) | 768→768 | 0→0 | 0→0 | 0→0 | 9→0 |
| quick-deploy ([before](before/768x1024/quick-deploy.png) / [after](after/768x1024/quick-deploy.png)) | 768→768 | 0→0 | 0→0 | 0→0 | 4→0 |
| quick-deploy-templates ([before](before/768x1024/quick-deploy-templates.png) / [after](after/768x1024/quick-deploy-templates.png)) | 768→768 | 0→0 | 0→0 | 0→0 | 5→0 |
| github-dialog ([before](before/768x1024/github-dialog.png) / [after](after/768x1024/github-dialog.png)) | 768→768 | 0→0 | 0→0 | 0→0 | 3→0 |
| agent ([before](before/768x1024/agent.png) / [after](after/768x1024/agent.png)) | 768→768 | 0→0 | 0→0 | 0→0 | 5→0 |
| app-overview ([before](before/768x1024/app-overview.png) / [after](after/768x1024/app-overview.png)) | 768→768 | 0→0 | 24→24 | 0→0 | 11→0 |
| app-variables ([before](before/768x1024/app-variables.png) / [after](after/768x1024/app-variables.png)) | 768→768 | 0→0 | 24→24 | 0→0 | 8→0 |
| app-deploy ([before](before/768x1024/app-deploy.png) / [after](after/768x1024/app-deploy.png)) | 768→768 | 0→0 | 24→24 | 0→0 | 21→3 |
| app-build ([before](before/768x1024/app-build.png) / [after](after/768x1024/app-build.png)) | 768→768 | 0→0 | 24→24 | 0→0 | 17→2 |
| app-networking ([before](before/768x1024/app-networking.png) / [after](after/768x1024/app-networking.png)) | 768→768 | 0→0 | 24→24 | 0→0 | 27→2 |
| app-deploys ([before](before/768x1024/app-deploys.png) / [after](after/768x1024/app-deploys.png)) | 768→768 | 0→0 | 23→23 | 0→0 | 7→0 |
| app-schedules ([before](before/768x1024/app-schedules.png) / [after](after/768x1024/app-schedules.png)) | 768→768 | 0→0 | 9→9 | 0→0 | 15→0 |
| app-volumes ([before](before/768x1024/app-volumes.png) / [after](after/768x1024/app-volumes.png)) | 768→768 | 0→0 | 9→9 | 0→0 | 11→0 |
| app-metrics ([before](before/768x1024/app-metrics.png) / [after](after/768x1024/app-metrics.png)) | 768→768 | 0→0 | 9→9 | 0→0 | 19→0 |
| app-logs ([before](before/768x1024/app-logs.png) / [after](after/768x1024/app-logs.png)) | 768→768 | 0→0 | 8→8 | 0→0 | 11→0 |
| app-console ([before](before/768x1024/app-console.png) / [after](after/768x1024/app-console.png)) | 768→768 | 0→0 | 0→0 | 0→0 | 11→0 |
| app-settings ([before](before/768x1024/app-settings.png) / [after](after/768x1024/app-settings.png)) | 768→768 | 0→0 | 0→0 | 0→0 | 16→0 |
| compose-overview ([before](before/768x1024/compose-overview.png) / [after](after/768x1024/compose-overview.png)) | 768→768 | 0→0 | 17→17 | 0→0 | 10→0 |
| compose-networking ([before](before/768x1024/compose-networking.png) / [after](after/768x1024/compose-networking.png)) | 768→768 | 0→0 | 17→17 | 0→0 | 15→0 |
| compose-deploys ([before](before/768x1024/compose-deploys.png) / [after](after/768x1024/compose-deploys.png)) | 768→768 | 0→0 | 17→17 | 0→0 | 7→0 |
| compose-compose ([before](before/768x1024/compose-compose.png) / [after](after/768x1024/compose-compose.png)) | 768→768 | 0→0 | 17→17 | 0→0 | 9→0 |
| compose-settings ([before](before/768x1024/compose-settings.png) / [after](after/768x1024/compose-settings.png)) | 768→768 | 0→0 | 0→0 | 0→0 | 10→0 |
| database-overview ([before](before/768x1024/database-overview.png) / [after](after/768x1024/database-overview.png)) | 768→768 | 0→0 | 12→12 | 0→0 | 11→0 |
| database-data ([before](before/768x1024/database-data.png) / [after](after/768x1024/database-data.png)) | 768→768 | 0→0 | 12→12 | 0→0 | 9→0 |
| database-settings ([before](before/768x1024/database-settings.png) / [after](after/768x1024/database-settings.png)) | 768→768 | 0→0 | 0→0 | 0→0 | 19→0 |
| database-data-synthetic-browse ([before](before/768x1024/database-data-synthetic-browse.png) / [after](after/768x1024/database-data-synthetic-browse.png)) | 768→768 | 0→0 | 41→41 | 0→0 | 18→0 |
| database-data-synthetic-sql ([before](before/768x1024/database-data-synthetic-sql.png) / [after](after/768x1024/database-data-synthetic-sql.png)) | 768→768 | 0→0 | 12→12 | 0→0 | 12→0 |
| changes-bar-fixture ([before](before/768x1024/changes-bar-fixture.png) / [after](after/768x1024/changes-bar-fixture.png)) | 768→768 | 0→0 | 4→4 | 0→0 | 14→0 |
| changes-menu-fixture ([after](after/768x1024/changes-menu-fixture.png)) | —→768 | —→0 | —→4 | —→0 | —→0 |
| changes-dialog-fixture ([before](before/768x1024/changes-dialog-fixture.png) / [after](after/768x1024/changes-dialog-fixture.png)) | 768→768 | 0→0 | 4→4 | 0→0 | 11→0 |
| changes-dialog-bottom-fixture ([before](before/768x1024/changes-dialog-bottom-fixture.png) / [after](after/768x1024/changes-dialog-bottom-fixture.png)) | 768→768 | 0→0 | 4→4 | 0→0 | 11→0 |

#### 1280×800
| State/screenshots | Scroll width | Doc | Edges | Exposed | Small |
|---|---:|---:|---:|---:|---:|
| login ([before](before/1280x800/login.png) / [after](after/1280x800/login.png)) | 1280→1280 | 0→0 | 0→0 | 0→0 | 4→4 |
| signup ([before](before/1280x800/signup.png) / [after](after/1280x800/signup.png)) | 1280→1280 | 0→0 | 0→0 | 0→0 | 5→5 |
| canvas ([before](before/1280x800/canvas.png) / [after](after/1280x800/canvas.png)) | 1280→1280 | 0→0 | 0→0 | 0→0 | 11→11 |
| grid ([before](before/1280x800/grid.png) / [after](after/1280x800/grid.png)) | 1280→1280 | 0→0 | 0→0 | 0→0 | 8→8 |
| projects ([before](before/1280x800/projects.png) / [after](after/1280x800/projects.png)) | 1280→1280 | 0→0 | 0→0 | 0→0 | 15→15 |
| quick-deploy ([before](before/1280x800/quick-deploy.png) / [after](after/1280x800/quick-deploy.png)) | 1280→1280 | 0→0 | 0→0 | 0→0 | 5→5 |
| quick-deploy-templates ([before](before/1280x800/quick-deploy-templates.png) / [after](after/1280x800/quick-deploy-templates.png)) | 1280→1280 | 0→0 | 0→0 | 0→0 | 6→6 |
| github-dialog ([before](before/1280x800/github-dialog.png) / [after](after/1280x800/github-dialog.png)) | 1280→1280 | 0→0 | 0→0 | 0→0 | 3→3 |
| agent ([before](before/1280x800/agent.png) / [after](after/1280x800/agent.png)) | 1280→1280 | 0→0 | 0→0 | 0→0 | 5→5 |
| app-overview ([before](before/1280x800/app-overview.png) / [after](after/1280x800/app-overview.png)) | 1280→1280 | 0→0 | 24→24 | 0→0 | 11→11 |
| app-variables ([before](before/1280x800/app-variables.png) / [after](after/1280x800/app-variables.png)) | 1280→1280 | 0→0 | 24→24 | 0→0 | 8→8 |
| app-deploy ([before](before/1280x800/app-deploy.png) / [after](after/1280x800/app-deploy.png)) | 1280→1280 | 0→0 | 24→24 | 0→0 | 17→17 |
| app-build ([before](before/1280x800/app-build.png) / [after](after/1280x800/app-build.png)) | 1280→1280 | 0→0 | 24→24 | 0→0 | 17→17 |
| app-networking ([before](before/1280x800/app-networking.png) / [after](after/1280x800/app-networking.png)) | 1280→1280 | 0→0 | 24→24 | 0→0 | 20→20 |
| app-deploys ([before](before/1280x800/app-deploys.png) / [after](after/1280x800/app-deploys.png)) | 1280→1280 | 0→0 | 23→23 | 0→0 | 7→7 |
| app-schedules ([before](before/1280x800/app-schedules.png) / [after](after/1280x800/app-schedules.png)) | 1280→1280 | 0→0 | 9→9 | 0→0 | 16→16 |
| app-volumes ([before](before/1280x800/app-volumes.png) / [after](after/1280x800/app-volumes.png)) | 1280→1280 | 0→0 | 9→9 | 0→0 | 12→12 |
| app-metrics ([before](before/1280x800/app-metrics.png) / [after](after/1280x800/app-metrics.png)) | 1280→1280 | 0→0 | 9→9 | 0→0 | 20→20 |
| app-logs ([before](before/1280x800/app-logs.png) / [after](after/1280x800/app-logs.png)) | 1280→1280 | 0→0 | 8→8 | 0→0 | 12→12 |
| app-console ([before](before/1280x800/app-console.png) / [after](after/1280x800/app-console.png)) | 1280→1280 | 0→0 | 0→0 | 0→0 | 15→15 |
| app-settings ([before](before/1280x800/app-settings.png) / [after](after/1280x800/app-settings.png)) | 1280→1280 | 0→0 | 0→0 | 0→0 | 20→20 |
| compose-overview ([before](before/1280x800/compose-overview.png) / [after](after/1280x800/compose-overview.png)) | 1280→1280 | 0→0 | 17→17 | 0→0 | 10→10 |
| compose-networking ([before](before/1280x800/compose-networking.png) / [after](after/1280x800/compose-networking.png)) | 1280→1280 | 0→0 | 17→17 | 0→0 | 15→15 |
| compose-deploys ([before](before/1280x800/compose-deploys.png) / [after](after/1280x800/compose-deploys.png)) | 1280→1280 | 0→0 | 17→17 | 0→0 | 7→7 |
| compose-compose ([before](before/1280x800/compose-compose.png) / [after](after/1280x800/compose-compose.png)) | 1280→1280 | 0→0 | 17→17 | 0→0 | 9→9 |
| compose-settings ([before](before/1280x800/compose-settings.png) / [after](after/1280x800/compose-settings.png)) | 1280→1280 | 0→0 | 0→0 | 0→0 | 12→12 |
| database-overview ([before](before/1280x800/database-overview.png) / [after](after/1280x800/database-overview.png)) | 1280→1280 | 0→0 | 12→12 | 0→0 | 11→11 |
| database-data ([before](before/1280x800/database-data.png) / [after](after/1280x800/database-data.png)) | 1280→1280 | 0→0 | 12→12 | 0→0 | 9→9 |
| database-settings ([before](before/1280x800/database-settings.png) / [after](after/1280x800/database-settings.png)) | 1280→1280 | 0→0 | 0→0 | 0→0 | 19→19 |
| database-data-synthetic-browse ([before](before/1280x800/database-data-synthetic-browse.png) / [after](after/1280x800/database-data-synthetic-browse.png)) | 1280→1280 | 0→0 | 41→41 | 0→0 | 18→18 |
| database-data-synthetic-sql ([before](before/1280x800/database-data-synthetic-sql.png) / [after](after/1280x800/database-data-synthetic-sql.png)) | 1280→1280 | 0→0 | 12→12 | 0→0 | 12→12 |
| changes-bar-fixture ([before](before/1280x800/changes-bar-fixture.png) / [after](after/1280x800/changes-bar-fixture.png)) | 1280→1280 | 0→0 | 0→0 | 0→0 | 14→14 |
| changes-menu-fixture ([after](after/1280x800/changes-menu-fixture.png)) | —→1280 | —→0 | —→0 | —→0 | —→15 |
| changes-dialog-fixture ([before](before/1280x800/changes-dialog-fixture.png) / [after](after/1280x800/changes-dialog-fixture.png)) | 1280→1280 | 0→0 | 0→0 | 0→0 | 9→9 |
| changes-dialog-bottom-fixture ([before](before/1280x800/changes-dialog-bottom-fixture.png) / [after](after/1280x800/changes-dialog-bottom-fixture.png)) | 1280→1280 | 0→0 | 0→0 | 0→0 | 9→10 |

## Reproduce

```sh
BASE=http://127.0.0.1:3053 node /workspace/sy-codex-notes/fix/mobile-polish-proof/audit.mjs after
BASE=http://127.0.0.1:3053 node /workspace/sy-codex-notes/fix/mobile-polish-proof/data-fixture.mjs after
BASE=http://127.0.0.1:3053 node /workspace/sy-codex-notes/fix/mobile-polish-proof/changes-fixture.mjs after
BASE=http://127.0.0.1:3053 node /workspace/sy-codex-notes/fix/mobile-polish-proof/verify.mjs
BASE=http://127.0.0.1:3053 node /workspace/sy-codex-notes/fix/mobile-polish-proof/walkthrough.mjs
```

## Source files changed

- `dashboard/src/app/layout.tsx`
- `dashboard/src/app/login/LoginForm.tsx`
- `dashboard/src/app/login/page.tsx`
- `dashboard/src/components/GithubDeployModal.tsx`
- `dashboard/src/components/LogoutButton.tsx`
- `dashboard/src/components/ProjectsPanel.tsx`
- `dashboard/src/components/QuickDeployMenu.tsx`
- `dashboard/src/components/ServiceCard.tsx`
- `dashboard/src/components/Workspace.tsx`
- `dashboard/src/components/agent/AgentPanel.tsx`
- `dashboard/src/components/agent/ChangesBar.tsx`
- `dashboard/src/components/canvas/FlowCanvas.tsx`
- `dashboard/src/components/service/AppTabs.tsx`
- `dashboard/src/components/service/BackupsTab.tsx`
- `dashboard/src/components/service/ComposeTabs.tsx`
- `dashboard/src/components/service/DataTab.tsx`
- `dashboard/src/components/service/LogsTab.tsx`
- `dashboard/src/components/service/ServiceDrawer.tsx`
- `dashboard/src/components/service/VariablesTab.tsx`
- `dashboard/src/components/service/VolumesTab.tsx`
- `dashboard/src/components/service/networking.tsx`
- `dashboard/src/components/service/primitives.tsx`

No dependency or lockfile changes, no pure-logic extraction, and no commit. No demo service resources were created, so none needed deletion. The only session-created runtime is the throwaway review dashboard `sy-mobile-polish` on 3053.
