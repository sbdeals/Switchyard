# after axe audit

Pinned axe: https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js

Violations count rule occurrences per scanned surface; affected nodes can repeat across surfaces.

| Rule | Impact | Surface occurrences | Affected nodes |
| --- | --- | ---: | ---: |

39 surfaces; 0 rule occurrences; 0 affected node occurrences.

| Surface | Rules | Affected nodes | Incomplete rules |
| --- | ---: | ---: | ---: |
| login | 0 | 0 | 1 |
| signup | 0 | 0 | 1 |
| workspace-canvas | 0 | 0 | 1 |
| workspace-grid | 0 | 0 | 1 |
| projects-panel | 0 | 0 | 1 |
| quick-deploy-menu-docker-repo-database | 0 | 0 | 2 |
| quick-deploy-template-catalog | 0 | 0 | 2 |
| github-dialog | 0 | 0 | 1 |
| application-overview | 0 | 0 | 1 |
| application-variables | 0 | 0 | 1 |
| application-deploy | 0 | 0 | 1 |
| application-build | 0 | 0 | 1 |
| application-networking | 0 | 0 | 1 |
| application-deploys | 0 | 0 | 1 |
| application-schedules | 0 | 0 | 1 |
| application-volumes | 0 | 0 | 1 |
| application-metrics | 0 | 0 | 1 |
| application-logs | 0 | 0 | 1 |
| application-console | 0 | 0 | 1 |
| application-settings | 0 | 0 | 1 |
| compose-overview | 0 | 0 | 1 |
| compose-variables | 0 | 0 | 1 |
| compose-networking | 0 | 0 | 1 |
| compose-deploys | 0 | 0 | 1 |
| compose-compose | 0 | 0 | 1 |
| compose-volumes | 0 | 0 | 1 |
| compose-metrics | 0 | 0 | 1 |
| compose-logs | 0 | 0 | 1 |
| compose-console | 0 | 0 | 1 |
| compose-settings | 0 | 0 | 1 |
| postgres-overview | 0 | 0 | 1 |
| postgres-data | 0 | 0 | 1 |
| postgres-variables | 0 | 0 | 1 |
| postgres-volumes | 0 | 0 | 1 |
| postgres-metrics | 0 | 0 | 1 |
| postgres-logs | 0 | 0 | 1 |
| postgres-console | 0 | 0 | 1 |
| postgres-backups | 0 | 0 | 1 |
| postgres-settings | 0 | 0 | 1 |

- Docker image, repository, database and template actions are inline QuickDeployMenu controls in this base; no separate preview dialogs exist. Provisioning actions were never submitted.
- postgres Data nested tabs unavailable: no running Postgres target. No SQL was executed.
- Native browser rename/delete confirmations were opened and dismissed; axe cannot inspect browser chrome. No forms were submitted, SQL/console commands executed, or services changed.
