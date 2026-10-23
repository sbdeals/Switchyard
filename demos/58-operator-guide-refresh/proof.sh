#!/usr/bin/env bash
# Run from the Switchyard repo root. Read-only; uses origin/main as the baseline.
set -euo pipefail

guide=docs/dashboard-guide.md
architecture=docs/architecture.md

before() {
  printf '\nBEFORE — origin/main:%s\n' "$1"
  git show "origin/main:$1" | grep -nE "$2"
}
after() {
  printf '\nAFTER — %s\n' "$1"
  grep -nE "$2" "$1"
}
evidence() {
  printf '\nCODE — %s\n' "$1"
  grep -nH -E -A "${3:-0}" "$2" "$1"
}

printf 'Compose variables and current tab sets\n'
before "$guide" 'Compose stacks have no Variables tab|^\| (Application|Database|Compose stack) \||Variables.*applications and databases|Domains.*applications only|Deploys.*applications only'
after "$guide" 'Compose stacks have a|^\| (Application|Database|Compose stack)|^\*\*Data\*\*|Variables.*applications, databases|Networking.*applications and compose|Deploys.*applications and compose'
before "$architecture" '^\| (Database|Application|Compose) \||^\| Env vars'
after "$architecture" '^\| (Database|Application|Compose) \||^\*\*Data\*\*|^\| Env vars'
evidence dashboard/src/lib/dokploy.ts 'export type ServiceKind'
evidence dashboard/src/components/service/ServiceDrawer.tsx '^const TAB_META|^const DB_TABS|^const APP_TABS|^const COMPOSE_TABS' 15
evidence dashboard/src/components/service/ServiceDrawer.tsx '^function isPostgresService|^function composeMentionsPostgres|^function withDataTab' 6
evidence dashboard/src/components/service/ServiceDrawer.tsx 'tab === "deployments"' 2
evidence dashboard/src/components/service/VariablesTab.tsx 'service.kind === "compose"|One <code' 2
evidence dashboard/src/lib/dokploy.ts 'export async function saveComposeEnvironment' 5
evidence dashboard/src/components/service/ComposeTabs.tsx 'function add\(' 11
evidence dashboard/src/components/service/AppTabs.tsx '^const NEW_DOMAIN|<DomainFields|app.sourceType === "git"' 6
evidence dashboard/src/lib/dokploy.ts 'https: opts\?\.https|certificateType: opts\?\.certificateType'
evidence dashboard/src/components/service/primitives.tsx 'const primary = domains.find|No domain yet'

printf '\nGitHub App deployment and public clone-URL fallback\n'
before "$guide" 'offers three ways in|No OAuth or deploy keys are involved|Public sources only'
after "$guide" 'offers four ways in|clone-URL field uses|private GitHub repositories|^[123]\. |If no GitHub App|Source access|GitHub App deployments use'
before "$architecture" '^\| Quick deploy'
after "$architecture" '^\| Quick deploy|^\*\*GitHub App sources'
evidence dashboard/src/components/QuickDeployMenu.tsx 'setGithubOpen\(true\)|From GitHub|private repos|<GithubDeployModal'
evidence dashboard/src/components/GithubDeployModal.tsx 'const fallback|setBranch\(res.data|providers.length === 1|No GitHub App|Connect GitHub App|/> Refresh|Labeled label="Installation"|label="Repository"|r.isPrivate|Labeled label="Branch"|onClick=\{deploy\}' 1
evidence dashboard/src/app/actions.ts 'await setAppGithubSource|await setAppGitSource' 3
evidence dashboard/src/lib/dokploy.ts 'application.saveGithubProvider' 17
evidence dashboard/src/lib/dokploy.ts 'exchange that needs a public callback|export function githubConnectUrl' 2
evidence dashboard/src/lib/dokploy.ts 'export async function setAppGitSource' 16

printf '\nManaged installs versus manual/dev configuration\n'
before "$guide" 'Auto-URL is|On Windows, empty Logs|Traefik.*routing is'
after "$guide" '^\*\*Auto-URL|^Without.*SWITCHYARD_HOST_IP|CLI/desktop-managed|Traefik.*routing requires'
before "$architecture" 'Traefik is unmanaged|On Windows, Docker Desktop|^\| `SWITCHYARD_HOST_IP`'
after "$architecture" 'deploy-time auto-URL is a no-op|CLI/desktop-managed|^\| `SWITCHYARD_HOST_IP`'
evidence dashboard/src/lib/dokploy.ts 'AUTO_DOMAIN_PORT =|port: AUTO_DOMAIN_PORT|export async function ensureAutoDomain' 3
evidence dashboard/src/lib/dokploy.ts 'export async function generateHostFor' 10
evidence dashboard/src/app/actions.ts 'const g = await generateHostFor' 8
evidence dashboard/src/lib/docker.ts 'const socketPath =|new Docker'
evidence cli/src/commands/up.ts 'if \(cfg.platform === "linux" && !cfg.hostIp\)' 6
evidence cli/src/core/switchyard-container.ts 'if \(cfg.hostIp\)|socket:|spec.socket'
evidence cli/src/commands/local-ingress.ts 'cfg.localIngress =|await platform.localIngress|http://<host>'
evidence cli/src/core/config.ts 'localIngress:|localIngressHttpPort:'
evidence desktop/src/main/orchestrator.ts 'await ensureSwitchyard|if \(cfg.localIngress\)' 3

# Match the stale claims specifically; public clone URLs remain supported.
stale_patterns=$(cat <<'PATTERNS'
Compose stacks have no Variables tab
Public sources only
No OAuth or deploy keys are involved
The **Variables** tab (applications and databases)
The **Domains** tab (applications only)
The **Deploys** tab (applications only)
| Application | Overview · Variables · Domains
| Database | Overview · Variables · Metrics
| Database | Overview (lifecycle, connection string, facts) · Variables · Metrics
| Compose stack | Overview · Compose · Logs
| Compose | Overview · Compose (YAML editor with save & deploy) · Logs
Auto-URL is **off on Docker Desktop and in dev mode**
Traefik is unmanaged there and domains wouldn't route
Unset = auto-URL disabled (dev / Docker Desktop)
On Windows, empty Logs and Metrics tabs usually mean
PATTERNS
)
if grep -nHF -f <(printf '%s\n' "$stale_patterns") "$guide" "$architecture"; then
  printf '\nFAIL: stale DOC-P2-2 claims remain.\n' >&2
  exit 1
else
  status=$?
  if [[ "$status" -ne 1 ]]; then exit "$status"; fi
fi
printf '\nPASS: all targeted stale DOC-P2-2 phrases are gone; before/after claims and code evidence printed.\n'
