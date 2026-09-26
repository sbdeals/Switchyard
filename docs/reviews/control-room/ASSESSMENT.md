# Switchyard assessment and proposed first increment

26 September 2026 · Repository: `sbdeals/Switchyard` · Baseline: `1fc46d5` · Reconstructed review branch: `codex/workspace-ui-operator-flow`

This assessment began before the temporary VM checkout was cleared. The current review branch was rebuilt from main, so the verification statements below distinguish the reconstructed code from the earlier recordings.

## Verdict

Switchyard is a substantial Dokploy-backed control plane, not a hollow UI mockup. The code covers application, Compose, and five database workflows; GitHub and template deployment paths; domains, environment variables, volumes, logs, metrics, backups, deployment history, and rollback. It also has a CLI, Electron desktop shell, and MCP server. The architecture sensibly keeps the Dokploy session in a server-side backend-for-frontend and uses Dokploy for orchestration rather than rebuilding it.

It is **not yet a production-hardened, multi-user Railway equivalent**. Signed-in users effectively have admin-level power, agent configuration is shared globally, the agent credential is not durable across dashboard container replacement, and the CLI's replacement path has an availability gap. There are also product gaps in team roles, preview environments, deployment promotion, and per-deployment build logs. Those conclusions come from code and documentation inspection, not a live production deployment.

The new branch is a focused first increment: it gives operators a clearer, responsive workspace and fixes concrete status/authentication inconsistencies. It does not claim to finish the wider platform roadmap.

## What I examined

- Repository structure and critical paths in `dashboard/`, `cli/`, `desktop/`, `mcp/`, `scripts/`, and `.github/workflows/`.
- Dashboard production build, lint, and an HTTP regression test for sealed session validation on the reconstructed branch.
- CLI and MCP typechecks and tests; desktop typecheck/build in the earlier source assessment. Those paths were not changed in the reconstructed branch.
- Desktop smoke command, which stopped before app verification because this VM has no Docker CLI or daemon.
- Baseline and earlier proposed browser UI at desktop and mobile widths, using the same **seeded demo services**. The videos predate the reconstructed commit and show its design direction, not exact pixel parity. The rebuilt branch has not had a fresh browser visual pass.

No real Dokploy stack, Docker deployment, DNS/SSL, backup restore, packaged desktop installer, upgrade, or release was exercised in this VM. Source-level findings about those paths need an integration pass before release.

## Before and after

| Area | Baseline | Proposed branch |
| --- | --- | --- |
| Navigation | Flat page with project management behind a control | Persistent project/environment navigation and a mobile drawer |
| Fleet health | Individual cards, little fleet-level orientation | Clickable totals for all, running, deploying, and needing attention within scope |
| Finding services | Browse canvas or grid | Search by service/image/project and filter by kind and health in both views; `/` and Ctrl/⌘ K focus search |
| Status accuracy | Grid could say “Running” while Docker runtime reported degraded or stopped | Grid, canvas, and drawer overview use the runtime-aware display model |
| Canvas | Existing draggable layout | Reset layout and preserved saved positions when filtering |
| Deploy destination | Menu could retain a previous environment choice after scope change | Defaults to the selected environment and resets on scope change |
| Empty state | One general placeholder | First-deploy state and scoped empty state with appropriate deployment destination |

The reconstructed visual treatment uses an orange accent, a persistent operator sidebar, compact status controls, and a full-width mobile service view. The real measure of “sublime” will require feedback with actual service counts, long names, failures, and deployment workflows. The videos demonstrate an earlier version of this direction rather than a final design sign-off.

## Security and reliability findings

