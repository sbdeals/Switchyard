# before axe audit

Pinned axe: https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js

Violations count rule occurrences per scanned surface; affected nodes can repeat across surfaces.

| Rule | Impact | Surface occurrences | Affected nodes |
| --- | --- | ---: | ---: |
| region | moderate | 36 | 1404 |
| aria-allowed-role | minor | 31 | 31 |
| landmark-one-main | moderate | 2 | 2 |

39 surfaces; 69 rule occurrences; 1437 affected node occurrences.

| Surface | Rules | Affected nodes | Incomplete rules |
| --- | ---: | ---: | ---: |
| login | 0 | 0 | 1 |
| signup | 0 | 0 | 1 |
| workspace-canvas | 1 | 1 | 2 |
| workspace-grid | 2 | 40 | 1 |
| projects-panel | 1 | 39 | 1 |
| quick-deploy-menu-docker-repo-database | 1 | 39 | 1 |
| quick-deploy-template-catalog | 1 | 39 | 1 |
| github-dialog | 1 | 39 | 1 |
| application-overview | 2 | 40 | 1 |
| application-variables | 2 | 40 | 1 |
| application-deploy | 2 | 40 | 1 |
| application-build | 2 | 40 | 1 |
| application-networking | 2 | 40 | 1 |
| application-deploys | 2 | 40 | 1 |
| application-schedules | 2 | 40 | 1 |
| application-volumes | 2 | 40 | 1 |
| application-metrics | 2 | 40 | 1 |
| application-logs | 2 | 40 | 1 |
| application-console | 2 | 40 | 1 |
| application-settings | 2 | 40 | 1 |
| compose-overview | 2 | 40 | 1 |
| compose-variables | 2 | 40 | 1 |
| compose-networking | 2 | 40 | 1 |
| compose-deploys | 2 | 40 | 1 |
| compose-compose | 2 | 40 | 1 |
| compose-volumes | 2 | 40 | 1 |
| compose-metrics | 2 | 40 | 1 |
| compose-logs | 2 | 40 | 1 |
| compose-console | 2 | 40 | 1 |
| compose-settings | 2 | 40 | 1 |
| postgres-overview | 2 | 40 | 1 |
| postgres-data | 2 | 40 | 1 |
| postgres-variables | 2 | 40 | 1 |
| postgres-volumes | 2 | 40 | 1 |
| postgres-metrics | 2 | 40 | 1 |
| postgres-logs | 2 | 40 | 1 |
| postgres-console | 2 | 40 | 1 |
| postgres-backups | 2 | 40 | 1 |
| postgres-settings | 2 | 40 | 1 |

- Docker image, repository, database and template actions are inline QuickDeployMenu controls in this base; no separate preview dialogs exist. Provisioning actions were never submitted.
- postgres Data nested tabs unavailable: no running Postgres target. No SQL was executed.
- Native browser rename/delete confirmations were opened and dismissed; axe cannot inspect browser chrome. No forms were submitted, SQL/console commands executed, or services changed.