| Priority | Finding and evidence | Status / recommended next step |
| --- | --- | --- |
| High | Agent API routes originally trusted the *presence* of `switchyard_session`; `src/proxy.ts` deliberately checks only presence. A forged cookie could reach agent settings and, with a configured OpenAI-compatible provider, the models request path using the stored credential. | **Fixed in this branch:** each agent route validates the sealed session before access; HTTP tests cover forged, expired, future, and valid tokens. Review the change before release. |
| High | Agent provider, base URL, model, and credential are process-global/file-global (`dashboard/src/lib/agent/key-store.ts`). Any signed-in user can change the endpoint for every user. The product explicitly grants signed-in users admin power, but this is unsuitable for a team product without roles and ownership boundaries. | Open: define an admin-only configuration owner or per-user credential storage; constrain arbitrary provider URLs and audit changes. |
| High | The cached list of Dokploy-managed app names is one global set, yet it is used to authorize Docker-adjacent service access. A second signed-in user could briefly inherit another user's names within the cache TTL. | Open in the reconstructed branch: scope the cache by authenticated session and add a two-user integration test against Dokploy. |
| Medium | Sealed cookies carried `iat` but the server did not enforce age after decryption (`dashboard/src/lib/session.ts`). | **Fixed:** seven-day maximum age with future-clock guard; tested via agent routes. |
| High | Agent settings are written under the dashboard container's home directory by default, but `cli/src/core/switchyard-container.ts` mounts only the Docker socket. `ensureSwitchyard` removes the old container for a replacement. Settings and pasted credential can disappear on upgrade/recreate. | Open: mount a dedicated persistent volume with permissions and migration; test upgrades. |
| High | `ensureSwitchyard` returns “unchanged” for a running container with the same config hash before pulling the image. A mutable `latest` tag therefore does not refresh on ordinary `up`. After pulling, it removes the old container before the replacement is health-checked and has no rollback. | Open: compare immutable image digests, stage a replacement, health-check, switch over, retain and roll back old version on failure. |
| Medium | Desktop URL trust uses broad `file:` and string-prefix dashboard URL checks (`desktop/src/main/index.ts`), including IPC authorization for any `file:` sender frame. | Open: authorize the exact bundled file path and parsed localhost origin, then run Electron security tests. This is a source-level concern, not a demonstrated exploit. |
| Medium | Dashboard CI runs a build but no behavioral auth test. Release workflow's tag check verifies package versions, while E2E domain coverage lives in a separate path-filtered workflow. | The reconstructed branch adds `npm run test:auth`, but does not yet wire it into CI. Add real Dokploy lifecycle and upgrade tests, and make release depend on required verification. |

The dashboard's Docker socket and Dokploy admin capabilities make authorization mistakes consequential. Deployment documentation already defaults to localhost and recommends HTTPS when exposed; keep that deployment posture while the team security model matures.

## Product direction

1. **Make the operator loop dependable.** Persist agent settings, make upgrades safe, show deployment/build logs per attempt, and test a full deploy → domain → rollback → backup/restore path on real Dokploy.
2. **Make environments first-class.** Add explicit environment comparison, promotion of image/config between environments, and reviewable changes before production. Keep preview/PR environments as a separate, well-specified milestone.
3. **Make team use safe.** Define organization/project roles, scoped credentials, audit events, and least-privilege access around logs, console, secrets, and Docker operations.
4. **Grow the workspace from operator evidence.** Validate the new layout with large projects, keyboard-only use, accessibility checks, loading/error states, and real mobile sessions. Then refine deployment timelines and incident triage.

## Verification and delivery

- Dashboard: `npm run lint`, `npm run build`, and `npm run test:auth` passed. Next emitted a nonfatal Turbopack file-tracing warning from `agent/key-store.ts`.
- CLI: `npm run typecheck` and 37 tests passed during the earlier source assessment; not rerun for the reconstructed commit.
- MCP: `npm run typecheck` and 5 tests passed during the earlier source assessment; not rerun for the reconstructed commit.
- Desktop: `npm run typecheck` and build passed during the earlier source assessment. Smoke stopped at its Docker prerequisite, so the desktop app was not exercised.
- Browser recordings: baseline desktop, earlier proposed desktop, and earlier proposed mobile from seeded fixtures. They are design demonstrations, not live integration tests or a pixel-accurate recording of the reconstructed commit.
- The reconstructed branch has **not** been merged. A fresh browser pass and a real Dokploy integration run remain release gates.
